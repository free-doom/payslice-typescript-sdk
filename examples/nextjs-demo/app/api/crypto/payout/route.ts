import { NextRequest, NextResponse } from "next/server";
import {
  createPayoutAuthorization,
  isRailLive,
  railConfig,
  railErrorResponse,
  validatePayoutInput,
} from "@/lib/vault-rail";
import { currentBlock } from "@/lib/chain";
import { mockPayout, type PayoutResult } from "@/lib/crypto-mock";

// POST /api/crypto/payout — authorize a crypto custody payout on the Vault/Rail
// service. The rail then KMS-signs an Allowance-Module transfer and the relayer
// broadcasts it, moving tokens out of the Safe. We capture the chain head at
// authorization time so the settlement scan is cheaply bounded.
export async function POST(req: NextRequest) {
  try {
    const { amountMinor, recipient } = validatePayoutInput(await req.json().catch(() => ({})));

    if (!isRailLive()) {
      return NextResponse.json(mockPayout(recipient));
    }

    const cfg = railConfig();
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
    return railErrorResponse(err);
  }
}
