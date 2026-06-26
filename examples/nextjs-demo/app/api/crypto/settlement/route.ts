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
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const misconfig = (m: string) => NextResponse.json({ error: { code: "misconfig", message: m } }, { status: 500 });
  const badRequest = (m: string) => NextResponse.json({ error: { code: "bad_request", message: m } }, { status: 400 });

  // Validate deterministic preconditions UP FRONT so a permanent misconfig surfaces an
  // error instead of polling "pending" forever. Only genuinely transient RPC failures
  // below are swallowed into pending.
  if (!cfg.safe || !ADDR.test(cfg.safe)) return misconfig("VAULT_RAIL_SAFE_ADDRESS is required and must be a 0x address.");
  if (!ADDR.test(cfg.token)) return misconfig("VAULT_RAIL_USD_TOKEN_CONTRACT must be a 0x address.");
  if (!Number.isInteger(cfg.decimals) || cfg.decimals < 2) {
    return misconfig("VAULT_RAIL_TOKEN_DECIMALS must be an integer >= 2 to represent cents.");
  }
  if (!ADDR.test(recipient)) return badRequest("recipient must be a 0x address.");
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return badRequest("amountMinor must be a positive integer.");
  let fromBlock: bigint;
  try {
    fromBlock = BigInt(q.get("fromBlock") ?? "0");
  } catch {
    return badRequest("fromBlock must be an integer.");
  }

  try {
    // Expected on-chain amount: cents -> token base units (e.g. 500 -> 5_000_000 at 6dp).
    const expectedValue = BigInt(amountMinor) * 10n ** BigInt(cfg.decimals - 2);
    const settlement = await findSettlement({
      rpcUrl: cfg.rpcUrl,
      token: cfg.token,
      recipient,
      fromBlock,
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
