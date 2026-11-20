import { useAccount } from 'wagmi';
import type { AppConfig } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import { usePayments, useSessions } from '../lib/hooks';
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatDateTime,
  formatTusd8,
  shortAddress,
} from '../lib/format';
import { sessionStatus } from '../lib/types';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
}

function startOfTodaySec(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Live spend monitoring: PaymentExecuted events, polled over HTTPS
 * (Aevum has no WebSocket RPC) every 30 s in live mode, plus a manual
 * Refresh button. Event scans are chunked to <=1,000 blocks — see
 * src/lib/provider.ts.
 */
export function Activity({ config, provider }: Props) {
  const { address } = useAccount();
  const payments = usePayments(provider, address);
  const sessions = useSessions(provider, address);

  const live = config.mode === 'live';
  const todayStart = startOfTodaySec();
  const spentToday =
    payments.data
      ?.filter((p) => p.timestamp >= todayStart)
      .reduce((sum, p) => sum + p.amount, 0n) ?? 0n;
  const dailyLimitTotal =
    sessions.data
      ?.filter((s) => sessionStatus(s) === 'active')
      .reduce((sum, s) => sum + s.dailyLimit, 0n) ?? 0n;
  const usedPct =
    dailyLimitTotal > 0n ? Math.min(100, Number((spentToday * 100n) / dailyLimitTotal)) : 0;
  const totalSpent =
    payments.data?.reduce((sum, p) => sum + p.amount, 0n) ?? 0n;

  const refresh = () => {
    void payments.refetch();
    void sessions.refetch();
  };

  return (
    <section aria-label="Activity">
      {!live && (
        <div className="banner banner-info">
          <strong>Demo data — contracts not deployed yet.</strong> The payments
          below are examples. Live events appear here automatically once the
          vault is deployed.
        </div>
      )}

      <div className="card">
        <div className="summary-head">
          <h2>Daily spend</h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={payments.isFetching}
          >
            {payments.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="big-number">{formatTusd8(spentToday)} tUSD8</div>
        <p className="muted">
          spent today, of {formatTusd8(dailyLimitTotal)} tUSD8 total daily limit
          across active sessions · {formatTusd8(totalSpent)} tUSD8 all-time (
          {payments.data?.length ?? 0} payments)
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={usedPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Daily limit used"
        >
          <div className="progress-fill" style={{ width: `${usedPct}%` }} />
        </div>
        {live && (
          <p className="muted small">
            Auto-refreshes every 30 seconds from on-chain events.
          </p>
        )}
      </div>

      <h2 className="section-title">Payments</h2>

      {payments.isLoading && <p className="muted">Loading payments…</p>}
      {payments.isError && (
        <div className="banner banner-error" role="alert">
          Could not load payments. Check your connection and press Refresh.
        </div>
      )}
      {payments.data?.length === 0 && !payments.isLoading && (
        <p className="muted">
          No payments yet. Once a session key pays a bill, it shows up here with
          its transaction hash.
        </p>
      )}

      <ul className="payment-list">
        {payments.data?.map((p) => (
          <li key={`${p.txHash}-${p.sessionId.toString()}`} className="card payment-row">
            <div className="payment-main">
              <div className="payment-amount">−{formatTusd8(p.amount)} tUSD8</div>
              <div className="payment-payee">
                {p.label ?? (
                  <a
                    href={explorerAddressUrl(config.explorerUrl, p.payee)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(p.payee)} ↗
                  </a>
                )}
              </div>
              {p.label && (
                <div className="muted small">
                  <a
                    href={explorerAddressUrl(config.explorerUrl, p.payee)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(p.payee)} ↗
                  </a>
                </div>
              )}
            </div>
            <div className="payment-meta">
              <span>{formatDateTime(p.timestamp)}</span>
              <span className="muted">Session #{p.sessionId.toString()}</span>
              <a href={explorerTxUrl(config.explorerUrl, p.txHash)} target="_blank" rel="noreferrer">
                {shortAddress(p.txHash)} ↗
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
