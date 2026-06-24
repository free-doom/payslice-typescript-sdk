import { Transport } from "./core/transport.js";
import { Advances } from "./resources/advances.js";
import { Collections } from "./resources/collections.js";
import { Quotes } from "./resources/quotes.js";
import { VaultResource } from "./resources/vault.js";
import {
  constructEvent,
  verifySignature,
  type VerifyOptions,
  type WebhookEvent,
} from "./webhooks.js";

export interface PaysliceOptions {
  /** Public key id (`X-Payslice-Key-Id`). */
  keyId: string;
  /** HMAC signing secret paired with `keyId`. */
  secret: string;
  /**
   * API base URL, e.g. `https://sandbox-api.payslice.com`. No default: the
   * environment must be chosen explicitly so a key is never sent to the
   * wrong host.
   */
  baseUrl: string;
  /** Custom `fetch` (defaults to the runtime global). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 30_000). */
  timeoutMs?: number;
  /** Max retries for transient failures (default 2). */
  maxRetries?: number;
}

/**
 * Client for the Payslice Earned Wage Access partner API.
 *
 *   const payslice = new Payslice({
 *     keyId: process.env.PAYSLICE_KEY_ID!,
 *     secret: process.env.PAYSLICE_SECRET!,
 *     baseUrl: "https://sandbox-api.payslice.com",
 *   });
 *
 *   const quote = await payslice.quotes.create({ ... });
 */
export class Payslice {
  readonly quotes: Quotes;
  readonly advances: Advances;
  readonly collections: Collections;
  readonly vault: VaultResource;

  /**
   * Webhook helpers. These are static-style utilities (they need only the
   * endpoint secret, not API credentials) and are also exported standalone
   * from the package root.
   */
  readonly webhooks = {
    constructEvent: (opts: VerifyOptions): Promise<WebhookEvent> =>
      constructEvent(opts),
    verifySignature: (opts: VerifyOptions): Promise<string> =>
      verifySignature(opts),
  };

  constructor(options: PaysliceOptions) {
    if (!options.keyId) throw new Error("Payslice: `keyId` is required.");
    if (!options.secret) throw new Error("Payslice: `secret` is required.");
    if (!options.baseUrl) throw new Error("Payslice: `baseUrl` is required.");

    const transport = new Transport({
      keyId: options.keyId,
      secret: options.secret,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });

    this.quotes = new Quotes(transport);
    this.advances = new Advances(transport);
    this.collections = new Collections(transport);
    this.vault = new VaultResource(transport);
  }
}
