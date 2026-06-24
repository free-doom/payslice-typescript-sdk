import type { Transport } from "../core/transport.js";
import {
  IDEMPOTENCY_KEY_HEADER,
  resolveIdempotencyKey,
} from "../core/idempotency.js";
import type { Quote, QuoteRequest } from "../types.js";

export interface CreateQuoteOptions {
  /** Optional on quotes; honored for safe retries when supplied. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class Quotes {
  constructor(private readonly transport: Transport) {}

  /** Request an advance quote for an employee. `POST /v1/quotes`. */
  async create(
    request: QuoteRequest,
    options: CreateQuoteOptions = {},
  ): Promise<Quote> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey !== undefined) {
      headers[IDEMPOTENCY_KEY_HEADER] = resolveIdempotencyKey(
        options.idempotencyKey,
      );
    }
    return this.transport.request<Quote>({
      method: "POST",
      path: "/v1/quotes",
      body: request,
      headers,
      retryable: options.idempotencyKey !== undefined,
      signal: options.signal,
    });
  }

  /** Retrieve a previously created quote. `GET /v1/quotes/{id}`. */
  async get(quoteId: string, options: { signal?: AbortSignal } = {}): Promise<Quote> {
    return this.transport.request<Quote>({
      method: "GET",
      path: `/v1/quotes/${encodeURIComponent(quoteId)}`,
      signal: options.signal,
    });
  }
}
