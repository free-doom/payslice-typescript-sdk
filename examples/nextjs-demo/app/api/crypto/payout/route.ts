import { NextRequest, NextResponse } from "next/server";
import { createPayoutAuthorization, isRailLive, railConfig } from "@/lib/vault-rail";
import { currentBlock } from "@/lib/chain";
import { mockPayout, type PayoutResult } from "@/lib/crypto-mock";

// POST /api/crypto/payout — authorize a crypto custody payout on the Vault/Rail
// service. The rail then KMS-signs an Allowance-Module transfer and the relayer
// broadcasts it, moving tokens out of the Safe. We capture the chain head at
// authorization time so the settlement scan is cheaply bounded.
export async function POST(req: NextRequest) {
  const { amountMinor, recipient } = (await req.json()) as {
    amountMinor: number;
    recipient: string;
  };

  if (!isRailLive()) {
    return NextResponse.json(mockPayout(recipient));
  }

  const cfg = railConfig();
  try {
    const fromBlock = await currentBlock(cfg.rpcUrl);
    // A fresh advance id per run; doubles as the idempotency key.
    const advanceId = `demo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const auth = await createPayoutAuthorization({ amountMinor, recipient, advanceId });

    const result: PayoutResult = {
      ...auth,
      recipient,
      token: cfg.token,
      decimals: cfg.decimals,
      fromBlock: Number(fromBlock),
      explorerBase: cfg.explorerBase,
      mock: false,
    };
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: { code: "rail_error", message: (err as Error).message } },
      { status },
    );
  }
}
