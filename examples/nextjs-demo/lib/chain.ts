import { createPublicClient, http, parseAbiItem, type Address } from "viem";

/**
 * Server-side chain reads for the crypto-payout settlement. The Vault/Rail
 * service has no GET status endpoint, so once an authorization is accepted we
 * watch Base Sepolia directly for the ERC-20 `Transfer` that the rail settles
 * out of the Safe. The demo sends each payout to a FRESH recipient address, so
 * the single `Transfer(to = recipient)` is unambiguous — no tx hash needed from
 * the service.
 */

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

function client(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl) });
}

export async function currentBlock(rpcUrl: string): Promise<bigint> {
  return client(rpcUrl).getBlockNumber();
}

export interface Settlement {
  txHash: string;
  blockNumber: number;
  from: string;
  value: string; // token base units, as a string (bigint-safe)
  confirmations: number;
}

/**
 * Find the rail's settlement transfer of `token` to `recipient` at or after
 * `fromBlock`. Returns null while still pending (the relayer hasn't broadcast,
 * or it isn't mined yet).
 *
 * Matches strictly so a pasted/reused recipient (or an unrelated incoming
 * transfer) can't be mistaken for this payout: the transfer must come FROM the
 * treasury `safe` AND move EXACTLY `expectedValue` base units. (`from` is an
 * indexed topic, so the node filters it; the value is checked client-side.)
 */
export async function findSettlement(args: {
  rpcUrl: string;
  token: string;
  recipient: string;
  fromBlock: bigint;
  safe?: string;
  expectedValue?: bigint;
}): Promise<Settlement | null> {
  const pc = client(args.rpcUrl);
  const logs = await pc.getLogs({
    address: args.token as Address,
    event: TRANSFER,
    args: {
      from: args.safe ? (args.safe as Address) : undefined,
      to: args.recipient as Address,
    },
    fromBlock: args.fromBlock,
    toBlock: "latest",
  });

  // Keep only transfers moving the exact expected amount, then take the newest.
  const matches =
    args.expectedValue == null
      ? logs
      : logs.filter((l) => (l.args.value ?? 0n) === args.expectedValue);
  if (matches.length === 0) return null;

  const log = matches[matches.length - 1];
  const head = await pc.getBlockNumber();
  return {
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    from: (log.args.from ?? "") as string,
    value: (log.args.value ?? 0n).toString(),
    confirmations: Number(head - log.blockNumber) + 1,
  };
}
