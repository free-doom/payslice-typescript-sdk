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
