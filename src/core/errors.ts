/**
 * Typed error hierarchy mapping the API's `{ code, message, details }`
 * error body (see `src/error.rs`) onto catchable classes keyed on `code`.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

/** Base class for every error surfaced by the SDK. */
export class PaysliceError extends Error {
  /** Machine-readable code from the API, or an SDK-level code. */
  readonly code: string;
  /** HTTP status, when the error originated from a response. */
  readonly status?: number;
  /** Structured detail payload, when the API provided one. */
  readonly details?: Record<string, unknown> | null;
  /** Value of the `X-Payslice-Request-Id` response header, when present. */
  readonly requestId?: string;

  constructor(
    message: string,
    opts: {
      code: string;
      status?: number;
      details?: Record<string, unknown> | null;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
    this.requestId = opts.requestId;
  }
}

/** Network failure, timeout, or aborted request — no HTTP response received. */
export class PaysliceConnectionError extends PaysliceError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "connection_error" });
    if (cause !== undefined) this.cause = cause;
  }
}

/** A non-2xx HTTP response carrying a structured API error body. */
export class PaysliceApiError extends PaysliceError {}

// --- Specific subclasses, selected on the API `code` ---------------------

/** 401 — missing/invalid signature, or timestamp outside the ±300s window. */
export class AuthenticationError extends PaysliceApiError {}
/** 403 — partner suspended/offboarded, releases paused, or insufficient role. */
export class PermissionError extends PaysliceApiError {}
/** 404 — resource not found. */
export class NotFoundError extends PaysliceApiError {}
/** 422 — request failed validation. */
export class ValidationError extends PaysliceApiError {}
/** 409 — `Idempotency-Key` reused with a different payload. */
export class IdempotencyConflictError extends PaysliceApiError {}
/** 410 — the quote is past its 4-hour expiry. */
export class QuoteExpiredError extends PaysliceApiError {}
/** 402 — vault balance cannot cover the advance. */
export class InsufficientVaultBalanceError extends PaysliceApiError {}
/** 402 — partner exposure limit reached. */
export class ExposureLimitReachedError extends PaysliceApiError {}
/** 402 — per-user advance cap reached. */
export class UserAdvanceCapReachedError extends PaysliceApiError {}
/** 409 — generic conflict not covered by a more specific subclass. */
export class ConflictError extends PaysliceApiError {}
/** 503 — Vault/Rail or the service is temporarily unavailable. */
export class ServiceUnavailableError extends PaysliceApiError {}
/** 5xx — unexpected server error. */
export class InternalServerError extends PaysliceApiError {}

const CODE_TO_CLASS: Record<string, typeof PaysliceApiError> = {
  unauthorized: AuthenticationError,
  forbidden: PermissionError,
  releases_paused: PermissionError,
  not_found: NotFoundError,
  quote_expired: QuoteExpiredError,
  insufficient_vault_balance: InsufficientVaultBalanceError,
  exposure_limit_reached: ExposureLimitReachedError,
  user_advance_cap_reached: UserAdvanceCapReachedError,
  idempotency_key_conflict: IdempotencyConflictError,
};

/**
 * Build the most specific error subclass for an API response. Selection is
 * primarily by `code`; HTTP status is the fallback so unknown codes still
 * land on a sensible class.
 */
export function errorFromResponse(
  status: number,
  body: ApiErrorBody,
  requestId?: string,
): PaysliceApiError {
  const opts = {
    code: body.code,
    status,
    details: body.details ?? null,
    requestId,
  };

  const ByCode = CODE_TO_CLASS[body.code];
  if (ByCode) return new ByCode(body.message, opts);

  let ByStatus: typeof PaysliceApiError;
  if (status === 401) ByStatus = AuthenticationError;
  else if (status === 403) ByStatus = PermissionError;
  else if (status === 404) ByStatus = NotFoundError;
  else if (status === 402) ByStatus = InsufficientVaultBalanceError;
  else if (status === 409) ByStatus = ConflictError;
  else if (status === 410) ByStatus = QuoteExpiredError;
  else if (status === 422) ByStatus = ValidationError;
  else if (status === 503) ByStatus = ServiceUnavailableError;
  else if (status >= 500) ByStatus = InternalServerError;
  else ByStatus = PaysliceApiError;

  return new ByStatus(body.message, opts);
}
