export { Payslice, type PaysliceOptions } from "./client.js";

// Resource option types
export type { CreateQuoteOptions } from "./resources/quotes.js";
export type { CreateAdvanceOptions } from "./resources/advances.js";

// Pagination
export { Paginator, type CursorPage } from "./core/pagination.js";

// Errors
export {
  PaysliceError,
  PaysliceApiError,
  PaysliceConnectionError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ValidationError,
  IdempotencyConflictError,
  QuoteExpiredError,
  InsufficientVaultBalanceError,
  ExposureLimitReachedError,
  UserAdvanceCapReachedError,
  ConflictError,
  ServiceUnavailableError,
  InternalServerError,
  type ApiErrorBody,
} from "./core/errors.js";

// Webhooks
export {
  constructEvent,
  verifySignature,
  pathAndQuery,
  WebhookVerificationError,
  type WebhookEvent,
  type WebhookEventType,
  type VaultLowBalanceData,
  type VerifyOptions,
  type HeaderInput,
} from "./webhooks.js";

// Low-level signing primitives (advanced use)
export {
  signRequest,
  canonicalString,
  EMPTY_BODY_SHA256,
  type SignedHeaders,
} from "./core/signing.js";

// Wire types
export type * from "./types.js";
