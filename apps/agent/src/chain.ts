/**
 * Chain definitions for Aevum. Adapted from the official starter kit
 * (https://github.com/qday-io/aevum-starter-kit, MIT) — same constants, so
 * this service behaves exactly like the kit's own examples.
 *
 * Aevum quirks that shape this service (from the kit docs):
 *  - EVM is Shanghai. No Cancun features (no MCOPY / TSTORE / blobs).
 *  - eth_getLogs returns at most 1,000 blocks per call — see events.ts.
 *  - No WebSocket RPC. Poll over HTTPS (this service never subscribes).
 *  - Legacy (type 0) transactions are the safest choice for scripts —
 *    the executor sets `type: "legacy"` on every transaction it sends.
 */

import { defineChain } from 'viem';

/** QDay Aevum Testnet (chain 44005). */
export const aevumTestnet = defineChain({
  id: 44005,
  name: 'QDay Aevum Testnet',
  nativeCurrency: { name: 'Test QDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-test.qday.info'] },
  },
  blockExplorers: {
    default: { name: 'Aevum Explorer', url: 'https://explorer-test.qday.info' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  testnet: true,
});

/** Local anvil (chain 31337). Start with the Shanghai hardfork to match Aevum. */
export const localAnvil = defineChain({
  id: 31337,
  name: 'Local (anvil)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
});

/** Chain ID of a local `make fork` copy of Aevum testnet. */
export const AEVUM_FORK_CHAIN_ID = 440050;

/** Largest block range a single eth_getLogs call may cover on Aevum. */
export const MAX_LOG_RANGE = 1000n;

export const EXPLORER_URL = 'https://explorer-test.qday.info';

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

/**
 * Build the viem chain object for a probed chain id, pointing at `rpcUrl`.
 * Known ids get their full definition; unknown ids get a generic definition
 * (name "Chain <id>") so the service still works on other local forks.
 */
export function chainForId(chainId: number, rpcUrl: string) {
  const base = chainId === aevumTestnet.id ? aevumTestnet : chainId === localAnvil.id ? localAnvil : null;
  if (base) {
    return defineChain({ ...base, rpcUrls: { default: { http: [rpcUrl] } } });
  }
  return defineChain({
    id: chainId,
    name: chainId === AEVUM_FORK_CHAIN_ID ? 'Aevum fork (local)' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Test QDAY', symbol: 'tQDAY', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}
