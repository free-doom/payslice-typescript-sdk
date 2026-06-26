import { NextResponse } from "next/server";
import { isRailLive, payoutEnabledFromBrowser, railConfig } from "@/lib/vault-rail";

// GET /api/crypto/mode — live (real Vault/Rail + Base Sepolia) vs mock, plus the
// non-secret config the crypto page displays. Never returns the HMAC secret.
export async function GET() {
  const cfg = railConfig();
  return NextResponse.json({
    live: isRailLive(),
    payoutEnabled: payoutEnabledFromBrowser(),
    baseUrl: cfg.baseUrl,
    network: cfg.network,
    currency: cfg.currency,
    token: cfg.token,
    decimals: cfg.decimals,
    safe: cfg.safe ?? null,
    explorerBase: cfg.explorerBase,
  });
}
