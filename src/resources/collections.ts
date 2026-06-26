import type { Transport } from "../core/transport.js";
import { Paginator } from "../core/pagination.js";
import {
  IDEMPOTENCY_KEY_HEADER,
  resolveIdempotencyKey,
} from "../core/idempotency.js";
import type {
  CollectionDueItem,
  CollectionConfirmation,
  CollectionsDue,
  ConfirmCollectionsResponse,
  ListCollectionsDueParams,
} from "../types.js";

export class Collections {
  constructor(private readonly transport: Transport) {}

  /** Fetch a single page of amounts due. `GET /v1/collections/due`. */
  async listDuePage(
    params: ListCollectionsDueParams = {},
  ): Promise<CollectionsDue> {
    return this.transport.request<CollectionsDue>({
      method: "GET",
      path: "/v1/collections/due",
      query: {
        company_id: params.company_id,
        user_id: params.user_id,
        due_before: params.due_before,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
  }

  /**
   * Iterate every outstanding collection item across all pages. Note that
   * `totals` is per-page; use {@link listDuePage} when you need the
   * aggregate `totals` for a filter.
   */
  listDue(params: ListCollectionsDueParams = {}): Paginator<CollectionDueItem> {
    return new Paginator<CollectionDueItem>((cursor) =>
      this.listDuePage({ ...params, cursor }),
    );
  }

  /** Report payroll deductions back to Payslice. `POST /v1/collections`. */
  async confirm(
    confirmation: CollectionConfirmation,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<ConfirmCollectionsResponse> {
    const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);
    return this.transport.request<ConfirmCollectionsResponse>({
      method: "POST",
      path: "/v1/collections",
      body: confirmation,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      retryable: true,
      signal: options.signal,
    });
  }
}
