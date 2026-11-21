import { createPublicClient, http } from 'viem';
import { aevumTestnet } from './chain';

/**
 * FINALITY WATCHER — live receipt status for the recorded evidence txs.
 *
 * Every transaction shown as evidence (v2/v3 flow steps, blocked
 * payments/actions, deploy txs) is polled by HASH via
 * eth_getTransactionReceipt — never via event logs, because reverted
 * transactions emit no events and would be invisible to a log scan.
 * The receipt also carries the on-chain outcome (status 0x1 success /
 * 0x0 reverted), which the UI cross-checks against the recorded result.
 *
 * FINALITY THRESHOLD — read this before changing the number:
 *
 *   Aevum Testnet publishes NO absolute-finality gadget: there is no
 *   finalized-block endpoint and no Casper-style finality to query, so
 *   this dashboard does NOT claim absolute finality. Instead it uses the
 *   standard probabilistic rule — FINALITY_CONFIRMATIONS = 12, the same
 *   convention Ethereum tooling uses (12 blocks ≈ 2 epochs). A reorg
 *   deeper than 12 blocks is practically impossible on this chain, so a
 *   tx with >= 12 confirmations is shown as "Finalized" with the
 *   confirmation count next to it, and the UI footnote says plainly that
 *   this is a confirmation-depth rule, not chain-provided finality.
 *   Statuses: Seen (receipt exists, < 12 confirmations) -> Finalized
 *   (>= 12 confirmations). A tx whose receipt cannot be found is
 *   "Not found"; an RPC failure is "Unavailable" (never silently green).
 */

export const FINALITY_CONFIRMATIONS = 12;

export type TxFinalityState =
  | 'checking'
  | 'seen'
  | 'finalized'
  | 'not-found'
  | 'unavailable';

export interface TxFinality {
  hash: `0x${string}`;
  state: TxFinalityState;
  /** Confirmations = latest block - receipt block + 1; null while unknown. */
  confirmations: number | null;
  /** On-chain outcome from the receipt; null while unknown. */
  receiptStatus: 'success' | 'reverted' | null;
  /** Block the receipt landed in; null while unknown. */
  blockNumber: number | null;
}

/** Lower-cased hash -> finality. Lookups must lowercase the hash first. */
export type TxFinalityMap = Map<string, TxFinality>;

function unknown(hash: `0x${string}`, state: TxFinalityState): TxFinality {
  return { hash, state, confirmations: null, receiptStatus: null, blockNumber: null };
}

/**
 * Poll receipts for `hashes` from `rpcUrl` (one eth_getTransactionReceipt
 * per hash, in parallel) plus the current block number for confirmations.
 * Never throws for individual hashes: each gets 'not-found' (receipt is
 * null — tx unknown or not yet mined) or 'unavailable' (RPC error).
 */
export async function fetchTxFinality(
  rpcUrl: string,
  hashes: Array<`0x${string}`>,
): Promise<TxFinalityMap> {
  const client = createPublicClient({
    chain: aevumTestnet,
    transport: http(rpcUrl),
  });
  const out: TxFinalityMap = new Map();

  let latest: bigint | null = null;
  try {
    latest = await client.getBlockNumber();
  } catch {
    // No latest block: every receipt still gets checked, but
    // confirmations stay unknown (state 'seen', never 'finalized').
  }

  await Promise.all(
    hashes.map(async (hash) => {
      const key = hash.toLowerCase();
      try {
        // Raw eth_getTransactionReceipt: returns null for an unknown tx
        // instead of throwing, so 'not-found' is distinguishable from
        // an RPC failure ('unavailable').
        const receipt = await client.request({
          method: 'eth_getTransactionReceipt',
          params: [hash],
        });
        if (!receipt) {
          out.set(key, unknown(hash, 'not-found'));
          return;
        }
        const receiptBlock = BigInt(receipt.blockNumber);
        const confirmations =
          latest !== null ? Number(latest - receiptBlock + 1n) : null;
        const finalized =
          confirmations !== null && confirmations >= FINALITY_CONFIRMATIONS;
        out.set(key, {
          hash,
          state: finalized ? 'finalized' : 'seen',
          confirmations,
          receiptStatus: receipt.status === '0x1' ? 'success' : 'reverted',
          blockNumber: Number(receiptBlock),
        });
      } catch {
        out.set(key, unknown(hash, 'unavailable'));
      }
    }),
  );
  return out;
}

/** Human-readable label for a finality state (used by the badge + tooltips). */
export function finalityLabel(f: TxFinality): string {
  switch (f.state) {
    case 'checking':
      return 'Checking…';
    case 'seen':
      return f.confirmations !== null
        ? `Seen · ${f.confirmations} confirmation${f.confirmations === 1 ? '' : 's'}`
        : 'Seen on-chain';
    case 'finalized':
      return f.confirmations !== null
        ? `Finalized · ${f.confirmations} confirmations`
        : 'Finalized';
    case 'not-found':
      return 'Not found on chain';
    case 'unavailable':
      return 'Status unavailable';
  }
}
