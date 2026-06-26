"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/http";
import { freshAddress } from "@/lib/rand";
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

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 45; // ~3 minutes

function fmtUsd(minor: number, currency = "USD"): string {
  // amount_minor is in cents (2-decimal minor units), system-wide.
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function short(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

const STEPS = ["Authorizing", "Reserved", "Settling on-chain", "Confirmed"] as const;

export default function CryptoPayout() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState("500"); // minor units (cents)
  const [recipient, setRecipient] = useState("");
  const [payout, setPayout] = useState<PayoutResult | null>(null);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Identifies the current run. Bumping it cancels any in-flight poll chain so a
  // stale poll (after Reset or a new Send) can't clobber the latest run's state.
  const runIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/crypto/mode").then((r) => r.json()).then(setMode).catch(() => {});
    setRecipient(freshAddress());
    // Cancel any pending poll if the component unmounts.
    return () => {
      runIdRef.current += 1;
    };
  }, []);

  function reset(newRecipient = true) {
    runIdRef.current += 1; // cancel any in-flight poll
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
    const runId = runIdRef.current + 1;
    runIdRef.current = runId; // supersedes any prior run/poll
    setPayout(null);
    setSettlement(null);
    setError(null);
    setPhase("authorizing");

    try {
      const p = await postJson<PayoutResult>("/api/crypto/payout", { amountMinor, recipient });
      if (runId !== runIdRef.current) return; // superseded while awaiting
      setPayout(p);
      setPhase("confirming");

      let attempt = 0;
      const poll = async () => {
        if (runId !== runIdRef.current) return; // a newer run/reset took over
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
        if (runId !== runIdRef.current) return; // superseded while awaiting

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
        if (attempt < MAX_POLLS) setTimeout(poll, POLL_INTERVAL_MS);
        else {
          setError("Timed out waiting for the settlement transfer.");
          setPhase("error");
        }
      };
      poll();
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const busy = phase === "authorizing" || phase === "confirming";
  const decimals = payout?.decimals ?? 6;
  const tokenAmount =
    settlement?.value != null ? Number(settlement.value) / 10 ** decimals : null;

  // Index of the active step (0..3); everything before it is done, after it todo.
  const activeIndex =
    phase === "done" || settlement?.status === "confirmed"
      ? 3
      : phase === "authorizing"
        ? 0
        : phase === "confirming"
          ? 2
          : payout
            ? 1
            : -1;
  const stepState = (i: number): "done" | "active" | "todo" =>
    i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";

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
            {STEPS.map((label, i) => {
              const st = stepState(i);
              return (
                <div key={label} className="kv" style={{ borderBottom: "none", padding: "3px 0" }}>
                  <span className="k">
                    {st === "done" ? "✓" : st === "active" ? "●" : "○"} {label}
                  </span>
                  <span className="v" style={{ opacity: st === "todo" ? 0.4 : 1 }}>
                    {i === 1 && payout ? payout.status : ""}
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
