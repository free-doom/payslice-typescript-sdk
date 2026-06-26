/**
 * Type-level conformance: the hand-authored public types in `src/types.ts`
 * must be structurally interchangeable with the types generated from
 * `openapi.yaml` (`src/generated/types.ts`). This file is checked by
 * `tsc --noEmit` (the `typecheck` / `lint` script), not by vitest — its
 * filename intentionally avoids the `.test.ts` pattern so the runner skips
 * it. A drift in any shared schema (a renamed field, a wrong enum member, a
 * changed nullability) makes one of the assignments below fail to compile.
 *
 * Scope: the named OpenAPI schemas the SDK exposes as a 1:1 wire type.
 * Intentionally excluded:
 *  - Schemas the SDK invents around inlined operation shapes (list-query
 *    params, `AdvancePage`, `ConfirmDisbursementRequest`) — no generated
 *    counterpart.
 *  - `WebhookEnvelope` — the SDK deliberately models this as the
 *    discriminated `WebhookEvent` union (concrete `data` per `type`), not a
 *    structural mirror, so it is covered by runtime webhook tests instead.
 *  - `Error` — the SDK's `ApiErrorBody` is intentionally not interchangeable:
 *    its `details` is `Record<string, unknown> | null` (we normalize missing
 *    to null), whereas the generated `details` is a non-null index signature.
 *
 * The discriminated-union section below also guards `ConfirmDisbursementRequest`
 * against regressions with `@ts-expect-error` compile-failure assertions.
 */
import type { components } from "../src/generated/types.js";
import type {
  Advance,
  AdvanceRequest,
  AdvanceStatus,
  CollectionConfirmation,
  CollectionResult,
  CollectionsDue,
  ConfirmDisbursementRequest,
  CryptoTransfer,
  Money,
  PayoutDestination,
  Quote,
  QuoteRequest,
  Vault,
  VaultResponse,
} from "../src/types.js";

type Schemas = components["schemas"];

/** Asserts `Public` and `Generated` are mutually assignable. */
function bothWays<Public, Generated>(
  _checks: [Public] extends [Generated]
    ? [Generated] extends [Public]
      ? true
      : ["generated not assignable to public"]
    : ["public not assignable to generated"],
): void {
  void _checks;
}

bothWays<Money, Schemas["Money"]>(true);
bothWays<QuoteRequest, Schemas["QuoteRequest"]>(true);
bothWays<Quote, Schemas["Quote"]>(true);
bothWays<AdvanceRequest, Schemas["AdvanceRequest"]>(true);
bothWays<AdvanceStatus, Schemas["AdvanceStatus"]>(true);
bothWays<Advance, Schemas["Advance"]>(true);
bothWays<PayoutDestination, Schemas["PayoutDestination"]>(true);
bothWays<CryptoTransfer, Schemas["CryptoTransfer"]>(true);
bothWays<CollectionsDue, Schemas["CollectionsDue"]>(true);
bothWays<CollectionConfirmation, Schemas["CollectionConfirmation"]>(true);
bothWays<CollectionResult, Schemas["CollectionResult"]>(true);
bothWays<VaultResponse, Schemas["VaultResponse"]>(true);
bothWays<Vault, Schemas["Vault"]>(true);

// --- ConfirmDisbursementRequest discriminated-union guards ----------------
// Valid bodies must compile; invalid ones must NOT. The `@ts-expect-error`
// lines fail the build if the union ever loosens to accept them.

const _executedOk: ConfirmDisbursementRequest = {
  status: "executed",
  transfer_ref: "tr_1",
};
const _failedOk: ConfirmDisbursementRequest = {
  status: "failed",
  failure_reason: "account_closed",
};
// @ts-expect-error executed body requires transfer_ref
const _executedMissingRef: ConfirmDisbursementRequest = { status: "executed" };
// @ts-expect-error failed body requires failure_reason
const _failedMissingReason: ConfirmDisbursementRequest = { status: "failed" };
// prettier-ignore
// @ts-expect-error failed body must not carry transfer_ref
const _failedWithRef: ConfirmDisbursementRequest = { status: "failed", failure_reason: "other", transfer_ref: "tr_1" };
void _executedOk;
void _failedOk;
void _executedMissingRef;
void _failedMissingReason;
void _failedWithRef;
