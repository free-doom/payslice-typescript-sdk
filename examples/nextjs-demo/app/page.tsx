"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  Advance,
  CollectionsDue,
  Money,
  Quote,
  VaultResponse,
} from "@payslice/sdk";
import { postJson } from "@/lib/http";

function fmt(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100,
  );
}

/** The last 3 month-end pay settlements at the given amount (most recent first). */
function recentSettlements(amount: number, currency: string) {
  const today = new Date();
  return [1, 2, 3].map((i) => {
    // Day 0 of (month - i + 1) = last day of (month - i).
    const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    return { amount, currency, date: d.toISOString().slice(0, 10) };
  });
}

export default function Home() {
  const [mode, setMode] = useState<{ live: boolean; baseUrl: string } | null>(null);
  const [form, setForm] = useState({
    user_id: "employee_42",
    company_id: "employer_7",
    salary: "500000",
    currency: "USD",
    start_date: "2024-01-15",
    due_date: "2026-07-31",
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState("");
  const [advance, setAdvance] = useState<Advance | null>(null);
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [collections, setCollections] = useState<CollectionsDue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pay-settlement history sent with every quote — the risk engine needs
  // recent settlements to approve. Derived from the salary so the panel below
  // shows exactly what gets sent.
  const settlements = recentSettlements(Number(form.salary) || 0, form.currency);

  useEffect(() => {
    fetch("/api/mode").then((r) => r.json()).then(setMode);
    refreshSidebars();
  }, []);

  function refreshSidebars() {
    fetch("/api/vault").then((r) => r.json()).then(setVault).catch(() => {});
    fetch("/api/collections").then((r) => r.json()).then(setCollections).catch(() => {});
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function createQuote() {
    setBusy("quote"); setError(null); setQuote(null); setAdvance(null);
    try {
      const q = await postJson<Quote>("/api/quote", {
        user_id: form.user_id,
        company_id: form.company_id,
        contract: { id: "contract_1", start_date: form.start_date },
        salary: { amount: Number(form.salary), currency: form.currency, frequency: "monthly" },
        // Recent pay-settlement history; the risk engine needs this to approve.
        settlements,
      });
      setQuote(q);
      if (q.amount != null) setAmount(String(q.amount));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function createAdvance() {
    if (!quote) return;
    setBusy("advance"); setError(null);
    try {
      const a = await postJson<Advance>("/api/advance", {
        quote_id: quote.id,
        user_id: quote.user_id,
        amount: Number(amount),
        currency: quote.currency,
        destination_account_id: "partner_ledger_acct_99",
        due_date: form.due_date,
      });
      setAdvance(a);
      refreshSidebars();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function repay() {
    if (!collections?.items?.length) return;
    setBusy("repay"); setError(null);
    try {
      await postJson("/api/collections/confirm", { items: collections.items });
      refreshSidebars();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!advance) return;
    setBusy("confirm"); setError(null);
    try {
      const a = await postJson<Advance>(`/api/advance/${advance.id}/confirm`, {
        status: "executed",
        transfer_ref: `ledger_txn_${Date.now()}`,
      });
      setAdvance(a);
      refreshSidebars();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>Payslice <span>EWA</span> — SDK Demo</h1>
        {mode && (
          <span className={`mode ${mode.live ? "live" : "mock"}`}>
            {mode.live ? `LIVE · ${mode.baseUrl}` : "MOCK MODE · no credentials set"}
          </span>
        )}
      </header>
      <p className="lede">
        A reference Next.js integration for <code>@payslice/sdk</code>. Every Payslice
        call runs server-side in <code>app/api/*</code> route handlers — the HMAC secret
        never reaches the browser. Walk the flow: quote → advance → confirm.{" "}
        <Link href="/crypto">EWA → crypto settlement (full flow) →</Link>
      </p>

      <div className="grid">
        {/* Left: the flow */}
        <div>
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
            <label style={{ marginTop: 14 }}>
              Settlement history (sent with the quote)
            </label>
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 11px" }}>
              {settlements.map((s) => (
                <div className="kv" key={s.date}>
                  <span className="k">{s.date}</span>
                  <span className="v">{fmt(s.amount, s.currency)}</span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              The risk engine needs recent settlements to approve. The demo
              derives the last 3 months from the salary above.
            </p>

            <button onClick={createQuote} disabled={busy === "quote"}>
              {busy === "quote" ? "Requesting…" : "Get quote"}
            </button>

            {quote && (
              <>
                <div className="kv" style={{ marginTop: 14 }}>
                  <span className="k">Status</span>
                  <span className="v"><span className={`badge ${quote.status}`}>{quote.status}</span></span>
                </div>
                {!quote.approved && (quote.decline_reasons?.length ?? 0) > 0 && (
                  <div className="kv">
                    <span className="k">Decline reason</span>
                    <span className="v" style={{ color: "var(--danger)" }}>
                      {quote.decline_reasons!.join(", ")}
                    </span>
                  </div>
                )}
                <div className="kv"><span className="k">Max advance</span><span className="v">{fmt(quote.amount, quote.currency ?? "USD")}</span></div>
                <div className="kv"><span className="k">Fee</span><span className="v">{fmt(quote.fee, quote.currency ?? "USD")}</span></div>
                <div className="kv"><span className="k">Quote ID</span><span className="v">{quote.id}</span></div>
              </>
            )}
          </div>

          {quote?.approved && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2><span className="num">2</span> Draw down an advance</h2>
              <label>Amount (cents, ≤ quoted)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button onClick={createAdvance} disabled={busy === "advance"}>
                {busy === "advance" ? "Releasing…" : "Create advance"}
              </button>

              {advance && (
                <>
                  <div className="kv" style={{ marginTop: 14 }}>
                    <span className="k">Status</span>
                    <span className="v"><span className={`badge ${advance.status}`}>{advance.status}</span></span>
                  </div>
                  <div className="kv"><span className="k">Amount</span><span className="v">{fmt(advance.amount, advance.currency)}</span></div>
                  <div className="kv"><span className="k">Outstanding</span><span className="v">{fmt(advance.amount_outstanding, advance.currency)}</span></div>
                  <div className="kv"><span className="k">Advance ID</span><span className="v">{advance.id}</span></div>
                </>
              )}
            </div>
          )}

          {advance && advance.status === "approved" && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2><span className="num">3</span> Confirm the disbursement</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                After executing the transfer on your ledger, report it back. This moves
                the advance to <code>released</code>.
              </p>
              <button onClick={confirm} disabled={busy === "confirm"}>
                {busy === "confirm" ? "Confirming…" : "Confirm executed"}
              </button>
            </div>
          )}

          {error && <p className="err">⚠ {error}</p>}
        </div>

        {/* Right: live state */}
        <div>
          <div className="card">
            <h2>Vault</h2>
            {vault?.vaults?.length ? vault.vaults.map((v, i) => (
              <div key={i}>
                <div className="kv"><span className="k">Balance</span><span className="v">{money(v.balance)}</span></div>
                <div className="kv"><span className="k">Available</span><span className="v">{money(v.available_balance)}</span></div>
                <div className="kv"><span className="k">Holds</span><span className="v">{money(v.holds)}</span></div>
                <div className="kv"><span className="k">Accrued fees</span><span className="v">{money(v.accrued_partner_fees)}</span></div>
              </div>
            )) : <p className="muted">No vault data.</p>}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Collections due</h2>
            {collections?.items?.length ? (
              <>
                {collections.items.map((it) => (
                  <div className="kv" key={it.advance_id}>
                    <span className="k">{it.user_id} · {it.due_date}</span>
                    <span className="v">{fmt(it.amount, it.currency)}</span>
                  </div>
                ))}
                <div className="kv" style={{ marginTop: 6 }}>
                  <span className="k">Total</span>
                  <span className="v">{collections.totals.map(money).join(" · ")}</span>
                </div>
                <button className="ghost" onClick={repay} disabled={busy === "repay"}>
                  {busy === "repay" ? "Reporting…" : "Confirm collection (repay)"}
                </button>
                <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  Reports these as collected at payroll — repays the advances and
                  credits the amount back to the vault.
                </p>
              </>
            ) : <p className="muted">Nothing due.</p>}
          </div>
        </div>
      </div>

      <footer>
        Source: <code>examples/nextjs-demo</code> in{" "}
        <a href="https://github.com/free-doom/payslice-typescript-sdk">payslice-typescript-sdk</a>.
        Set <code>PAYSLICE_KEY_ID</code> / <code>PAYSLICE_SECRET</code> to switch from mock to the live sandbox.
      </footer>
    </div>
  );
}

function money(m: Money): string {
  return fmt(m.amount, m.currency);
}
