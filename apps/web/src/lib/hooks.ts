import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultDataProvider } from './provider';

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
