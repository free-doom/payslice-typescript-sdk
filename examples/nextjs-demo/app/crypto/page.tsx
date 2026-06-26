"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PayoutResult, SettlementResult } from "@/lib/crypto-mock";

interface Mode {
  live: boolean;
  baseUrl: string;
  network: string;
  currency: string;
  token: string;
  safe: string | null;
  explorerBase: string;
}

type Phase = "idle" | "authorizing" | "confirming" | "done" | "error";

function freshAddress(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtUsd(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function short(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `${res.status}`);
  return data as T;
}

export default function CryptoPayout() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState("500"); // minor units (cents)
  const [recipient, setRecipient] = useState("");
  const [payout, setPayout] = useState<PayoutResult | null>(null);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crypto/mode").then((r) => r.json()).then(setMode).catch(() => {});
    setRecipient(freshAddress());
  }, []);

  function reset(newRecipient = true) {
    setPayout(null);
    setSettlement(null);
    setError(null);
    setPhase("idle");
    if (newRecipient) setRecipient(freshAddress());
  }

  async function send() {
    const amountMinor = Number(amount);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setError("Amount must be a positive integer in minor units (cents).");
      return;
    }
    reset(false);
    setPhase("authorizing");
    try {
      const p = await postJson<PayoutResult>("/api/crypto/payout", { amountMinor, recipient });
      setPayout(p);
      setPhase("confirming");

      let attempt = 0;
      const poll = async () => {
        attempt += 1;
        const params = new URLSearchParams({
          recipient,
          fromBlock: String(p.fromBlock),
          amountMinor: String(amountMinor),
          attempt: String(attempt),
        });
        const s = (await fetch(`/api/crypto/settlement?${params}`).then((r) => r.json())) as
          | SettlementResult
          | { error: { message: string } };
        if ("error" in s) {
          setError(s.error.message);
          setPhase("error");
          return;
        }
        setSettlement(s);
        if (s.status === "confirmed") {
          setPhase("done");
          return;
        }
        if (attempt < 45) setTimeout(poll, 4000);
        else {
          setError("Timed out waiting for the settlement transfer.");
          setPhase("error");
        }
      };
      poll();
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const busy = phase === "authorizing" || phase === "confirming";
  const decimals = payout?.decimals ?? 6;
  const tokenAmount =
    settlement?.value != null ? Number(settlement.value) / 10 ** decimals : null;

  const steps: { key: Phase | "reserved"; label: string }[] = [
    { key: "authorizing", label: "Authorizing" },
    { key: "reserved", label: "Reserved" },
    { key: "confirming", label: "Settling on-chain" },
    { key: "done", label: "Confirmed" },
  ];
  function stepState(key: string): "done" | "active" | "todo" {
    const order = ["authorizing", "reserved", "confirming", "done"];
    const cur =
      phase === "idle"
        ? -1
        : phase === "authorizing"
          ? 0
          : phase === "confirming"
            ? settlement?.status === "confirmed"
              ? 3
              : 2
            : phase === "done"
              ? 3
              : payout
                ? 1
                : 0;
    const idx = order.indexOf(key);
    if (idx < cur) return "done";
    if (idx === cur) return "active";
    return "todo";
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>
          Payslice <span>Crypto Custody Payout</span>
        </h1>
        {mode && (
          <span className={`mode ${mode.live ? "live" : "mock"}`}>
            {mode.live ? "LIVE" : "MOCK MODE"}
          </span>
        )}
      </header>
      <p className="lede">
        End-to-end test of the non-custodial crypto rail: a signed authorization →
        the <strong>KMS delegate</strong> signs an Allowance-Module transfer →
        the <strong>powerless relayer</strong> broadcasts it, moving tokens out of
        the <strong>2-of-3 Safe</strong>. Settlement is read back off-chain from{" "}
        {mode?.network ?? "Base Sepolia"}.{" "}
        <Link href="/">← back to the EWA demo</Link>
      </p>

      <div className="grid">
        <div className="card">
          <h2>
            <span className="num">1</span> Authorize a payout
          </h2>

          <label>Amount (minor units / cents)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            disabled={busy}
          />
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            = {fmtUsd(Number(amount) || 0, mode?.currency)} of mock {mode?.currency ?? "USD"}
          </p>

          <label>Recipient (fresh test address each run)</label>
          <div className="row">
            <div>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={busy}
                spellCheck={false}
              />
            </div>
            <button
              className="ghost"
              style={{ marginTop: 0, flex: "0 0 auto" }}
              onClick={() => setRecipient(freshAddress())}
              disabled={busy}
              title="Generate a new throwaway recipient"
            >
              ↻
            </button>
          </div>

          <button onClick={send} disabled={busy || !recipient}>
            {phase === "authorizing"
              ? "Authorizing…"
              : phase === "confirming"
                ? "Settling…"
                : "Send crypto payout"}
          </button>
          {(payout || phase === "done" || phase === "error") && (
            <button className="ghost" onClick={() => reset(true)} disabled={busy} style={{ marginLeft: 8 }}>
              Reset
            </button>
          )}

          {error && <div className="err">{error}</div>}
        </div>

        <div className="card">
          <h2>
            <span className="num">2</span> Settlement
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {steps.map((s) => {
              const st = stepState(s.key);
              return (
                <div key={s.key} className="kv" style={{ borderBottom: "none", padding: "3px 0" }}>
                  <span className="k">
                    {st === "done" ? "✓" : st === "active" ? "●" : "○"} {s.label}
                  </span>
                  <span className="v" style={{ opacity: st === "todo" ? 0.4 : 1 }}>
                    {s.key === "reserved" && payout ? payout.status : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {payout && (
            <>
              <div className="kv">
                <span className="k">payout_ref</span>
                <span className="v">{short(payout.payout_ref)}</span>
              </div>
              <div className="kv">
                <span className="k">recipient</span>
                <span className="v">{short(payout.recipient)}</span>
              </div>
            </>
          )}

          {settlement?.status === "confirmed" && (
            <>
              <div className="kv">
                <span className="k">status</span>
                <span className="badge released">confirmed{settlement.mock ? " (mock)" : ""}</span>
              </div>
              <div className="kv">
                <span className="k">amount moved</span>
                <span className="v">
                  {tokenAmount != null ? tokenAmount.toLocaleString() : "—"} {mode?.currency ?? "USD"}
                </span>
              </div>
              <div className="kv">
                <span className="k">confirmations</span>
                <span className="v">{settlement.confirmations ?? "—"}</span>
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

          {phase === "confirming" && settlement?.status !== "confirmed" && (
            <p className="muted" style={{ fontSize: 13 }}>
              Waiting for the relayer to broadcast and the transfer to mine…
            </p>
          )}
          {phase === "idle" && !payout && (
            <p className="muted" style={{ fontSize: 13 }}>
              Authorize a payout to watch it settle on {mode?.network ?? "Base Sepolia"}.
            </p>
          )}
        </div>
      </div>

      <footer>
        {mode?.safe && (
          <>
            Safe (treasury): <code>{mode.safe}</code> · token: <code>{short(mode.token)}</code> ·{" "}
          </>
        )}
        {mode?.live ? (
          <>Live against the Vault/Rail service at <code>{mode.baseUrl}</code>.</>
        ) : (
          <>
            Mock mode — set <code>VAULT_RAIL_BASE_URL</code>, <code>VAULT_RAIL_KEY_ID</code>,{" "}
            <code>VAULT_RAIL_SECRET</code> and <code>VAULT_RAIL_USD_TOKEN_CONTRACT</code> in{" "}
            <code>.env.local</code> to go live (see the demo README).
          </>
        )}
      </footer>
    </div>
  );
}
