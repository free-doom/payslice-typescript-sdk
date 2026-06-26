# @payslice/sdk

Official TypeScript SDK for the **Payslice Earned Wage Access (EWA)** partner API (`/v1`).

It handles the parts that are easy to get wrong — HMAC request signing, idempotency keys, cursor pagination, typed errors, and webhook signature verification — so you write business logic, not crypto.

- **Universal runtime** — Node 18+, Deno, Bun, edge, and browsers (built on Web Crypto + `fetch`, zero dependencies).
- **Fully typed** — request/response types mirror the OpenAPI contract 1:1.
- **Drop-in webhooks** — verify and narrow inbound events with one call.

## 🚀 Live demo

**[payslice-sdk-demo.vercel.app](https://payslice-sdk-demo.vercel.app)** — a Next.js app running against the live sandbox. Walk the full lifecycle in the browser: quote → advance → confirm → repay, with live vault and collections. Source: [`examples/nextjs-demo`](./examples/nextjs-demo).

## Install

```sh
npm install @payslice/sdk
```

## Quick start

```ts
import { Payslice } from "@payslice/sdk";

const payslice = new Payslice({
  keyId: process.env.PAYSLICE_KEY_ID!,
  secret: process.env.PAYSLICE_SECRET!,
  baseUrl: "https://sandbox-api.payslice.com", // prod: https://api.payslice.com
});

const quote = await payslice.quotes.create({
  user_id: "employee_42",
  company_id: "employer_7",
  contract: { id: "contract_1", start_date: "2024-01-15" },
  salary: { amount: 500_000, currency: "USD", frequency: "monthly" },
});

if (quote.approved) {
  const advance = await payslice.advances.create({
    quote_id: quote.id,
    user_id: quote.user_id,
    amount: 20_000,
    currency: quote.currency!,
    destination_account_id: "partner_ledger_acct_99",
    due_date: "2026-07-31",
  });
}
```

Authentication (the three `X-Payslice-*` signature headers and the request timestamp) is applied automatically on every call.

> All monetary amounts are integers in **minor units (cents)**.

## Resources

| Call | Endpoint |
| --- | --- |
| `quotes.create()` / `quotes.get(id)` | `POST/GET /v1/quotes` |
| `advances.create()` | `POST /v1/advances` |
| `advances.get(id)` / `advances.list()` / `advances.listPage()` | `GET /v1/advances` |
| `advances.confirmDisbursement(id, …)` | `POST /v1/advances/{id}/disbursement` |
| `collections.listDue()` / `collections.listDuePage()` | `GET /v1/collections/due` |
| `collections.confirm(…)` | `POST /v1/collections` |
| `vault.get()` | `GET /v1/vault` |

## Idempotency

`advances.create()` and `collections.confirm()` require an idempotency key. The SDK generates a UUID per call automatically; pass your own to make a retry **replay the original result** instead of creating a duplicate:

```ts
await payslice.advances.create(req, { idempotencyKey: orderId });
```

## Pagination

List methods return an async iterator that fetches pages lazily:

```ts
for await (const advance of payslice.advances.list({ company_id: "employer_7" })) {
  console.log(advance.id, advance.status);
}
```

Use `listPage()` / `listDuePage()` for manual cursor control (and to read per-page `totals` on collections).

## Errors

Every non-2xx response throws a typed subclass of `PaysliceError`, selected on the API error `code`:

```ts
import { QuoteExpiredError, InsufficientVaultBalanceError } from "@payslice/sdk";

try {
  await payslice.advances.create(req);
} catch (err) {
  if (err instanceof QuoteExpiredError) { /* request a fresh quote */ }
  else if (err instanceof InsufficientVaultBalanceError) { /* top up */ }
  else throw err;
}
```

Each error exposes `code`, `message`, `status`, `details`, and `requestId`.

## Webhooks

Verify the signature and get a typed, narrowed event. **Always verify against the raw request body** — re-serialized JSON will not match the signature.

```ts
import { constructEvent } from "@payslice/sdk";

const event = await constructEvent({
  payload: rawBody,        // string or Buffer, exactly as received
  headers: req.headers,
  secret: process.env.PAYSLICE_WEBHOOK_SECRET!,
  endpointUrl: "https://partner.example/webhooks/payslice", // your REGISTERED URL
});

switch (event.type) {
  case "advance.released": /* event.data: Advance */ break;
  case "collection.due":   /* event.data: CollectionsDue */ break;
}
```

See [`examples/webhook-express.ts`](./examples/webhook-express.ts) for a full Express handler.

## Examples

- [`examples/nextjs-demo`](./examples/nextjs-demo) — a runnable **Next.js** reference app covering the full lifecycle (quote → advance → confirm → repay) with vault, collections, and a webhook receiver. **[Live demo →](https://payslice-sdk-demo.vercel.app)** Runs in mock mode with zero setup, or against the live sandbox when credentials are set.
- [`examples/quickstart.ts`](./examples/quickstart.ts) — the core flow as a single script.
- [`examples/webhook-express.ts`](./examples/webhook-express.ts) — webhook verification with Express.

## Development

```sh
npm install
npm run generate   # regenerate src/generated/types.ts from openapi.yaml
npm test
npm run build
```

`openapi.yaml` is vendored from the API repo. CI runs `generate:check` to fail on drift between the spec and the generated types, and `typecheck` runs a type-level conformance test (`test/conformance.test-d.ts`) asserting the public types stay interchangeable with the generated ones.

> `baseUrl` must be the host **without** a `/v1` suffix (the SDK adds it). Use `https://sandbox-api.payslice.com`, not `.../v1`.

## Releasing

Publishing is automated. Bump the version, tag, and push — CI runs the full
gate (spec drift-check, typecheck, tests, build) and publishes to npm:

```sh
npm version patch   # or minor / major — updates package.json and creates the tag
git push --follow-tags
```

The npm credential lives only in the repo secret `NPM_TOKEN`; nobody publishes
from a laptop.

## License

[MIT](./LICENSE)
