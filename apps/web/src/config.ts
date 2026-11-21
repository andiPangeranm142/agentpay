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
  /** v2 vault (Confirmation of Payee). Zero address when not configured. */
  vaultV2Address: Address;
  /** PayeeRegistry (v2). Zero address when not configured. */
  registryAddress: Address;
  /** v3 vault (case-insensitive CoP, current version). Zero when not configured. */
  vaultV3Address: Address;
  /** PayeeRegistryV3. Zero address when not configured. */
  registryV3Address: Address;
  /** Deployer / demo owner, when known (used to show demo v2/v3 data with no wallet). */
  deployerAddress?: Address;
  tusd8Address: Address;
  rpcUrl: string;
  explorerUrl: string;
  chainId: number;
  /** Block the vault was deployed at, when known (narrows event scans). */
  deploymentBlock?: bigint;
  /** Block the v2 contracts were deployed at, when known. */
  v2DeploymentBlock?: bigint;
  /** Block the v3 contracts were deployed at, when known. */
  v3DeploymentBlock?: bigint;
  /** Deploy tx hashes (from deployments.json), for the finality watcher. */
  deployTx?: `0x${string}`;
  v2DeployTxRegistry?: `0x${string}`;
  v2DeployTxVault?: `0x${string}`;
  v3DeployTxRegistry?: `0x${string}`;
  v3DeployTxVault?: `0x${string}`;
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

/** A 32-byte tx hash (0x + 64 hex chars), or undefined. */
function asTxHash(v: unknown): `0x${string}` | undefined {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
    ? (v as `0x${string}`)
    : undefined;
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
  const vaultV2FromFile = deployments
    ? pickAddress(deployments, ['AgentPayVaultV2', 'vaultV2', 'vaultV2Address'])
    : undefined;
  const registryFromFile = deployments
    ? pickAddress(deployments, ['PayeeRegistry', 'registry', 'registryAddress'])
    : undefined;
  const vaultV3FromFile = deployments
    ? pickAddress(deployments, ['AgentPayVaultV3', 'vaultV3', 'vaultV3Address'])
    : undefined;
  const registryV3FromFile = deployments
    ? pickAddress(deployments, ['PayeeRegistryV3', 'registryV3', 'registryV3Address'])
    : undefined;
  const deployerFromFile = deployments
    ? pickAddress(deployments, ['deployer', 'deployerAddress', 'owner'])
    : undefined;
  const tusd8FromFile = deployments
    ? pickAddress(deployments, ['tUSD8', 'TUSD8', 'tusd8', 'tusd8Address'])
    : undefined;
  const parseBlock = (v: unknown): bigint | undefined => {
    if (typeof v !== 'string') return undefined;
    try {
      return BigInt(v);
    } catch {
      return undefined;
    }
  };
  const deploymentBlock = deployments ? parseBlock(deployments.deploymentBlock) : undefined;
  // Registry deployed one block before the v2 vault; scan from the earlier one.
  const v2DeploymentBlock = deployments
    ? (parseBlock(deployments.v2DeploymentBlockRegistry) ??
      parseBlock(deployments.v2DeploymentBlockVault))
    : undefined;
  const v3DeploymentBlock = deployments
    ? (parseBlock(deployments.v3DeploymentBlockRegistry) ??
      parseBlock(deployments.v3DeploymentBlockVault))
    : undefined;
  const deployTx = deployments ? asTxHash(deployments.deployTx) : undefined;
  const v2DeployTxRegistry = deployments
    ? asTxHash(deployments.v2DeployTxRegistry)
    : undefined;
  const v2DeployTxVault = deployments ? asTxHash(deployments.v2DeployTxVault) : undefined;
  const v3DeployTxRegistry = deployments
    ? asTxHash(deployments.v3DeployTxRegistry)
    : undefined;
  const v3DeployTxVault = deployments ? asTxHash(deployments.v3DeployTxVault) : undefined;

  const vaultAddress =
    vaultFromFile ?? asAddress(env.VITE_VAULT_ADDRESS) ?? ZERO_ADDRESS;
  const vaultV2Address =
    vaultV2FromFile ?? asAddress(env.VITE_VAULT_V2_ADDRESS) ?? ZERO_ADDRESS;
  const registryAddress =
    registryFromFile ?? asAddress(env.VITE_REGISTRY_ADDRESS) ?? ZERO_ADDRESS;
  const vaultV3Address =
    vaultV3FromFile ?? asAddress(env.VITE_VAULT_V3_ADDRESS) ?? ZERO_ADDRESS;
  const registryV3Address =
    registryV3FromFile ?? asAddress(env.VITE_REGISTRY_V3_ADDRESS) ?? ZERO_ADDRESS;
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
    vaultV2Address,
    registryAddress,
    vaultV3Address,
    registryV3Address,
    deployerAddress: deployerFromFile,
    tusd8Address,
    rpcUrl,
    explorerUrl,
    chainId: CHAIN_ID,
    deploymentBlock,
    v2DeploymentBlock,
    v3DeploymentBlock,
    deployTx,
    v2DeployTxRegistry,
    v2DeployTxVault,
    v3DeployTxRegistry,
    v3DeployTxVault,
    source: live
      ? vaultFromFile
        ? 'deployments.json'
        : 'env'
      : 'defaults (mock)',
  };
}
