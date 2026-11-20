import { isAddress, type Address } from 'viem';

/**
 * Single source of truth for contract addresses + network endpoints.
 *
 * Resolution order (first hit wins):
 *   1. `deployments.json` served next to the app (public/deployments.json —
 *      copy of the repo-root deployments.json; see README). Lets ops point a
 *      built static site at a new deployment without rebuilding.
 *   2. Vite env vars (VITE_VAULT_ADDRESS, VITE_TUSD8_ADDRESS, VITE_RPC_URL,
 *      VITE_EXPLORER_URL).
 *   3. Built-in defaults for the public testnet endpoints + tUSD8 address.
 *
 * MODE: if no vault address resolves from either source, the app runs in
 * MOCK MODE (clearly bannered "Demo data") with realistic demo data so the
 * UI is fully reviewable before contracts are deployed. Switching to live
 * is a config change only — see src/lib/provider.ts.
 */

export type AppMode = 'live' | 'mock';

export interface AppConfig {
  mode: AppMode;
  /** Zero address in mock mode. */
  vaultAddress: Address;
  tusd8Address: Address;
  rpcUrl: string;
  explorerUrl: string;
  chainId: number;
  /** Block the vault was deployed at, when known (narrows event scans). */
  deploymentBlock?: bigint;
  /** Where the live addresses came from, for the footer/debug. */
  source: 'deployments.json' | 'env' | 'defaults (mock)';
}

export const CHAIN_ID = 44005;
export const DEFAULT_RPC_URL = 'https://rpc-test.qday.info';
export const DEFAULT_EXPLORER_URL = 'https://explorer-test.qday.info';
export const DEFAULT_TUSD8_ADDRESS =
  '0x456569838f1d43009A91ebA4263147Afd7233483' as Address;
export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address;

const env = import.meta.env;

function asAddress(v: unknown): Address | undefined {
  return typeof v === 'string' && isAddress(v) ? (v as Address) : undefined;
}

/** Accepts the several key spellings a deploy script might emit. */
function pickAddress(obj: Record<string, unknown>, keys: string[]): Address | undefined {
  for (const k of keys) {
    const a = asAddress(obj[k]);
    if (a) return a;
    // Nested shape: { "AgentPayVault": { "address": "0x..." } }
    const nested = obj[k];
    if (nested && typeof nested === 'object') {
      const a2 = asAddress((nested as Record<string, unknown>).address);
      if (a2) return a2;
    }
  }
  return undefined;
}

async function loadDeploymentsJson(): Promise<Record<string, unknown> | null> {
  try {
    // Served from public/; base './' keeps this working under a sub-path.
    const res = await fetch(`${env.BASE_URL}deployments.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    // SPA hosts may answer unknown paths with index.html + 200; only accept JSON.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json') && !type.includes('text/json')) return null;
    const json = (await res.json()) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null; // No deployments.json yet — fall back to env/defaults.
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const deployments = await loadDeploymentsJson();

  const vaultFromFile = deployments
    ? pickAddress(deployments, ['AgentPayVault', 'vault', 'vaultAddress', 'agentPayVault'])
    : undefined;
  const tusd8FromFile = deployments
    ? pickAddress(deployments, ['tUSD8', 'TUSD8', 'tusd8', 'tusd8Address'])
    : undefined;
  const deploymentBlock =
    deployments && typeof deployments.deploymentBlock === 'string'
      ? (() => {
          try {
            return BigInt(deployments.deploymentBlock);
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const vaultAddress =
    vaultFromFile ?? asAddress(env.VITE_VAULT_ADDRESS) ?? ZERO_ADDRESS;
  const tusd8Address =
    tusd8FromFile ?? asAddress(env.VITE_TUSD8_ADDRESS) ?? DEFAULT_TUSD8_ADDRESS;
  const rpcUrl =
    (typeof deployments?.rpcUrl === 'string' && deployments.rpcUrl) ||
    env.VITE_RPC_URL ||
    DEFAULT_RPC_URL;
  const explorerUrl =
    (typeof deployments?.explorerUrl === 'string' && deployments.explorerUrl) ||
    env.VITE_EXPLORER_URL ||
    DEFAULT_EXPLORER_URL;

  const live = vaultAddress !== ZERO_ADDRESS;
  return {
    mode: live ? 'live' : 'mock',
    vaultAddress,
    tusd8Address,
    rpcUrl,
    explorerUrl,
    chainId: CHAIN_ID,
    deploymentBlock,
    source: live
      ? vaultFromFile
        ? 'deployments.json'
        : 'env'
      : 'defaults (mock)',
  };
}
