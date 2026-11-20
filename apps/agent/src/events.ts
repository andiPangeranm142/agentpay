/**
 * Chunked eth_getLogs reader. Aevum's RPC rejects log queries spanning more
 * than 1,000 blocks, so every history read is split into ≤1,000-block
 * windows (same approach as the starter kit's `getLogsChunked`, MIT).
 * The agent's hot loop never reads history — this is used by the `history`
 * CLI command and by the e2e verification, i.e. the on-chain audit trail.
 */

import { getAbiItem, type AbiEvent, type Address, type GetLogsReturnType, type PublicClient } from 'viem';
import { VAULT_ABI } from './abi.js';
import { MAX_LOG_RANGE } from './chain.js';
import { withRetry, type RetryOptions } from './retry.js';

/** Pure helper: split [fromBlock, toBlock] (inclusive) into ≤`step`-block windows. */
export function chunkRanges(fromBlock: bigint, toBlock: bigint, step: bigint = MAX_LOG_RANGE): Array<[bigint, bigint]> {
  if (step < 1n || step > MAX_LOG_RANGE) throw new Error(`step must be between 1 and ${MAX_LOG_RANGE}`);
  const ranges: Array<[bigint, bigint]> = [];
  if (toBlock < fromBlock) return ranges;
  for (let start = fromBlock; start <= toBlock; start += step) {
    const stop = start + step - 1n > toBlock ? toBlock : start + step - 1n;
    ranges.push([start, stop]);
  }
  return ranges;
}

export interface ChunkedLogsArgs<E extends AbiEvent> {
  address: Address;
  event: E;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock?: bigint;
  /** Blocks per request. Aevum rejects more than 1,000. */
  step?: bigint;
  /** Called after each chunk; handy for a progress bar. */
  onProgress?: (done: bigint, total: bigint) => void;
  /** Retry policy for transient RPC failures, per chunk. */
  retry?: RetryOptions;
}

/**
 * eth_getLogs over any range, split into ≤1,000-block requests (Aevum's limit).
 * Requests run one after another to stay friendly with the public RPC.
 * Adapted from the starter kit's getLogsChunked (MIT), with per-chunk retry.
 */
export async function getLogsChunked<E extends AbiEvent>(
  client: PublicClient,
  { address, event, args, fromBlock, toBlock, step = MAX_LOG_RANGE, onProgress, retry }: ChunkedLogsArgs<E>,
): Promise<GetLogsReturnType<E>> {
  const end = toBlock ?? (await client.getBlockNumber());
  const ranges = chunkRanges(fromBlock, end, step);
  const total = end >= fromBlock ? end - fromBlock + 1n : 0n;
  const out: unknown[] = [];
  for (const [start, stop] of ranges) {
    const fetchChunk = () =>
      client.getLogs({ address, event, args, fromBlock: start, toBlock: stop } as Parameters<
        PublicClient['getLogs']
      >[0]);
    const logs = retry ? await withRetry(fetchChunk, retry) : await fetchChunk();
    out.push(...(logs as unknown[]));
    onProgress?.(stop - fromBlock + 1n, total);
  }
  return out as GetLogsReturnType<E>;
}

export interface PaymentEvent {
  blockNumber: bigint;
  txHash: string;
  sessionId: bigint;
  payee: Address;
  amount: bigint;
  timestamp: bigint;
}

/** Read every PaymentExecuted event from the vault, chunked per Aevum's limit. */
export async function fetchPaymentEvents(
  client: PublicClient,
  vaultAddress: Address,
  fromBlock: bigint,
  opts: { toBlock?: bigint; sessionId?: bigint; payee?: Address; retry?: RetryOptions } = {},
): Promise<PaymentEvent[]> {
  const event = getAbiItem({ abi: VAULT_ABI, name: 'PaymentExecuted' });
  const args: Record<string, unknown> = {};
  if (opts.sessionId !== undefined) args.sessionId = opts.sessionId;
  if (opts.payee !== undefined) args.payee = opts.payee;
  const logs = await getLogsChunked(client, {
    address: vaultAddress,
    event,
    args: Object.keys(args).length > 0 ? args : undefined,
    fromBlock,
    toBlock: opts.toBlock,
    retry: opts.retry,
  });
  return logs.map((log) => ({
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
    sessionId: log.args.sessionId ?? 0n,
    payee: (log.args.payee ?? '0x0000000000000000000000000000000000000000') as Address,
    amount: log.args.amount ?? 0n,
    timestamp: log.args.timestamp ?? 0n,
  }));
}
