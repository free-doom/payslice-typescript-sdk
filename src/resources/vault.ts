import type { Transport } from "../core/transport.js";
import type { VaultResponse } from "../types.js";

export class VaultResource {
  constructor(private readonly transport: Transport) {}

  /** Get the Payslice vault balances on the partner ledger. `GET /v1/vault`. */
  async get(options: { signal?: AbortSignal } = {}): Promise<VaultResponse> {
    return this.transport.request<VaultResponse>({
      method: "GET",
      path: "/v1/vault",
      signal: options.signal,
    });
  }
}
