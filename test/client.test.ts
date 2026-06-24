import { describe, expect, it, vi } from "vitest";
import { Payslice } from "../src/client.js";
import {
  InsufficientVaultBalanceError,
  PaymentRequiredError,
  QuoteExpiredError,
  ReleasesPausedError,
  ValidationError,
} from "../src/core/errors.js";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function mockFetch(
  responder: (req: Recorded, call: number) => {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  },
) {
  const calls: Recorded[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers as Record<string, string>) ?? {}),
    );
    const recorded: Recorded = {
      url,
      method: init.method ?? "GET",
      headers,
      body: init.body as string | undefined,
    };
    calls.push(recorded);
    const r = responder(recorded, calls.length);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...r.headers },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function client(fetchImpl: typeof fetch) {
  return new Payslice({
    keyId: "key_123",
    secret: "secret_abc",
    baseUrl: "https://sandbox-api.payslice.com",
    fetch: fetchImpl,
  });
}

describe("signed requests", () => {
  it("attaches the three signature headers and the base URL", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: { vaults: [] },
    }));
    await client(fetchImpl).vault.get();

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://sandbox-api.payslice.com/v1/vault");
    expect(call.headers["X-Payslice-Key-Id"]).toBe("key_123");
    expect(call.headers["X-Payslice-Timestamp"]).toMatch(/^\d+$/);
    expect(call.headers["X-Payslice-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
  });
});

describe("idempotency", () => {
  it("auto-generates an Idempotency-Key for advances.create", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { id: "adv_1", status: "approved" },
    }));
    await client(fetchImpl).advances.create({
      quote_id: "qt_1",
      user_id: "u_1",
      amount: 5000,
      currency: "USD",
      due_date: "2026-07-01",
    });
    expect(calls[0]!.headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("honors a caller-supplied Idempotency-Key", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 201,
      body: { id: "adv_1" },
    }));
    await client(fetchImpl).advances.create(
      {
        quote_id: "qt_1",
        user_id: "u_1",
        amount: 5000,
        currency: "USD",
        due_date: "2026-07-01",
      },
      { idempotencyKey: "my-key-123" },
    );
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("my-key-123");
  });
});

describe("error mapping", () => {
  it("maps quote_expired (410) to QuoteExpiredError", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 410,
      body: { code: "quote_expired", message: "Quote expired" },
      headers: { "x-payslice-request-id": "req_42" },
    }));
    await expect(client(fetchImpl).quotes.get("qt_1")).rejects.toMatchObject({
      constructor: QuoteExpiredError,
      code: "quote_expired",
      status: 410,
      requestId: "req_42",
    });
  });

  it("maps insufficient_vault_balance (402)", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 402,
      body: { code: "insufficient_vault_balance", message: "no funds" },
    }));
    await expect(
      client(fetchImpl).advances.create({
        quote_id: "qt_1",
        user_id: "u_1",
        amount: 5000,
        currency: "USD",
        due_date: "2026-07-01",
      }),
    ).rejects.toBeInstanceOf(InsufficientVaultBalanceError);
  });

  it("maps 422 to ValidationError with details", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 422,
      body: {
        code: "invalid_request",
        message: "bad",
        details: { field: "amount" },
      },
    }));
    await expect(client(fetchImpl).quotes.get("qt_1")).rejects.toMatchObject({
      constructor: ValidationError,
      details: { field: "amount" },
    });
  });

  it("maps releases_paused (403) to ReleasesPausedError, not PermissionError", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 403,
      body: { code: "releases_paused", message: "paused" },
    }));
    await expect(
      client(fetchImpl).advances.create({
        quote_id: "qt_1",
        user_id: "u_1",
        amount: 5000,
        currency: "USD",
        due_date: "2026-07-01",
      }),
    ).rejects.toBeInstanceOf(ReleasesPausedError);
  });

  it("maps an unknown 402 code to the neutral PaymentRequiredError", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 402,
      body: { code: "some_future_402", message: "nope" },
    }));
    const err = await client(fetchImpl)
      .quotes.get("qt_1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredError);
    expect(err).not.toBeInstanceOf(InsufficientVaultBalanceError);
  });
});

describe("confirmDisbursement", () => {
  it("does not auto-retry on a transient 503", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 503,
      body: { code: "service_unavailable", message: "down" },
    }));
    await expect(
      client(fetchImpl).advances.confirmDisbursement("adv_1", {
        status: "executed",
        transfer_ref: "tr_1",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it("sends no Idempotency-Key header", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      status: 200,
      body: { id: "adv_1", status: "released" },
    }));
    await client(fetchImpl).advances.confirmDisbursement("adv_1", {
      status: "failed",
      failure_reason: "account_closed",
    });
    expect(calls[0]!.headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("retries", () => {
  it("retries a 503 on GET, then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch((_req, call) =>
      call === 1
        ? { status: 503, body: { code: "service_unavailable", message: "down" } }
        : { status: 200, body: { vaults: [] } },
    );
    const result = await client(fetchImpl).vault.get();
    expect(result.vaults).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

describe("pagination", () => {
  it("walks every page via the async iterator", async () => {
    const { fetchImpl } = mockFetch((req) => {
      const url = new URL(req.url);
      const cursor = url.searchParams.get("cursor");
      if (!cursor) {
        return {
          status: 200,
          body: { items: [{ id: "adv_1" }, { id: "adv_2" }], next_cursor: "c2" },
        };
      }
      return { status: 200, body: { items: [{ id: "adv_3" }], next_cursor: null } };
    });

    const ids: string[] = [];
    for await (const advance of client(fetchImpl).advances.list({
      company_id: "co_1",
    })) {
      ids.push(advance.id);
    }
    expect(ids).toEqual(["adv_1", "adv_2", "adv_3"]);
  });
});
