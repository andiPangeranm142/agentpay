import { useAccount, useChainId } from 'wagmi';
import type { AppConfig } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import { usePayments, useSessions, useVaultBalance, useWalletTusd8Balance } from '../lib/hooks';
import { explorerAddressUrl, formatTusd8, shortAddress } from '../lib/format';
import { sessionStatus, spentToday } from '../lib/types';
import { aevumTestnet } from '../lib/chain';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
  onNavigate: (tab: 'deposit' | 'sessions' | 'activity') => void;
}

export function Overview({ config, provider, onNavigate }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const vault = useVaultBalance(provider, address);
  const wallet = useWalletTusd8Balance(provider, address);
  const sessions = useSessions(provider, address);
  const payments = usePayments(provider, address);

  const activeSessions =
    sessions.data?.filter((s) => sessionStatus(s) === 'active').length ?? 0;
  const spentTodayTotal =
    sessions.data
      ?.filter((s) => sessionStatus(s) === 'active')
      .reduce((sum, s) => sum + spentToday(s), 0n) ?? 0n;
  const dailyLimitTotal =
    sessions.data
      ?.filter((s) => sessionStatus(s) === 'active')
      .reduce((sum, s) => sum + s.dailyLimit, 0n) ?? 0n;

  const onRightChain = !isConnected || chainId === aevumTestnet.id;
  const loading = vault.isLoading || wallet.isLoading;
  // Live reads are per-address: with no wallet connected there is no data
  // to show, so render placeholders instead of misleading zeros.
  const showData = config.mode === 'mock' || isConnected;

  return (
    <section aria-label="Overview">
      <div className="grid grid-2">
        <div className="card card-hero">
          <div className="card-label">Vault balance</div>
          <div className="big-number">
            {vault.isLoading ? '…' : showData ? `${formatTusd8(vault.data ?? 0n)} tUSD8` : '—'}
          </div>
          <div className="card-sub">
            {vault.isError
              ? 'Could not load the vault balance. Check your connection and refresh.'
              : 'Held in the AgentPay vault on Aevum Testnet. Only your session keys can spend it — and only within their limits.'}
          </div>
          <div className="card-actions">
            <button className="btn btn-primary" onClick={() => onNavigate('deposit')}>
              Deposit / Withdraw
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-label">Wallet &amp; network</div>
          <dl className="kv">
            <div>
              <dt>Wallet</dt>
              <dd>
                {isConnected && address ? (
                  <a
                    href={explorerAddressUrl(config.explorerUrl, address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(address)} ↗
                  </a>
                ) : (
                  'Not connected'
                )}
              </dd>
            </div>
            <div>
              <dt>tUSD8 in wallet</dt>
              <dd>{wallet.isLoading ? '…' : showData ? `${formatTusd8(wallet.data ?? 0n)} tUSD8` : '—'}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {isConnected ? (
                  onRightChain ? (
                    <span className="badge badge-ok">Aevum Testnet · 44005</span>
                  ) : (
                    <span className="badge badge-warn">Wrong chain ({chainId})</span>
                  )
                ) : (
                  'Connect a wallet to check'
                )}
              </dd>
            </div>
            <div>
              <dt>Vault contract</dt>
              <dd>
                {config.mode === 'live' ? (
                  <a
                    href={explorerAddressUrl(config.explorerUrl, config.vaultAddress)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.vaultAddress)} ↗
                  </a>
                ) : (
                  'Not deployed yet (demo mode)'
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid grid-3">
        <button className="card stat-card" onClick={() => onNavigate('sessions')}>
          <div className="card-label">Active sessions</div>
          <div className="stat-number">{sessions.isLoading ? '…' : showData ? activeSessions : '—'}</div>
          <div className="card-sub">Session keys that can pay right now →</div>
        </button>
        <button className="card stat-card" onClick={() => onNavigate('activity')}>
          <div className="card-label">Spent today</div>
          <div className="stat-number">
            {sessions.isLoading ? '…' : showData ? `${formatTusd8(spentTodayTotal)} tUSD8` : '—'}
          </div>
          <div className="card-sub">
            {showData
              ? `of ${formatTusd8(dailyLimitTotal)} tUSD8 daily limit across active sessions →`
              : 'Connect your wallet to see your limits →'}
          </div>
        </button>
        <button className="card stat-card" onClick={() => onNavigate('activity')}>
          <div className="card-label">Payments (recent)</div>
          <div className="stat-number">{payments.isLoading ? '…' : showData ? (payments.data?.length ?? 0) : '—'}</div>
          <div className="card-sub">On-chain payment events →</div>
        </button>
      </div>

      {loading && <p className="muted">Loading vault data…</p>}
      {config.mode === 'live' && !isConnected && (
        <p className="muted">
          Connect your wallet to see your vault balance, sessions and payments —
          everything is read live from the chain for the connected address.
        </p>
      )}
      {config.mode === 'mock' && (
        <p className="muted">
          Demo data is shown because no vault contract is configured yet. Connect a
          wallet any time — live balances appear automatically once the vault is
          deployed and configured.
        </p>
      )}
    </section>
  );
}
