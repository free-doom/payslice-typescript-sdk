import {
  PaysliceApiError,
  PaysliceConnectionError,
  TimeoutError,
  errorFromResponse,
  type ApiErrorBody,
} from "./errors.js";
import { signRequest } from "./signing.js";

const REQUEST_ID_HEADER = "x-payslice-request-id";

export interface TransportOptions {
  keyId: string;
  secret: string;
  baseUrl: string;
  /** Defaults to the runtime's global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Max automatic retries for transient failures. Default 2. */
  maxRetries?: number;
  /** Clock source (seconds). Overridable for testing. */
  now?: () => number;
}

export interface RequestSpec {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path beginning with `/`, e.g. `/v1/advances`. */
  path: string;
  /** Query parameters; `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON-serializable request body. */
  body?: unknown;
  /** Extra headers (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
  /** Whether this request may be safely retried. Default: true for GET. */
  retryable?: boolean;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

export class Transport {
  private readonly keyId: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;

  constructor(opts: TransportOptions) {
    this.keyId = opts.keyId;
    this.secret = opts.secret;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    const globalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    const resolved = opts.fetch ?? globalFetch;
    if (!resolved) {
      throw new Error(
        "No `fetch` implementation found. Provide one via the `fetch` option or use a runtime with global fetch (Node 18+).",
      );
    }
    this.fetchImpl = resolved;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    const pathAndQuery = buildPathAndQuery(spec.path, spec.query);
    const bodyString =
      spec.body === undefined ? "" : JSON.stringify(spec.body);
    const retryable = spec.retryable ?? spec.method === "GET";

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.attempt<T>(spec, pathAndQuery, bodyString);
      } catch (error) {
        // A caller-initiated abort is final: surface the original error
        // (which carries the cause) rather than retrying into a generic one.
        if (spec.signal?.aborted) throw error;
        const canRetry =
          retryable &&
          attempt < this.maxRetries &&
          isRetryable(error);
        if (!canRetry) throw error;
        await delay(backoffMs(attempt), spec.signal);
        attempt += 1;
      }
    }
  }

  private async attempt<T>(
    spec: RequestSpec,
    pathAndQuery: string,
    bodyString: string,
  ): Promise<T> {
    // Sign per attempt: the timestamp must stay inside the server's window.
    const signed = await signRequest({
      keyId: this.keyId,
      secret: this.secret,
      timestamp: this.now(),
      method: spec.method,
      pathAndQuery,
      body: bodyString,
    });

    const headers: Record<string, string> = {
      accept: "application/json",
      ...signed,
      ...spec.headers,
    };
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    spec.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : bodyString,
        signal: controller.signal,
      });
    } catch (cause) {
      // Attribute the abort: our own timeout vs. the caller's signal.
      if (timedOut) {
        throw new TimeoutError(
          `Request to ${spec.method} ${spec.path} timed out after ${this.timeoutMs}ms.`,
        );
      }
      if (spec.signal?.aborted) {
        throw new PaysliceConnectionError(
          `Request to ${spec.method} ${spec.path} was aborted.`,
          cause,
        );
      }
      throw new PaysliceConnectionError(
        `Request to ${spec.method} ${spec.path} failed: ${stringifyError(cause)}`,
        cause,
      );
    } finally {
      clearTimeout(timeout);
      spec.signal?.removeEventListener("abort", onAbort);
    }

    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const text = await response.text();

    if (!response.ok) {
      throw errorFromResponse(response.status, parseErrorBody(text), requestId);
    }

    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }
}

function buildPathAndQuery(
  path: string,
  query?: RequestSpec["query"],
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function parseErrorBody(text: string): ApiErrorBody {
  try {
    const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
    if (parsed && typeof parsed.code === "string") {
      return {
        code: parsed.code,
        message:
          typeof parsed.message === "string" ? parsed.message : parsed.code,
        details: parsed.details ?? null,
      };
    }
  } catch {
    // Non-JSON error body (e.g. a proxy 502 HTML page); fall through.
  }
  return { code: "unknown_error", message: text || "Unknown error", details: null };
}

function isRetryable(error: unknown): boolean {
  if (error instanceof PaysliceConnectionError) return true;
  if (error instanceof PaysliceApiError) {
    return error.status !== undefined && RETRYABLE_STATUS.has(error.status);
  }
  return false;
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1s, ... with a small deterministic jitter by attempt.
  const base = 250 * 2 ** attempt;
  return Math.min(base, 4_000) + attempt * 25;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PaysliceConnectionError("Request aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new PaysliceConnectionError("Request aborted"));
      },
      { once: true },
    );
  });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
