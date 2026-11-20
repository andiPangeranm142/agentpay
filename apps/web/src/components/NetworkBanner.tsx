import { useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { aevumTestnet, AEVUM_CHAIN_PARAMS } from '../lib/chain';
import { humanizeError } from '../lib/format';

/**
 * Shows when the connected wallet is on the wrong chain, with a
 * one-click switch (wagmi) and a manual "Add network" fallback that calls
 * wallet_addEthereumChain directly.
 */
export function NetworkBanner() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  if (!isConnected || chainId === aevumTestnet.id) return null;

  const addNetwork = async () => {
    setAddError(null);
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error('No wallet found.');
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [AEVUM_CHAIN_PARAMS],
      });
      setAdded(true);
    } catch (e) {
      setAddError(humanizeError(e));
    }
  };

  return (
    <div className="banner banner-warn" role="alert">
      <div>
        <strong>Wrong network.</strong> Your wallet is on chain {chainId} — AgentPay
        runs on <strong>Aevum Testnet (44005)</strong>.
      </div>
      <div className="banner-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={isPending}
          onClick={() => switchChain({ chainId: aevumTestnet.id })}
        >
          {isPending ? 'Switching…' : 'Switch to Aevum Testnet'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={addNetwork}>
          {added ? 'Network added ✓' : 'Add network to wallet'}
        </button>
      </div>
      {addError && <div className="inline-error">{addError}</div>}
    </div>
  );
}
