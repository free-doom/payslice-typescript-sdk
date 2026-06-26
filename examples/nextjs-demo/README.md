# Payslice EWA — Next.js SDK Demo

A small, runnable reference integration for [`@payslice/sdk`](https://www.npmjs.com/package/@payslice/sdk) using **Next.js (App Router)**. It walks the core Earned Wage Access flow — **quote → advance → confirm disbursement** — plus live vault balances, collections due, and a webhook receiver.

The key pattern it demonstrates: **every Payslice call runs server-side** in `app/api/*` route handlers. The HMAC signing secret never reaches the browser.

## Run it

```sh
npm install
npm run dev
# open http://localhost:3000
```

With no credentials set it runs in **mock mode** — fully interactive, no network, no keys — so you can see the flow immediately.

### Point it at the live sandbox

```sh
cp .env.example .env.local
# fill in PAYSLICE_KEY_ID and PAYSLICE_SECRET from the partner portal
npm run dev
```

The banner switches from `MOCK MODE` to `LIVE`. Nothing else changes — the route handlers call the same SDK methods either way.

## What's where

| File | Shows |
| --- | --- |
| `lib/payslice.ts` | Server-only SDK client factory + error → HTTP mapping |
| `app/api/quote/route.ts` | `quotes.create()` |
| `app/api/advance/route.ts` | `advances.create()` (auto-idempotency) |
| `app/api/advance/[id]/confirm/route.ts` | `advances.confirmDisbursement()` |
| `app/api/vault/route.ts` | `vault.get()` |
| `app/api/collections/route.ts` | `collections.listDuePage()` |
| `app/api/webhooks/payslice/route.ts` | `constructEvent()` over the **raw** body |
| `lib/mock.ts` | Canned responses (typed with the SDK's own types) for zero-setup mode |
| `app/page.tsx` | The UI driving the flow via `fetch` to the routes above |

## Crypto custody payout (`/crypto`)

A second page that tests the **crypto settlement** end-to-end: a signed
authorization → the Vault/Rail service has its **AWS-KMS delegate** sign an
Allowance-Module transfer → a **powerless relayer** broadcasts it, moving an
ERC-20 out of a **2-of-3 Safe** on Base Sepolia. It reuses the SDK's
`signRequest` primitive (the Vault/Rail uses the same HMAC scheme as the EWA
API) and, since the rail exposes no GET status endpoint, reads the settlement
back **off-chain** with `viem` — watching for the `Transfer` to a fresh
recipient address generated per run.

| File | Shows |
| --- | --- |
| `lib/vault-rail.ts` | Signed `POST /v1/payout-authorizations` via the SDK's `signRequest` |
| `lib/chain.ts` | `viem` scan for the settlement `Transfer` (no status endpoint needed) |
| `app/api/crypto/payout/route.ts` | Authorize a payout (captures the chain head to bound the scan) |
| `app/api/crypto/settlement/route.ts` | Read the on-chain settlement back + build the explorer link |
| `lib/crypto-mock.ts` | Canned reserved→confirmed responses for zero-setup mock mode |
| `app/crypto/page.tsx` | The UI: amount + recipient → live `reserved → settling → confirmed` + tx link |

Runs in **mock mode** with no setup. To go live against a real Vault/Rail
deployment, fill the `VAULT_RAIL_*` + `BASE_SEPOLIA_RPC_URL` vars in
`.env.local` (see `.env.example`). The rail's API is private, so reach it with
an SSH tunnel and point `VAULT_RAIL_BASE_URL` at the local end:

```sh
ssh -i <key>.pem -L 8090:127.0.0.1:8090 ubuntu@<box-ip>   # in a separate shell
# .env.local: VAULT_RAIL_BASE_URL=http://127.0.0.1:8090
```

> A **fresh throwaway recipient is generated for each disbursement** (so the
> settlement scan is unambiguous), so the settled mock tokens aren't recoverable —
> fine for a testnet proof.

> **⚠️ Security.** The live `/api/crypto/payout` route signs real (testnet) Vault/Rail
> payouts with server-side credentials, so it is **disabled by default and fails
> closed** (`Host` is not trusted — it's spoofable). Enable it deliberately:
> set **`CRYPTO_DEMO_TOKEN`** for a real bearer-token gate (programmatic callers /
> your own auth in front), or **`VAULT_RAIL_ALLOW_REMOTE=1`** to run an
> intentionally-public, cap-bounded demo (also the switch for live mode in local
> dev). Payouts are always capped at `VAULT_RAIL_MAX_AMOUNT_MINOR`.

## Webhooks

Point a registered Payslice webhook endpoint at `/api/webhooks/payslice` and set:

```
PAYSLICE_WEBHOOK_SECRET=whsec_...
PAYSLICE_WEBHOOK_URL=https://your-deployment/api/webhooks/payslice
```

The handler verifies the signature against the **raw** request body (`await req.text()`) and narrows the event by `type`. Verifying against re-serialized JSON would fail — see the comment in the route.

## Deploy

Deploys to any Node host. On Vercel, set the same env vars in the project settings (not in the repo) and the live demo will use your sandbox partner.

> All amounts are integers in **minor units (cents)**.
