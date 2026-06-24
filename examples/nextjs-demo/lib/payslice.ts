import { Payslice, PaysliceApiError, PaysliceError } from "@payslice/sdk";
import { NextResponse } from "next/server";

/**
 * The SDK is only ever instantiated here — on the server. The HMAC secret
 * must never reach the browser, which is why every Payslice call in this demo
 * goes through a route handler (app/api/*) rather than client-side code.
 */

/** Live mode is on when sandbox credentials are present in the environment. */
export function isLive(): boolean {
  return Boolean(process.env.PAYSLICE_KEY_ID && process.env.PAYSLICE_SECRET);
}

export function getClient(): Payslice {
  return new Payslice({
    keyId: process.env.PAYSLICE_KEY_ID!,
    secret: process.env.PAYSLICE_SECRET!,
    // Host only — the SDK appends /v1.
    baseUrl: process.env.PAYSLICE_BASE_URL ?? "https://sandbox-api.payslice.com",
  });
}

/**
 * Turn a thrown SDK error into a JSON response that mirrors the API's error
 * shape, so the UI can show the real `code`/`message`/`status`.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof PaysliceApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, requestId: err.requestId } },
      { status: err.status ?? 500 },
    );
  }
  if (err instanceof PaysliceError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: { code: "unexpected", message: String(err) } },
    { status: 500 },
  );
}
