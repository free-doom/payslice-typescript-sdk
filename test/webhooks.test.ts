import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  constructEvent,
  pathAndQuery,
  verifySignature,
  WebhookVerificationError,
} from "../src/webhooks.js";

const SECRET = "whsec_partner_secret";
const FIXED_NOW = 1_700_000_500;

/** Build a signed delivery exactly as the server's `sign_webhook` would. */
function signed(body: string, opts: { path?: string; timestamp?: number } = {}) {
  const timestamp = opts.timestamp ?? FIXED_NOW;
  const path = opts.path ?? "/";
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${timestamp}\nPOST\n${path}\n${bodyHash}`;
  const sig = createHmac("sha256", SECRET).update(canonical).digest("hex");
  return {
    body,
    headers: {
      "x-payslice-timestamp": String(timestamp),
      "x-payslice-signature": `v1=${sig}`,
    },
  };
}

describe("pathAndQuery (ported from the Rust signer)", () => {
  it("preserves slashes in root query values", () => {
    expect(pathAndQuery("https://partner.example?redirect=/hooks&env=test")).toBe(
      "/?redirect=/hooks&env=test",
    );
  });
  it("strips fragments before signing", () => {
    expect(pathAndQuery("https://partner.example/hooks#v1")).toBe("/hooks");
    expect(pathAndQuery("https://partner.example?env=test#v1")).toBe("/?env=test");
  });
  it("returns / for a bare host", () => {
    expect(pathAndQuery("https://partner.example")).toBe("/");
  });
  it("returns the full path with query", () => {
    expect(pathAndQuery("https://partner.example/a/b?x=1")).toBe("/a/b?x=1");
  });
});

describe("verifySignature", () => {
  it("accepts a valid signature within the tolerance window", async () => {
    const { body, headers } = signed(JSON.stringify({ type: "advance.released" }));
    await expect(
      verifySignature({ payload: body, headers, secret: SECRET, now: () => FIXED_NOW }),
    ).resolves.toBe(body);
  });

  it("rejects a tampered body", async () => {
    const { headers } = signed(JSON.stringify({ type: "advance.released" }));
    await expect(
      verifySignature({
        payload: JSON.stringify({ type: "advance.failed" }),
        headers,
        secret: SECRET,
        now: () => FIXED_NOW,
      }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects the wrong secret", async () => {
    const { body, headers } = signed(JSON.stringify({ type: "advance.released" }));
    await expect(
      verifySignature({ payload: body, headers, secret: "nope", now: () => FIXED_NOW }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const { body, headers } = signed(JSON.stringify({ type: "x" }), {
      timestamp: FIXED_NOW - 5000,
    });
    await expect(
      verifySignature({ payload: body, headers, secret: SECRET, now: () => FIXED_NOW }),
    ).rejects.toThrow(/tolerance/);
  });

  it("verifies against a non-root signed path", async () => {
    const path = "/webhooks/payslice";
    const { body, headers } = signed(JSON.stringify({ type: "x" }), { path });
    await expect(
      verifySignature({ payload: body, headers, secret: SECRET, path, now: () => FIXED_NOW }),
    ).resolves.toBe(body);
    // Wrong path → mismatch.
    await expect(
      verifySignature({ payload: body, headers, secret: SECRET, now: () => FIXED_NOW }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("derives the signed path from endpointUrl", async () => {
    const endpointUrl = "https://partner.example/webhooks/payslice";
    const { body, headers } = signed(JSON.stringify({ type: "x" }), {
      path: "/webhooks/payslice",
    });
    await expect(
      verifySignature({
        payload: body,
        headers,
        secret: SECRET,
        endpointUrl,
        now: () => FIXED_NOW,
      }),
    ).resolves.toBe(body);
  });
});

describe("constructEvent", () => {
  it("returns a typed, narrowed event", async () => {
    const advance = { id: "adv_1", status: "released" };
    const { body, headers } = signed(
      JSON.stringify({
        event_id: "evt_1",
        api_version: "v1",
        type: "advance.released",
        created_at: "2026-01-01T00:00:00Z",
        data: advance,
      }),
    );
    const event = await constructEvent({
      payload: body,
      headers,
      secret: SECRET,
      now: () => FIXED_NOW,
    });
    expect(event.type).toBe("advance.released");
    if (event.type === "advance.released") {
      expect(event.data.id).toBe("adv_1");
    }
  });

  it("throws on a body that isn't valid JSON", async () => {
    const { body, headers } = signed("not json");
    await expect(
      constructEvent({ payload: body, headers, secret: SECRET, now: () => FIXED_NOW }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});
