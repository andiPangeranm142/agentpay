import { useAccount } from 'wagmi';
import type { AppConfig } from '../config';
import { ZERO_ADDRESS } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import {
  useRegisteredPayees,
  useV2Payments,
  useV2Sessions,
} from '../lib/hooks';
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatDate,
  formatDateTime,
  formatTusd8,
  shortAddress,
} from '../lib/format';
import { sessionStatus } from '../lib/types';
import { V2_E2E_FLOW, V2_REJECTED_PAYMENTS } from '../lib/v2Evidence';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
}

/**
 * Confirmation of Payee (v2): the PayeeRegistry + AgentPayVaultV2 story.
 *
 * Live data is read from the chain for one owner namespace. With a wallet
 * connected, that owner is the connected address; without one, the tab
 * shows the demo owner's (deployer's) namespace from deployments.json so
 * the feature is reviewable with no wallet — clearly labelled as such.
 * The two rejected payments are recorded on-chain evidence (reverted
 * transactions emit no events, so they cannot be discovered by scanning);
 * each entry links to its explorer receipt.
 */
export function Payees({ config, provider }: Props) {
  const { address, isConnected } = useAccount();
  const live = config.mode === 'live';
  const v2Configured = config.vaultV2Address !== ZERO_ADDRESS;
  const registryConfigured = config.registryAddress !== ZERO_ADDRESS;

  // Owner namespace to display: connected wallet first, demo owner
  // (deployer) as the no-wallet fallback. Mock mode needs no owner.
  const owner = address ?? config.deployerAddress;
  const showingDemoOwner = live && !isConnected && !!config.deployerAddress;

  const payees = useRegisteredPayees(provider, owner);
  const v2Payments = useV2Payments(provider, owner);
  const v2Sessions = useV2Sessions(provider, owner);

  const showData = !live || !!owner;

  const refresh = () => {
    void payees.refetch();
    void v2Payments.refetch();
    void v2Sessions.refetch();
  };

  return (
    <section aria-label="Confirmation of Payee">
      {!live && (
        <div className="banner banner-info">
          <strong>Demo data — contracts not deployed yet.</strong> The payees,
          payments and sessions below are examples. Live registry data appears
          here automatically once the v2 contracts are deployed.
        </div>
      )}
      {live && showingDemoOwner && (
        <div className="banner banner-info">
          <div>
            <strong>Showing the demo owner&apos;s payees</strong> — deployer{' '}
            <a
              href={explorerAddressUrl(config.explorerUrl, config.deployerAddress as string)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(config.deployerAddress as string)} ↗
            </a>
            .
          </div>
          <div>
            Connect your wallet to see your own registered payees instead —
            names live in per-owner namespaces.
          </div>
        </div>
      )}
      {live && !v2Configured && (
        <div className="banner banner-error" role="alert">
          The v2 contracts (PayeeRegistry / AgentPayVaultV2) are not configured
          in <code>deployments.json</code> yet — only the recorded testnet run
          below is available. The v1 vault still works on the other tabs.
        </div>
      )}

      <div className="card">
        <div className="summary-head">
          <h2>Confirmation of Payee — what it does</h2>
          {live && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={refresh}
              disabled={payees.isFetching || v2Payments.isFetching}
            >
              {payees.isFetching || v2Payments.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
        <p>
          Before a v2 payment moves any tUSD8, the vault checks the payee&apos;s
          name against the owner&apos;s registry: the agent must pass the exact
          registered name for the payee address. A typo&apos;d name reverts with{' '}
          <code>PayeeNameMismatch</code>; an address with no registered name —
          e.g. a lookalike address with one character changed — reverts with{' '}
          <code>PayeeNotRegistered</code>. Names are per-owner, exact and
          case-sensitive, and the session key can never rename a payee.
        </p>
        <p className="muted">
          V2 also adds a <strong>per-payee spend cap</strong>: each session
          caps how much, in total over its life, may go to any single payee —
          on top of the v1 per-transaction and daily limits.
        </p>
        <dl className="kv">
          <div>
            <dt>PayeeRegistry</dt>
            <dd>
              {registryConfigured ? (
                <>
                  <a
                    href={explorerAddressUrl(config.explorerUrl, config.registryAddress)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.registryAddress)} ↗
                  </a>{' '}
                  <span className="badge badge-ok">source-verified</span>
                </>
              ) : (
                'Not configured'
              )}
            </dd>
          </div>
          <div>
            <dt>AgentPayVaultV2</dt>
            <dd>
              {v2Configured ? (
                <>
                  <a
                    href={explorerAddressUrl(config.explorerUrl, config.vaultV2Address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.vaultV2Address)} ↗
                  </a>{' '}
                  <span className="badge badge-ok">source-verified</span>
                </>
              ) : (
                'Not configured'
              )}
            </dd>
          </div>
          <div>
            <dt>Vault v1 (history)</dt>
            <dd>
              <a
                href={explorerAddressUrl(config.explorerUrl, config.vaultAddress)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(config.vaultAddress)} ↗
              </a>{' '}
              <span className="badge badge-muted">unchanged</span>
            </dd>
          </div>
        </dl>
      </div>

      <h2 className="section-title">
        Verified payees{' '}
        <span className="muted small">
          {live ? '· read live from PayeeRegistry' : '· demo data'}
        </span>
      </h2>

      {payees.isLoading && <p className="muted">Loading registered payees…</p>}
      {payees.isError && (
        <div className="banner banner-error" role="alert">
          Could not load registered payees. Check your connection and press
          Refresh.
        </div>
      )}
      {payees.data?.length === 0 && !payees.isLoading && (
        <p className="muted">
          No payees registered in this owner&apos;s namespace yet. Register one
          on-chain (see README) and it appears here automatically.
        </p>
      )}
      {!showData && (
        <p className="muted">
          Connect your wallet to see your registered payees.
        </p>
      )}

      {(payees.data?.length ?? 0) > 0 && (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Registered name</th>
                <th>Payee address</th>
                <th>Registered in</th>
              </tr>
            </thead>
            <tbody>
              {payees.data?.map((p) => (
                <tr key={p.payee}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>
                    <a
                      href={explorerAddressUrl(config.explorerUrl, p.payee)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(p.payee)} ↗
                    </a>
                  </td>
                  <td>
                    {p.txHash ? (
                      <a
                        href={explorerTxUrl(config.explorerUrl, p.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(p.txHash)} ↗
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">
        Name-checked payments{' '}
        <span className="muted small">
          {live ? '· live PaymentExecuted events from the v2 vault' : '· demo data'}
        </span>
      </h2>

      {v2Payments.isLoading && <p className="muted">Loading v2 payments…</p>}
      {v2Payments.isError && (
        <div className="banner banner-error" role="alert">
          Could not load v2 payments. Check your connection and press Refresh.
        </div>
      )}
      {v2Payments.data?.length === 0 && !v2Payments.isLoading && (
        <p className="muted">
          No v2 payments yet. A payment only lands here after its name check
          passes — rejected attempts never emit an event (see below).
        </p>
      )}

      <ul className="payment-list">
        {v2Payments.data?.map((p) => (
          <li key={`${p.txHash}-${p.sessionId.toString()}`} className="card payment-row">
            <div className="payment-main">
              <div className="payment-amount">−{formatTusd8(p.amount)} tUSD8</div>
              <div className="payment-payee">
                {p.payeeName ? (
                  <strong>{p.payeeName}</strong>
                ) : (
                  <a
                    href={explorerAddressUrl(config.explorerUrl, p.payee)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(p.payee)} ↗
                  </a>
                )}{' '}
                <span className="badge badge-ok">✓ name verified</span>
              </div>
              <div className="muted small">
                <a
                  href={explorerAddressUrl(config.explorerUrl, p.payee)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(p.payee)} ↗
                </a>
              </div>
            </div>
            <div className="payment-meta">
              <span>{formatDateTime(p.timestamp)}</span>
              <span className="muted">V2 session #{p.sessionId.toString()}</span>
              <a href={explorerTxUrl(config.explorerUrl, p.txHash)} target="_blank" rel="noreferrer">
                {shortAddress(p.txHash)} ↗
              </a>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="section-title">
        Blocked payments{' '}
        <span className="muted small">
          · recorded on-chain reverts, 21 Nov 2026 (receipts linked)
        </span>
      </h2>
      <p className="muted">
        These two attempts were sent to the live testnet and reverted
        on-chain (receipt status 0x0) — no funds moved. Reverted transactions
        emit no events, so they are shown from the recorded run with links to
        their explorer receipts.
      </p>

      <ul className="payment-list">
        {V2_REJECTED_PAYMENTS.map((r) => (
          <li key={r.txHash} className="card payment-row payment-row-rejected">
            <div className="payment-main">
              <div className="payment-amount">−{formatTusd8(r.amount)} tUSD8 (not sent)</div>
              <div className="payment-payee">
                Tried to pay “{r.attemptedName}” to{' '}
                <a
                  href={explorerAddressUrl(config.explorerUrl, r.payee)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(r.payee)} ↗
                </a>{' '}
                <span className="badge badge-error">✗ rejected · {r.reason}</span>
              </div>
              <div className="muted small">{r.explanation}</div>
            </div>
            <div className="payment-meta">
              <span>{formatDateTime(r.timestamp)}</span>
              <span className="muted">
                V2 session #{r.sessionId.toString()} · block {r.block.toLocaleString('en-US')}
              </span>
              <a href={explorerTxUrl(config.explorerUrl, r.txHash)} target="_blank" rel="noreferrer">
                {shortAddress(r.txHash)} ↗
              </a>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="section-title">
        V2 sessions{' '}
        <span className="muted small">
          {live ? '· live from AgentPayVaultV2' : '· demo data'}
        </span>
      </h2>

      {v2Sessions.isLoading && <p className="muted">Loading v2 sessions…</p>}
      {v2Sessions.isError && (
        <div className="banner banner-error" role="alert">
          Could not load v2 sessions. Check your connection and press Refresh.
        </div>
      )}
      {v2Sessions.data?.length === 0 && !v2Sessions.isLoading && (
        <p className="muted">
          No v2 sessions for this owner yet.
        </p>
      )}

      <ul className="payment-list">
        {v2Sessions.data?.map((s) => {
          const status = sessionStatus(s);
          return (
            <li key={s.id.toString()} className="card payment-row">
              <div className="payment-main">
                <div className="payment-payee">
                  <strong>V2 session #{s.id.toString()}</strong>{' '}
                  <span
                    className={
                      status === 'active'
                        ? 'badge badge-ok'
                        : status === 'revoked'
                          ? 'badge badge-error'
                          : 'badge badge-warn'
                    }
                  >
                    {status}
                  </span>
                </div>
                <div className="muted small">
                  Session key{' '}
                  <a
                    href={explorerAddressUrl(config.explorerUrl, s.sessionKey)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(s.sessionKey)} ↗
                  </a>{' '}
                  · expires {formatDate(s.expiry)}
                </div>
                <div className="muted small">
                  Per-tx {formatTusd8(s.perTxLimit)} · daily {formatTusd8(s.dailyLimit)} ·
                  per-payee cap {formatTusd8(s.perPayeeCap ?? 0n)} tUSD8
                </div>
                {s.payeeSpend?.map((ps) => (
                  <div key={ps.payee} className="muted small">
                    {ps.name ? <strong>{ps.name}</strong> : shortAddress(ps.payee)}: spent{' '}
                    {formatTusd8(ps.spent)} of {formatTusd8(ps.cap)} cap (
                    {formatTusd8(ps.remaining)} remaining)
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <h2 className="section-title">
        Recorded testnet run — 21 Nov 2026{' '}
        <span className="muted small">· Aevum testnet, every step linked</span>
      </h2>
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Transaction</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {V2_E2E_FLOW.map((f) => (
              <tr key={f.txHash}>
                <td>{f.step}</td>
                <td>
                  <a
                    href={explorerTxUrl(config.explorerUrl, f.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(f.txHash)} ↗
                  </a>
                </td>
                <td>{f.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        End state: owner 4.65 tUSD8 (0.40 deposited, 0.05 paid, 0.35
        withdrawn) · payee 0.35 tUSD8 (only the verified payment) · v2 vault
        balance 0 · all 4 v2 sessions revoked. Contract tests: 91/91 passed
        (53 v1 + 38 v2).
      </p>
    </section>
  );
}
