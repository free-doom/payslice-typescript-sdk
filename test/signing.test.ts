import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  canonicalString,
  signRequest,
  EMPTY_BODY_SHA256,
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "../src/core/signing.js";
import { sha256Hex, hmacSha256Hex } from "../src/core/crypto.js";

/**
 * Known-answer vector. The expected signature was produced by an
 * independent Node `crypto` oracle over the exact canonical string the Rust
 * server builds (`timestamp\nMETHOD\npath_and_query\nsha256_hex(body)`).
 * If this test fails, the SDK and server would disagree on signatures.
 */
const VECTOR = {
  secret: "whsec_test_secret",
  timestamp: 1_700_000_000,
  method: "POST",
  pathAndQuery: "/v1/quotes",
  body: JSON.stringify({ user_id: "u_1", company_id: "co_1" }),
  bodyHash:
    "4405006304515d4748690bc79dee5096366ba2c73ec9a1235d37b739bfa7984b",
  signature:
    "48af524a5636a23c7083c59d5993138e0c3c47711c5cf85d6d3b7ede30911b0e",
};

describe("canonicalString", () => {
  it("matches the server's exact format", async () => {
    const canonical = await canonicalString(
      VECTOR.timestamp,
      VECTOR.method,
      VECTOR.pathAndQuery,
      VECTOR.body,
    );
    expect(canonical).toBe(
      `1700000000\nPOST\n/v1/quotes\n${VECTOR.bodyHash}`,
    );
  });

  it("uses the well-known empty-string hash for empty bodies", async () => {
    const canonical = await canonicalString(1, "GET", "/v1/vault", "");
    expect(canonical).toBe(`1\nGET\n/v1/vault\n${EMPTY_BODY_SHA256}`);
    expect(await sha256Hex("")).toBe(EMPTY_BODY_SHA256);
  });

  it("upper-cases the method", async () => {
    const canonical = await canonicalString(1, "post", "/x", "");
    expect(canonical.split("\n")[1]).toBe("POST");
  });
});

describe("signRequest", () => {
  it("produces the known-answer signature and all three headers", async () => {
    const headers = await signRequest({
      keyId: "key_123",
      secret: VECTOR.secret,
      timestamp: VECTOR.timestamp,
      method: VECTOR.method,
      pathAndQuery: VECTOR.pathAndQuery,
      body: VECTOR.body,
    });
    expect(headers[KEY_ID_HEADER]).toBe("key_123");
    expect(headers[TIMESTAMP_HEADER]).toBe("1700000000");
    expect(headers[SIGNATURE_HEADER]).toBe(`v1=${VECTOR.signature}`);
  });

  it("agrees with an independent Node crypto oracle on random inputs", async () => {
    for (let i = 0; i < 25; i++) {
      const body = JSON.stringify({ i, nonce: `n-${i}-${i * 7}` });
      const ts = 1_700_000_000 + i;
      const path = `/v1/advances?limit=${i}`;
      const secret = `secret-${i}`;

      const bodyHash = createHash("sha256").update(body).digest("hex");
      const canonical = `${ts}\nPOST\n${path}\n${bodyHash}`;
      const expected = createHmac("sha256", secret)
        .update(canonical)
        .digest("hex");

      // Our Web Crypto path must match the Node crypto oracle.
      expect(await sha256Hex(body)).toBe(bodyHash);
      expect(await hmacSha256Hex(secret, canonical)).toBe(expected);

      const headers = await signRequest({
        keyId: "k",
        secret,
        timestamp: ts,
        method: "POST",
        pathAndQuery: path,
        body,
      });
      expect(headers[SIGNATURE_HEADER]).toBe(`v1=${expected}`);
    }
  });
});
