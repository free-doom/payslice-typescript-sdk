"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Advance, Quote } from "@payslice/sdk";
import { postJson } from "@/lib/http";
import { freshAddress } from "@/lib/rand";
import type { SettlementResult } from "@/lib/crypto-mock";

interface Mode {
  live: boolean;
  network: string;
  currency: string;
  token: string;
  decimals: number;
  safe: string | null;
  explorerBase: string;
}

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 45;
// Partial drawdown ceiling, under the rail's demo cap (VAULT_RAIL_MAX_AMOUNT_MINOR, $1,000).
const DRAW_CAP_MINOR = 50_000; // $500

function fmt(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}
function short(s: string): string {
  return s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}
function recentSettlements(amount: number, currency: string) {
  const t = new Date();
  return [1, 2, 3].map((i) => {
    const d = new Date(t.getFullYear(), t.getMonth() - i + 1, 0);
    return { amount, currency, date: d.toISOString().slice(0, 10) };
  });
}

export default function CryptoFlow() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [ewaLive, setEwaLive] = useState(false);
  const [form, setForm] = useState({
    user_id: "employee_42",
    company_id: "employer_7",
    salary: "150000",
    currency: "USD",
    start_date: "2024-01-15",
    due_date: "2026-07-31",
  });
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [advance, setAdvance] = useState<Advance | null>(null);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [released, setReleased] = useState<Advance | null>(null);
  const [busy, setBusy] = useState<"quote" | "advance" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const settlements = recentSettlements(Number(form.salary) || 0, form.currency);

  useEffect(() => {
    fetch("/api/crypto/mode").then((r) => r.json()).then(setMode).catch(() => {});
    fetch("/api/mode").then((r) => r.json()).then((m) => setEwaLive(Boolean(m.live))).catch(() => {});
    setWallet(freshAddress());
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function createQuote() {
    runIdRef.current += 1;
    setBusy("quote");
    setError(null);
    setQuote(null);
    setAdvance(null);
    setSettlement(null);
    setReleased(null);
    try {
      const q = await postJson<Quote>("/api/quote", {
        user_id: form.user_id,
        company_id: form.company_id,
        contract: { id: "contract_1", start_date: form.start_date },
        salary: { amount: Number(form.salary), currency: form.currency, frequency: "monthly" },
        settlements,
      });
      setQuote(q);
      if (q.amount != null) setAmount(String(Math.min(q.amount, DRAW_CAP_MINOR)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Watch the chain for the rail's settlement transfer.
  function pollSettlement(runId: number, recipient: string, fromBlock: number, amountMinor: number) {
    return new Promise<SettlementResult>((resolve, reject) => {
      let attempt = 0;
      const tick = async () => {
        if (runId !== runIdRef.current) return;
        attempt += 1;
        try {
          const params = new URLSearchParams({
            recipient,
            fromBlock: String(fromBlock),
            amountMinor: String(amountMinor),
            attempt: String(attempt),
          });
          const res = await fetch(`/api/crypto/settlement?${params}`);
          const s = (await res.json()) as SettlementResult | { error: { message: string } };
          if (runId !== runIdRef.current) return;
          if ("error" in s) return reject(new Error(s.error.message));
          setSettlement(s);
          if (s.status === "confirmed") return resolve(s);
        } catch {
          // Network / non-JSON blip: treat as transient and keep polling (bounded).
          if (runId !== runIdRef.current) return;
        }
        if (attempt < MAX_POLLS) setTimeout(tick, POLL_INTERVAL_MS);
        else reject(new Error("Timed out waiting for the settlement transfer."));
      };
      tick();
    });
  }

  // Create the advance, then AUTO-settle on-chain and confirm back to EWA.
  async function createAdvance() {
    if (!quote) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      setError("Enter a valid 0x employee wallet address.");
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setBusy("advance");
    setError(null);
    setAdvance(null);
    setSettlement(null);
    setReleased(null);
    try {
      const amountMinor = Math.min(Number(amount) || 0, DRAW_CAP_MINOR);
      const a = await postJson<Advance>("/api/advance", {
        quote_id: quote.id,
        user_id: quote.user_id,
        amount: amountMinor,
        currency: quote.currency,
        destination_account_id: "partner_ledger_acct_demo",
        due_date: form.due_date,
      });
      if (runId !== runIdRef.current) return;
      setAdvance(a);

      // Auto: disburse on-chain via the Vault/Rail (the partner's crypto settlement).
      const payout = await postJson<{ fromBlock: number }>("/api/crypto/payout", {
        amountMinor: a.amount,
        recipient: wallet,
        // Stable key: the advance id is unique per advance, so a retry replays the same
        // authorization on the rail instead of firing a second transfer.
        idempotencyKey: a.id,
      });
      if (runId !== runIdRef.current) return;
      const s = await pollSettlement(runId, wallet, payout.fromBlock, a.amount);
      if (runId !== runIdRef.current) return;

      // Auto: confirm the disbursement back to EWA → released.
      const rel = await postJson<Advance>(`/api/advance/${encodeURIComponent(a.id)}/confirm`, {
        status: "executed",
        transfer_ref: s.txHash,
      });
      if (runId !== runIdRef.current) return;
      setReleased(rel);
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setError((e as Error).message);
    } finally {
      if (runId === runIdRef.current) setBusy(null);
    }
  }

  const settling = busy === "advance" && advance != null && released == null;
  const tokenAmount =
    settlement?.value != null ? Number(settlement.value) / 10 ** (mode?.decimals ?? 6) : null;

  return (
    <div className="wrap">
      <header className="top">
        <h1>
          Payslice <span>EWA → Crypto Settlement</span>
        </h1>
        {mode && (
          <span className={`mode ${mode.live ? "live" : "mock"}`}>
            {mode.live ? "LIVE RAIL" : "MOCK"} · EWA {ewaLive ? "sandbox" : "mock"}
          </span>
        )}
      </header>
      <p className="lede">
        The same <strong>quote → advance</strong> flow as the home page, but the advance
        is disbursed in <strong>crypto</strong>: creating it automatically settles on-chain
        through the <strong>Vault/Rail</strong> (a KMS-signed transfer out of the 2-of-3 Safe)
        and confirms back to EWA — no manual disbursement step.{" "}
        <Link href="/">← EWA (partner-ledger) demo</Link>
      </p>

      <div className="grid">
        <div>
          {/* 1. Quote */}
          <div className="card">
            <h2><span className="num">1</span> Request a quote</h2>
            <div className="row">
              <div>
                <label>Employee ID</label>
                <input value={form.user_id} onChange={(e) => set("user_id", e.target.value)} />
              </div>
              <div>
                <label>Employer ID</label>
                <input value={form.company_id} onChange={(e) => set("company_id", e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Monthly salary (cents)</label>
                <input value={form.salary} onChange={(e) => set("salary", e.target.value)} />
              </div>
              <div>
                <label>Currency</label>
                <input value={form.currency} onChange={(e) => set("currency", e.target.value)} />
              </div>
            </div>
            <button onClick={createQuote} disabled={busy != null}>
              {busy === "quote" ? "Requesting…" : "Get quote"}
            </button>

            {quote && (
              <>
                <div className="kv" style={{ marginTop: 14 }}>
                  <span className="k">Status</span>
                  <span className="v"><span className={`badge ${quote.status}`}>{quote.status}</span></span>
                </div>
                <div className="kv"><span className="k">Max advance</span><span className="v">{fmt(quote.amount, quote.currency ?? "USD")}</span></div>
                <div className="kv"><span className="k">Quote ID</span><span className="v">{short(quote.id)}</span></div>
              </>
            )}
          </div>

          {/* 2. Advance → auto-settle */}
          {quote?.approved && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2><span className="num">2</span> Draw down an advance (crypto)</h2>
              <label>Amount (cents, ≤ quoted; capped at {fmt(DRAW_CAP_MINOR)} for the demo)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy != null} />
              <label>Employee crypto wallet</label>
              <div className="row">
                <div>
                  <input value={wallet} onChange={(e) => setWallet(e.target.value)} disabled={busy != null} spellCheck={false} />
                </div>
                <button className="ghost" style={{ marginTop: 0, flex: "0 0 auto" }} onClick={() => setWallet(freshAddress())} disabled={busy != null} title="Fresh test wallet">
                  ↻
                </button>
              </div>
              <button onClick={createAdvance} disabled={busy != null || !wallet}>
                {busy === "advance" ? "Releasing…" : "Create advance & disburse"}
              </button>

              {advance && (
                <>
                  <div className="kv" style={{ marginTop: 14 }}>
                    <span className="k">Advance</span>
                    <span className="v"><span className={`badge ${(released ?? advance).status}`}>{(released ?? advance).status}</span></span>
                  </div>
                  <div className="kv"><span className="k">Amount</span><span className="v">{fmt(advance.amount, advance.currency)}</span></div>
                  <div className="kv"><span className="k">Advance ID</span><span className="v">{short(advance.id)}</span></div>
                </>
              )}
            </div>
          )}

          {error && <p className="err">⚠ {error}</p>}
        </div>

        {/* Right: on-chain settlement */}
        <div>
          <div className="card">
            <h2>On-chain disbursement</h2>
            {!advance && <p className="muted" style={{ fontSize: 13 }}>Create an advance to auto-settle it on {mode?.network ?? "Base Sepolia"}.</p>}

            {advance && (
              <>
                <div className="kv">
                  <span className="k">○ Advance created</span>
                  <span className="v">{advance.status === "approved" || released ? "✓" : ""}</span>
                </div>
                <div className="kv">
                  <span className="k">{settlement?.status === "confirmed" ? "✓" : settling ? "●" : "○"} Disbursing via rail</span>
                  <span className="v">{settling && settlement?.status !== "confirmed" ? "…" : ""}</span>
                </div>
                <div className="kv">
                  <span className="k">{released ? "✓" : "○"} Confirmed → released</span>
                </div>
              </>
            )}

            {settlement?.status === "confirmed" && (
              <>
                <div className="kv" style={{ marginTop: 10 }}>
                  <span className="k">Moved</span>
                  <span className="v">{tokenAmount != null ? tokenAmount.toLocaleString() : "—"} {mode?.currency}</span>
                </div>
                <div className="kv"><span className="k">Confirmations</span><span className="v">{settlement.confirmations ?? "—"}</span></div>
                <div className="kv">
                  <span className="k">Tx</span>
                  <span className="v">
                    {settlement.explorerUrl ? (
                      <a href={settlement.explorerUrl} target="_blank" rel="noreferrer">{short(settlement.txHash ?? "")} ↗</a>
                    ) : short(settlement.txHash ?? "")}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Treasury</h2>
            <div className="kv"><span className="k">Network</span><span className="v">{mode?.network ?? "—"}</span></div>
            <div className="kv"><span className="k">Safe</span><span className="v">{mode?.safe ? short(mode.safe) : "—"}</span></div>
            <div className="kv"><span className="k">Token</span><span className="v">{mode?.token ? short(mode.token) : "—"}</span></div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              EWA {ewaLive ? "sandbox" : "mock"} · {mode?.live ? "live" : "mock"} rail.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
