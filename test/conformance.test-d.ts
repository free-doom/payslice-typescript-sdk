/**
 * Type-level conformance: the hand-authored public types in `src/types.ts`
 * must be structurally interchangeable with the types generated from
 * `openapi.yaml` (`src/generated/types.ts`). This file is checked by
 * `tsc --noEmit` (the `typecheck` / `lint` script), not by vitest — its
 * filename intentionally avoids the `.test.ts` pattern so the runner skips
 * it. A drift in any shared schema (a renamed field, a wrong enum member, a
 * changed nullability) makes one of the assignments below fail to compile.
 *
 * Scope: the NAMED OpenAPI schemas only. Types the SDK invents around
 * inlined operation shapes (list-query params, `AdvancePage`,
 * `ConfirmDisbursementRequest`, the webhook event union) have no generated
 * counterpart and are covered by runtime tests instead.
 */
import type { components } from "../src/generated/types.js";
import type {
  Advance,
  AdvanceRequest,
  AdvanceStatus,
  CollectionConfirmation,
  CollectionResult,
  CollectionsDue,
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
