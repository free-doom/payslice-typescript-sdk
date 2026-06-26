"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Advance, Quote } from "@payslice/sdk";
import { postJson } from "@/lib/http";
import { freshAddress, randomHex } from "@/lib/rand";
import type { SettlementResult } from "@/lib/crypto-mock";

interface Mode {
  live: boolean;
  network: string;
  currency: string;
  token: string;
  safe: string | null;
  explorerBase: string;
}

type Phase =
  | "idle"
  | "quoting"
  | "advancing"
  | "settling"
  | "confirming"
  | "done"
  | "error";

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 45;
// Partial drawdown ceiling, kept under the rail's demo cap (VAULT_RAIL_MAX_AMOUNT_MINOR,
// $1,000). The sandbox can approve much larger quotes; the employee draws this much.
const DRAW_CAP_MINOR = 50_000; // $500

function fmtUsd(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
function short(s: string): string {
  return s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

/** Recent month-end settlements the risk engine needs to approve a quote. */
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
    // ~$750 advance (50% of $1,500) stays under the live rail's $1k demo cap.
    salary: "150000",
    currency: "USD",
    start_date: "2024-01-15",
    due_date: "2026-07-31",
  });
  const [wallet, setWallet] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [advance, setAdvance] = useState<Advance | null>(null);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [released, setReleased] = useState<Advance | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const runIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/crypto/mode").then((r) => r.json()).then(setMode).catch(() => {});
    fetch("/api/mode").then((r) => r.json()).then((m) => setEwaLive(Boolean(m.live))).catch(() => {});
    setWallet(freshAddress());
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function reset() {
    runIdRef.current += 1;
    setQuote(null);
    setAdvance(null);
    setSettlement(null);
    setReleased(null);
    setError(null);
    setPhase("idle");
    setWallet(freshAddress());
  }

  // Watch the chain for the rail's settlement transfer, then resolve.
  function pollSettlement(
    runId: number,
    recipient: string,
    fromBlock: number,
    amountMinor: number,
  ): Promise<SettlementResult> {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tick = async () => {
        if (runId !== runIdRef.current) return;
        attempt += 1;
        const params = new URLSearchParams({
          recipient,
          fromBlock: String(fromBlock),
          amountMinor: String(amountMinor),
          attempt: String(attempt),
        });
        const s = (await fetch(`/api/crypto/settlement?${params}`).then((r) => r.json())) as
          | SettlementResult
          | { error: { message: string } };
        if (runId !== runIdRef.current) return;
        if ("error" in s) return reject(new Error(s.error.message));
        setSettlement(s);
        if (s.status === "confirmed") return resolve(s);
        if (attempt < MAX_POLLS) setTimeout(tick, POLL_INTERVAL_MS);
        else reject(new Error("Timed out waiting for the settlement transfer."));
      };
      tick();
    });
  }

  async function run() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      setError("Enter a valid 0x employee wallet address.");
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setQuote(null);
    setAdvance(null);
    setSettlement(null);
    setReleased(null);
    setError(null);

    try {
      // 1) Quote
      setPhase("quoting");
      const settlements = recentSettlements(Number(form.salary) || 0, form.currency);
      const q = await postJson<Quote>("/api/quote", {
        user_id: form.user_id,
        company_id: form.company_id,
        contract: { id: "contract_1", start_date: form.start_date },
        salary: { amount: Number(form.salary), currency: form.currency, frequency: "monthly" },
        settlements,
      });
      if (runId !== runIdRef.current) return;
      setQuote(q);

      // 2) Advance (partner-executed: the partner disburses, then confirms below).
      //    Partial drawdown kept under the rail's demo cap.
      setPhase("advancing");
      const drawMinor = Math.min(q.amount ?? 0, DRAW_CAP_MINOR);
      const a = await postJson<Advance>("/api/advance", {
        quote_id: q.id,
        user_id: q.user_id,
        amount: drawMinor,
        currency: q.currency,
        destination_account_id: "partner_ledger_acct_demo",
        due_date: form.due_date,
      });
      if (runId !== runIdRef.current) return;
      setAdvance(a);

      // 3) Disburse on-chain via the Vault/Rail (the partner's crypto settlement).
      //    The advance id is the idempotency key, tying the payout to this advance.
      setPhase("settling");
      const payout = await postJson<{ fromBlock: number }>("/api/crypto/payout", {
        amountMinor: a.amount,
        recipient: wallet,
        idempotencyKey: `${a.id}-${randomHex(4)}`,
      });
      if (runId !== runIdRef.current) return;
      const s = await pollSettlement(runId, wallet, payout.fromBlock, a.amount);
      if (runId !== runIdRef.current) return;

      // 4) Confirm the disbursement back to EWA → advance released.
      setPhase("confirming");
      const rel = await postJson<Advance>(`/api/advance/${encodeURIComponent(a.id)}/confirm`, {
        status: "executed",
        transfer_ref: s.txHash,
      });
      if (runId !== runIdRef.current) return;
      setReleased(rel);
      setPhase("done");
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const busy = ["quoting", "advancing", "settling", "confirming"].includes(phase);
  const decimals = 6; // mock USDC/EURC
  const tokenAmount = settlement?.value != null ? Number(settlement.value) / 10 ** decimals : null;

  const STEPS = ["Quote", "Advance", "Disburse on-chain", "Confirm → released"] as const;
  const activeIndex =
    phase === "done"
      ? 4
      : phase === "quoting"
        ? 0
        : phase === "advancing"
          ? 1
          : phase === "settling"
            ? 2
            : phase === "confirming"
              ? 3
              : -1;
  const stepState = (i: number): "done" | "active" | "todo" =>
    i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";

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
        The whole flow a crypto partner runs: <strong>quote → advance → disburse → confirm</strong>.
        The advance is <em>partner-executed</em>; the partner settles it on-chain through the{" "}
        <strong>Vault/Rail</strong> (KMS-signed Allowance-Module transfer out of the 2-of-3 Safe),
        then confirms the disbursement back to EWA so the advance is <code>released</code>. No
        end-user “authorize” step — settlement is automatic.{" "}
        <Link href="/">← EWA confirm-disbursement demo</Link>
      </p>

      <div className="grid">
        <div className="card">
          <h2>
            <span className="num">1</span> Employee & advance request
          </h2>
          <div className="row">
            <div>
              <label>Employee ID</label>
              <input value={form.user_id} onChange={(e) => set("user_id", e.target.value)} disabled={busy} />
            </div>
            <div>
              <label>Employer ID</label>
              <input value={form.company_id} onChange={(e) => set("company_id", e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Monthly salary (cents)</label>
              <input value={form.salary} onChange={(e) => set("salary", e.target.value)} inputMode="numeric" disabled={busy} />
            </div>
            <div>
              <label>Currency</label>
              <input value={form.currency} onChange={(e) => set("currency", e.target.value)} disabled={busy} />
            </div>
          </div>
          <label>Employee crypto wallet (where the advance is disbursed)</label>
          <div className="row">
            <div>
              <input value={wallet} onChange={(e) => setWallet(e.target.value)} disabled={busy} spellCheck={false} />
            </div>
            <button className="ghost" style={{ marginTop: 0, flex: "0 0 auto" }} onClick={() => setWallet(freshAddress())} disabled={busy} title="Fresh test wallet">
              ↻
            </button>
          </div>

          <button onClick={run} disabled={busy || !wallet}>
            {busy ? "Running…" : "Run quote → advance → settle → confirm"}
          </button>
          {(phase === "done" || phase === "error") && (
            <button className="ghost" onClick={reset} style={{ marginLeft: 8 }}>
              Reset
            </button>
          )}
          {error && <div className="err">{error}</div>}
        </div>

        <div className="card">
          <h2>
            <span className="num">2</span> Flow
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {STEPS.map((label, i) => {
              const st = stepState(i);
              return (
                <div key={label} className="kv" style={{ borderBottom: "none", padding: "3px 0" }}>
                  <span className="k">
                    {st === "done" ? "✓" : st === "active" ? "●" : "○"} {label}
                  </span>
                </div>
              );
            })}
          </div>

          {quote && (
            <div className="kv">
              <span className="k">quote</span>
              <span className="v">{fmtUsd(quote.amount ?? 0, quote.currency ?? "USD")} approved</span>
            </div>
          )}
          {advance && (
            <div className="kv">
              <span className="k">advance</span>
              <span className="v">{short(advance.id)}</span>
            </div>
          )}
          {settlement?.status === "confirmed" && (
            <>
              <div className="kv">
                <span className="k">disbursed on-chain</span>
                <span className="v">
                  {tokenAmount != null ? tokenAmount.toLocaleString() : "—"} {mode?.currency}
                </span>
              </div>
              <div className="kv">
                <span className="k">tx</span>
                <span className="v">
                  {settlement.explorerUrl ? (
                    <a href={settlement.explorerUrl} target="_blank" rel="noreferrer">
                      {short(settlement.txHash ?? "")} ↗
                    </a>
                  ) : (
                    short(settlement.txHash ?? "")
                  )}
                </span>
              </div>
            </>
          )}
          {released && (
            <div className="kv">
              <span className="k">advance status</span>
              <span className={`badge ${released.status === "released" ? "released" : "failed"}`}>
                {released.status}
              </span>
            </div>
          )}

          {phase === "settling" && settlement?.status !== "confirmed" && (
            <p className="muted" style={{ fontSize: 13 }}>Relayer broadcasting; waiting for the transfer to mine…</p>
          )}
          {phase === "idle" && (
            <p className="muted" style={{ fontSize: 13 }}>
              Run the flow to quote an advance and settle it on {mode?.network ?? "Base Sepolia"}.
            </p>
          )}
        </div>
      </div>

      <footer>
        {mode?.safe && (
          <>Safe (treasury): <code>{mode.safe}</code> · token: <code>{short(mode.token)}</code> · </>
        )}
        EWA quote/advance/confirm use the {ewaLive ? "live Payslice sandbox" : "built-in mock"}; the
        on-chain disbursement uses the {mode?.live ? "live Vault/Rail" : "mock"} rail.
      </footer>
    </div>
  );
}
