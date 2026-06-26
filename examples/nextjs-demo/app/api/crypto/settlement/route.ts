import { NextRequest, NextResponse } from "next/server";
import { isRailLive, railConfig } from "@/lib/vault-rail";
import { findSettlement } from "@/lib/chain";
import { mockSettlement, type SettlementResult } from "@/lib/crypto-mock";

// GET /api/crypto/settlement?recipient=0x..&fromBlock=..&amountMinor=..&attempt=..
// Reads the settlement back off-chain: scans Base Sepolia for the rail's
// ERC-20 Transfer to the (fresh) recipient. Returns pending until it's mined.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const recipient = q.get("recipient") ?? "";
  const amountMinor = Number(q.get("amountMinor") ?? "0");
  const attempt = Number(q.get("attempt") ?? "0");

  if (!isRailLive()) {
    return NextResponse.json(mockSettlement(amountMinor, attempt));
  }

  const cfg = railConfig();
  try {
    // Expected on-chain amount: cents -> token base units (e.g. 500 -> 5_000_000 at 6dp).
    const expectedValue =
      amountMinor > 0 && cfg.decimals >= 2
        ? BigInt(amountMinor) * 10n ** BigInt(cfg.decimals - 2)
        : undefined;
    const settlement = await findSettlement({
      rpcUrl: cfg.rpcUrl,
      token: cfg.token,
      recipient,
      fromBlock: BigInt(q.get("fromBlock") ?? "0"),
      safe: cfg.safe,
      expectedValue,
    });

    if (!settlement) {
      const res: SettlementResult = { status: "pending", mock: false };
      return NextResponse.json(res);
    }
    const res: SettlementResult = {
      status: "confirmed",
      txHash: settlement.txHash,
      blockNumber: settlement.blockNumber,
      value: settlement.value,
      confirmations: settlement.confirmations,
      explorerUrl: `${cfg.explorerBase}/tx/${settlement.txHash}`,
      mock: false,
    };
    return NextResponse.json(res);
  } catch (err) {
    // A scan hiccup (RPC rate limit, transient range error) must NOT end the
    // poll — the transfer may still settle. Report pending with a note and let
    // the client keep polling until it confirms or hits its attempt cap.
    const res: SettlementResult = {
      status: "pending",
      mock: false,
      note: `scan retry: ${(err as Error).message}`,
    };
    return NextResponse.json(res);
  }
}
