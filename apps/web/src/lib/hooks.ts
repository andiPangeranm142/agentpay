import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { AppConfig } from '../config';
import type { VaultDataProvider } from './provider';
import { fetchTxFinality, type TxFinalityMap } from './finality';

/** React Query wrappers over the data layer; mock mode needs no wallet. */

export function useVaultBalance(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['vaultBalance', provider.mode, owner],
    queryFn: () => provider.getVaultBalance(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useWalletTusd8Balance(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['walletTusd8', provider.mode, owner],
    queryFn: () => provider.getWalletTusd8Balance(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useAllowance(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['allowance', provider.mode, owner],
    queryFn: () => provider.getAllowance(owner as Address),
    enabled: provider.mode === 'live' && !!owner,
  });
}

export function useSessions(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['sessions', provider.mode, owner],
    queryFn: () => provider.listSessions(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function usePayments(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['payments', provider.mode, owner],
    queryFn: () => provider.listPayments(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

// --- v2: Confirmation of Payee ---

export function useRegisteredPayees(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['registeredPayees', provider.mode, owner],
    queryFn: () => provider.listRegisteredPayees(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useV2Sessions(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['v2sessions', provider.mode, owner],
    queryFn: () => provider.listV2Sessions(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useV2Payments(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['v2payments', provider.mode, owner],
    queryFn: () => provider.listV2Payments(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

// --- v3: case-insensitive Confirmation of Payee ---

export function useRegisteredPayeesV3(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['registeredPayeesV3', provider.mode, owner],
    queryFn: () => provider.listRegisteredPayeesV3(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useV3Sessions(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['v3sessions', provider.mode, owner],
    queryFn: () => provider.listV3Sessions(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

export function useV3Payments(provider: VaultDataProvider, owner?: Address) {
  return useQuery({
    queryKey: ['v3payments', provider.mode, owner],
    queryFn: () => provider.listV3Payments(owner as Address),
    enabled: provider.mode === 'mock' || !!owner,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

/**
 * Reverse lookup for several name spellings at once (e.g. lower / UPPER /
 * Original case of one registered name). Returns one address per name —
 * the zero address when no payee is registered under that spelling.
 */
export function useV3ReverseLookup(
  provider: VaultDataProvider,
  owner: Address | undefined,
  names: string[],
) {
  return useQuery({
    queryKey: ['v3reverseLookup', provider.mode, owner, names.join('\n')],
    queryFn: async () => {
      const addresses = await Promise.all(
        names.map((n) => provider.addressOfV3(owner as Address, n)),
      );
      return names.map((name, i) => ({ name, address: addresses[i] }));
    },
    enabled: (provider.mode === 'mock' || !!owner) && names.length > 0,
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

/** End-state numbers for the recorded v3 run, read live right now. */
export function useV3EndState(
  provider: VaultDataProvider,
  owner?: Address,
  payee?: Address,
) {
  return useQuery({
    queryKey: ['v3endState', provider.mode, owner, payee],
    queryFn: () => provider.getV3EndState(owner as Address, payee as Address),
    enabled: provider.mode === 'mock' || (!!owner && !!payee),
    refetchInterval: provider.mode === 'live' ? 30_000 : false,
  });
}

// --- Finality watcher ---

/**
 * Live receipt status for recorded evidence txs, polled by hash via
 * eth_getTransactionReceipt (see lib/finality.ts). Live mode only —
 * mock mode makes zero RPC calls, so the map stays empty there and the
 * UI shows the evidence without a live status.
 *
 * `hashes` must be a stable (memoized) array: it feeds the query key.
 */
export function useTxFinality(config: AppConfig, hashes: Array<`0x${string}`>) {
  const key = hashes.join(',');
  return useQuery<TxFinalityMap>({
    queryKey: ['txFinality', config.rpcUrl, key],
    queryFn: () => fetchTxFinality(config.rpcUrl, hashes),
    enabled: config.mode === 'live' && hashes.length > 0,
    refetchInterval: config.mode === 'live' ? 30_000 : false,
  });
}
