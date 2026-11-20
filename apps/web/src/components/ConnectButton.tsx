import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { shortAddress } from '../lib/format';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="connect-wrap">
        <span className="wallet-chip" title={address}>
          <span className="dot dot-green" />
          {shortAddress(address)}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="connect-wrap">
      <button
        className="btn btn-primary"
        disabled={isPending}
        onClick={() => connect({ connector: injected() })}
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          No wallet found — install MetaMask or another EVM wallet, then try again.
        </span>
      )}
    </div>
  );
}
