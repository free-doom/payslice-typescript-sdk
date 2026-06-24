import type { Transport } from "../core/transport.js";
import { Paginator } from "../core/pagination.js";
import {
  IDEMPOTENCY_KEY_HEADER,
  resolveIdempotencyKey,
} from "../core/idempotency.js";
import type {
  Advance,
  AdvancePage,
  AdvanceRequest,
  ConfirmDisbursementRequest,
  ListAdvancesParams,
} from "../types.js";

export interface CreateAdvanceOptions {
  /**
   * Idempotency key for this advance. The API requires one; the SDK
   * auto-generates a UUID when omitted. Supply your own to make a retry
   * replay the original advance instead of creating a second one.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class Advances {
  constructor(private readonly transport: Transport) {}

  /** Release funds against an approved quote. `POST /v1/advances`. */
  async create(
    request: AdvanceRequest,
    options: CreateAdvanceOptions = {},
  ): Promise<Advance> {
    const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);
    return this.transport.request<Advance>({
      method: "POST",
      path: "/v1/advances",
      body: request,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      // A stable idempotency key makes the POST safe to retry: the server
      // replays the original response rather than re-executing.
      retryable: true,
      signal: options.signal,
    });
  }

  /** Retrieve a specific advance. `GET /v1/advances/{id}`. */
  async get(
    advanceId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<Advance> {
    return this.transport.request<Advance>({
      method: "GET",
      path: `/v1/advances/${encodeURIComponent(advanceId)}`,
      signal: options.signal,
    });
  }

  /** Fetch a single page of advances. `GET /v1/advances`. */
  async listPage(params: ListAdvancesParams = {}): Promise<AdvancePage> {
    return this.transport.request<AdvancePage>({
      method: "GET",
      path: "/v1/advances",
      query: {
        company_id: params.company_id,
        user_id: params.user_id,
        status: params.status,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
  }

  /**
   * Iterate advances across all pages.
   *
   *   for await (const advance of payslice.advances.list({ company_id })) { ... }
   */
  list(params: ListAdvancesParams = {}): Paginator<Advance> {
    return new Paginator<Advance>((cursor) =>
      this.listPage({ ...params, cursor }),
    );
  }

  /**
   * Confirm (or fail) a partner-executed disbursement.
   * `POST /v1/advances/{id}/disbursement`.
   */
  async confirmDisbursement(
    advanceId: string,
    request: ConfirmDisbursementRequest,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<Advance> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey !== undefined) {
      headers[IDEMPOTENCY_KEY_HEADER] = resolveIdempotencyKey(
        options.idempotencyKey,
      );
    }
    return this.transport.request<Advance>({
      method: "POST",
      path: `/v1/advances/${encodeURIComponent(advanceId)}/disbursement`,
      body: request,
      headers,
      retryable: options.idempotencyKey !== undefined,
      signal: options.signal,
    });
  }
}
