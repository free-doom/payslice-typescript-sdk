import { NextRequest, NextResponse } from "next/server";
import {
  assertLiveAllowed,
  assertRailConfigValid,
  createPayoutAuthorization,
  isRailLive,
  railConfig,
  railErrorResponse,
  validatePayoutInput,
} from "@/lib/vault-rail";
import { currentBlock } from "@/lib/chain";
import { mockPayout, type PayoutResult } from "@/lib/crypto-mock";

// Start the settlement scan a margin of blocks BEFORE the captured head, so an
// idempotent replay (whose Transfer already mined just after the original call)
// is still found. Safe because each disbursement uses a fresh, unique recipient.
const SCAN_MARGIN_BLOCKS = 60n; // ~2 min at 2s blocks

// POST /api/crypto/payout — authorize a crypto custody payout on the Vault/Rail
// service. The rail then KMS-signs an Allowance-Module transfer and the relayer
// broadcasts it, moving tokens out of the Safe. We capture the chain head at
// authorization time so the settlement scan is cheaply bounded.
export async function POST(req: NextRequest) {
  try {
    const live = isRailLive();
    const { amountMinor, recipient, idempotencyKey } = validatePayoutInput(
      await req.json().catch(() => ({})),
      live, // require a caller idempotency key on the live money-moving path
    );

    if (!live) {
      return NextResponse.json(mockPayout(recipient));
    }

    // Live, money-moving path. Gate + config-validate BEFORE touching the rail, so a
    // gated/misconfigured deploy fails before moving funds (and before the page's advance).
    assertLiveAllowed(req.headers.get("authorization"));
    assertRailConfigValid();

    const cfg = railConfig();
    const head = await currentBlock(cfg.rpcUrl);
    const fromBlock = head > SCAN_MARGIN_BLOCKS ? head - SCAN_MARGIN_BLOCKS : 0n;
    // The client-supplied idempotency key doubles as the advance id, so a retry
    // after a mid-flight failure replays instead of firing a second transfer.
    const auth = await createPayoutAuthorization({ amountMinor, recipient, advanceId: idempotencyKey });

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
