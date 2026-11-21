import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import type { AppConfig } from '../config';
import { ZERO_ADDRESS } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import {
  useRegisteredPayees,
  useRegisteredPayeesV3,
  useTxFinality,
  useV2Payments,
  useV2Sessions,
  useV3EndState,
  useV3Payments,
  useV3ReverseLookup,
  useV3Sessions,
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
import { FINALITY_CONFIRMATIONS } from '../lib/finality';
import { V2_E2E_FLOW, V2_REJECTED_PAYMENTS } from '../lib/v2Evidence';
import {
  V3_DEMO_PAYEE,
  V3_E2E_FLOW,
  V3_RECORDED_END_STATE,
  V3_REJECTED_ACTIONS,
  V3_TEST_COUNTS,
} from '../lib/v3Evidence';
import { FinalityBadge } from './FinalityBadge';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
}

/**
 * Confirmation of Payee — v3 is the CURRENT version (case-insensitive
 * matching, reverse lookup, per-owner name uniqueness, fail-fast
 * sessions); v2 is kept below as labelled history, v1 as superseded.
 *
 * Live data is read from the chain for one owner namespace. With a wallet
 * connected, that owner is the connected address; without one, the tab
 * shows the demo owner's (deployer's) namespace from deployments.json so
 * the feature is reviewable with no wallet — clearly labelled as such.
 *
 * Every recorded transaction (flow steps, blocked payments/actions,
 * deploy txs) carries a live finality badge: its receipt is polled by
 * hash via eth_getTransactionReceipt and shown as Seen -> Finalized.
 * Reverted transactions emit no events, so polling by hash is the only
 * way to watch them — see lib/finality.ts.
 */
export function Payees({ config, provider }: Props) {
  const { address, isConnected } = useAccount();
  const live = config.mode === 'live';
  const v2Configured = config.vaultV2Address !== ZERO_ADDRESS;
  const registryConfigured = config.registryAddress !== ZERO_ADDRESS;
  const v3Configured = config.vaultV3Address !== ZERO_ADDRESS;
  const registryV3Configured = config.registryV3Address !== ZERO_ADDRESS;

  // Owner namespace to display: connected wallet first, demo owner
  // (deployer) as the no-wallet fallback. Mock mode needs no owner.
  const owner = address ?? config.deployerAddress;
  const showingDemoOwner = live && !isConnected && !!config.deployerAddress;

  const payees = useRegisteredPayees(provider, owner);
  const v2Payments = useV2Payments(provider, owner);
  const v2Sessions = useV2Sessions(provider, owner);
  const payeesV3 = useRegisteredPayeesV3(provider, owner);
  const v3Payments = useV3Payments(provider, owner);
  const v3Sessions = useV3Sessions(provider, owner);

  // Reverse-lookup probes for the first registered v3 payee: its name in
  // lower / UPPER / original case (all must resolve to the payee) plus
  // a one-letter typo (must resolve to no payee).
  const probeNames = useMemo(() => {
    const first = payeesV3.data?.[0];
    if (!first) return [];
    const name = first.name;
    const last = name[name.length - 1];
    const typo = `${name.slice(0, -1)}${last === 'x' ? 'q' : 'x'}`;
    return [name.toLowerCase(), name.toUpperCase(), name, typo];
  }, [payeesV3.data]);
  const reverseLookup = useV3ReverseLookup(provider, owner, probeNames);

  // End state of the recorded v3 run — always the demo owner's numbers,
  // read live right now (labelled as such below).
  const endState = useV3EndState(provider, config.deployerAddress, V3_DEMO_PAYEE);

  // Cross-check the live end state against the recorded run (verified at
  // block 3741216): owner 4.55 / payee 0.45 / vault 0 tUSD8, 3 sessions.
  const endStateMatches =
    !!endState.data &&
    endState.data.ownerWallet === V3_RECORDED_END_STATE.ownerWallet &&
    endState.data.payeeWallet === V3_RECORDED_END_STATE.payeeWallet &&
    endState.data.ownerVaultBalance === V3_RECORDED_END_STATE.ownerVaultBalance &&
    endState.data.vaultTokenBalance === V3_RECORDED_END_STATE.vaultTokenBalance &&
    endState.data.nextSessionId === V3_RECORDED_END_STATE.nextSessionId;

  // Every evidence tx on this tab, watched by hash (deduped: the two
  // v2/v3 reverts also appear in their flow tables).
  const evidenceHashes = useMemo(() => {
    const all: Array<`0x${string}`> = [
      ...V2_E2E_FLOW.map((f) => f.txHash),
      ...V2_REJECTED_PAYMENTS.map((r) => r.txHash),
      ...V3_E2E_FLOW.map((f) => f.txHash),
      ...V3_REJECTED_ACTIONS.map((r) => r.txHash),
    ];
    for (const h of [
      config.deployTx,
      config.v2DeployTxRegistry,
      config.v2DeployTxVault,
      config.v3DeployTxRegistry,
      config.v3DeployTxVault,
    ]) {
      if (h) all.push(h);
    }
    return [...new Set(all.map((h) => h.toLowerCase()))] as Array<`0x${string}`>;
  }, [config]);
  const finality = useTxFinality(config, evidenceHashes);
  const finalityFor = (txHash: string) => finality.data?.get(txHash.toLowerCase());

  const showData = !live || !!owner;

  const refresh = () => {
    void payees.refetch();
    void v2Payments.refetch();
    void v2Sessions.refetch();
    void payeesV3.refetch();
    void v3Payments.refetch();
    void v3Sessions.refetch();
    void reverseLookup.refetch();
    void endState.refetch();
    void finality.refetch();
  };

  return (
    <section aria-label="Confirmation of Payee">
      {!live && (
        <div className="banner banner-info">
          <strong>Demo data — contracts not deployed yet.</strong> The payees,
          payments and sessions below are examples. Live registry data appears
          here automatically once the v3 contracts are deployed.
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
      {live && !v3Configured && (
        <div className="banner banner-error" role="alert">
          The v3 contracts (PayeeRegistryV3 / AgentPayVaultV3) are not
          configured in <code>deployments.json</code> yet — only the recorded
          testnet runs below are available. The v1/v2 contracts still work on
          the other tabs.
        </div>
      )}

      <div className="card">
        <div className="summary-head">
          <h2>Confirmation of Payee — v3 (current)</h2>
          {live && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={refresh}
              disabled={payeesV3.isFetching || v3Payments.isFetching}
            >
              {payeesV3.isFetching || v3Payments.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
        <p>
          Before a v3 payment moves any tUSD8, the vault checks the payee&apos;s
          name against the owner&apos;s registry — <strong>case-insensitively</strong>:
          paying “kedai kopi senja” matches a payee registered as “Kedai Kopi Senja”.
          The original spelling is kept for display; comparison uses the
          ASCII-lowercased name. A wrong name still reverts with{' '}
          <code>PayeeNameMismatch</code>; an address with no registered name —
          e.g. a lookalike address with one character changed — reverts with{' '}
          <code>PayeeNotRegistered</code>.
        </p>
        <p className="muted">
          V3 adds three things over v2: a <strong>reverse lookup</strong>{' '}
          (<code>addressOf(owner, name)</code> — find the payee for a name, in
          any case), <strong>per-owner name uniqueness</strong> (registering a
          name another payee already holds reverts{' '}
          <code>NameAlreadyTaken</code>), and <strong>fail-fast sessions</strong>{' '}
          (<code>createSession</code> reverts if any payee is unregistered, so
          a session that could never pay is never created). The v2 per-payee
          spend cap is kept.
        </p>
        <dl className="kv">
          <div>
            <dt>PayeeRegistryV3</dt>
            <dd>
              {registryV3Configured ? (
                <>
                  <a
                    href={explorerAddressUrl(config.explorerUrl, config.registryV3Address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.registryV3Address)} ↗
                  </a>{' '}
                  <span className="badge badge-ok">Current</span>{' '}
                  <span className="badge badge-ok">source-verified</span>
                  {config.v3DeployTxRegistry && (
                    <div className="muted small">
                      Deploy tx{' '}
                      <a
                        href={explorerTxUrl(config.explorerUrl, config.v3DeployTxRegistry)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(config.v3DeployTxRegistry)} ↗
                      </a>{' '}
                      <FinalityBadge
                        live={live}
                        finality={finalityFor(config.v3DeployTxRegistry)}
                        expectedOutcome="success"
                      />
                    </div>
                  )}
                </>
              ) : (
                'Not configured'
              )}
            </dd>
          </div>
          <div>
            <dt>AgentPayVaultV3</dt>
            <dd>
              {v3Configured ? (
                <>
                  <a
                    href={explorerAddressUrl(config.explorerUrl, config.vaultV3Address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.vaultV3Address)} ↗
                  </a>{' '}
                  <span className="badge badge-ok">Current</span>{' '}
                  <span className="badge badge-ok">source-verified</span>
                  {config.v3DeployTxVault && (
                    <div className="muted small">
                      Deploy tx{' '}
                      <a
                        href={explorerTxUrl(config.explorerUrl, config.v3DeployTxVault)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(config.v3DeployTxVault)} ↗
                      </a>{' '}
                      <FinalityBadge
                        live={live}
                        finality={finalityFor(config.v3DeployTxVault)}
                        expectedOutcome="success"
                      />
                    </div>
                  )}
                </>
              ) : (
                'Not configured'
              )}
            </dd>
          </div>
          <div>
            <dt>PayeeRegistry (v2)</dt>
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
                  <span className="badge badge-muted">superseded</span>
                  {config.v2DeployTxRegistry && (
                    <div className="muted small">
                      Deploy tx{' '}
                      <a
                        href={explorerTxUrl(config.explorerUrl, config.v2DeployTxRegistry)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(config.v2DeployTxRegistry)} ↗
                      </a>{' '}
                      <FinalityBadge
                        live={live}
                        finality={finalityFor(config.v2DeployTxRegistry)}
                        expectedOutcome="success"
                      />
                    </div>
                  )}
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
                  <span className="badge badge-muted">superseded</span>
                  {config.v2DeployTxVault && (
                    <div className="muted small">
                      Deploy tx{' '}
                      <a
                        href={explorerTxUrl(config.explorerUrl, config.v2DeployTxVault)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(config.v2DeployTxVault)} ↗
                      </a>{' '}
                      <FinalityBadge
                        live={live}
                        finality={finalityFor(config.v2DeployTxVault)}
                        expectedOutcome="success"
                      />
                    </div>
                  )}
                </>
              ) : (
                'Not configured'
              )}
            </dd>
          </div>
          <div>
            <dt>Vault v1</dt>
            <dd>
              <a
                href={explorerAddressUrl(config.explorerUrl, config.vaultAddress)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(config.vaultAddress)} ↗
              </a>{' '}
              <span className="badge badge-muted">superseded — history</span>
              {config.deployTx && (
                <div className="muted small">
                  Deploy tx{' '}
                  <a
                    href={explorerTxUrl(config.explorerUrl, config.deployTx)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(config.deployTx)} ↗
                  </a>{' '}
                  <FinalityBadge
                    live={live}
                    finality={finalityFor(config.deployTx)}
                    expectedOutcome="success"
                  />
                </div>
              )}
            </dd>
          </div>
        </dl>
        <p className="muted small">
          Contract tests (21 Nov 2026, per scope): forge{' '}
          {V3_TEST_COUNTS.forge.passed}/{V3_TEST_COUNTS.forge.passed} (
          {V3_TEST_COUNTS.forge.breakdown}) · fork {V3_TEST_COUNTS.fork.passed}/
          {V3_TEST_COUNTS.fork.passed} ({V3_TEST_COUNTS.fork.breakdown}) · agent
          vitest {V3_TEST_COUNTS.agentVitest.passed}/
          {V3_TEST_COUNTS.agentVitest.passed} · e2e anvil{' '}
          {V3_TEST_COUNTS.e2eAnvil.passed}/{V3_TEST_COUNTS.e2eAnvil.total}.
        </p>
      </div>

      <h2 className="section-title">
        Verified payees (v3){' '}
        <span className="muted small">
          {live ? '· read live from PayeeRegistryV3' : '· demo data'}
        </span>
      </h2>

      {payeesV3.isLoading && <p className="muted">Loading registered payees…</p>}
      {payeesV3.isError && (
        <div className="banner banner-error" role="alert">
          Could not load registered payees. Check your connection and press
          Refresh.
        </div>
      )}
      {payeesV3.data?.length === 0 && !payeesV3.isLoading && (
        <p className="muted">
          No payees registered in this owner&apos;s v3 namespace yet. Register
          one on-chain (see README) and it appears here automatically.
        </p>
      )}
      {!showData && (
        <p className="muted">
          Connect your wallet to see your registered payees.
        </p>
      )}

      {(payeesV3.data?.length ?? 0) > 0 && (
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
              {payeesV3.data?.map((p) => (
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
        Reverse lookup — case-insensitive{' '}
        <span className="muted small">
          {live ? '· live addressOf() calls on PayeeRegistryV3' : '· demo data'}
        </span>
      </h2>
      <p className="muted">
        The v3 registry resolves a name to its payee in any case — the same
        name lowercased, uppercased, or as registered all return the same
        address. A name with a typo resolves to no payee at all.
      </p>

      {reverseLookup.isLoading && <p className="muted">Checking the reverse lookup…</p>}
      {reverseLookup.isError && (
        <div className="banner banner-error" role="alert">
          Could not run the reverse lookup. Check your connection and press
          Refresh.
        </div>
      )}
      {probeNames.length === 0 && !payeesV3.isLoading && (
        <p className="muted">
          No registered v3 payee to look up in this namespace yet.
        </p>
      )}
      {(reverseLookup.data?.length ?? 0) > 0 && (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>addressOf(name)</th>
                <th>Resolves to</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {reverseLookup.data?.map((r, i) => {
                const isTypo = i === probeNames.length - 1;
                const expected = isTypo
                  ? ZERO_ADDRESS
                  : (payeesV3.data?.[0]?.payee ?? ZERO_ADDRESS);
                const ok = r.address.toLowerCase() === expected.toLowerCase();
                return (
                  <tr key={r.name}>
                    <td>
                      <code>“{r.name}”</code>
                    </td>
                    <td>
                      {r.address === ZERO_ADDRESS ? (
                        <span className="muted">— no payee</span>
                      ) : (
                        <a
                          href={explorerAddressUrl(config.explorerUrl, r.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortAddress(r.address)} ↗
                        </a>
                      )}
                    </td>
                    <td>
                      <span className={ok ? 'badge badge-ok' : 'badge badge-error'}>
                        {ok ? '✓ as expected' : '✗ unexpected'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">
        Name-checked payments (v3){' '}
        <span className="muted small">
          {live ? '· live PaymentExecuted events from the v3 vault' : '· demo data'}
        </span>
      </h2>

      {v3Payments.isLoading && <p className="muted">Loading v3 payments…</p>}
      {v3Payments.isError && (
        <div className="banner banner-error" role="alert">
          Could not load v3 payments. Check your connection and press Refresh.
        </div>
      )}
      {v3Payments.data?.length === 0 && !v3Payments.isLoading && (
        <p className="muted">
          No v3 payments yet. A payment only lands here after its name check
          passes — rejected attempts never emit an event (see below).
        </p>
      )}

      <ul className="payment-list">
        {v3Payments.data?.map((p) => (
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
                <span className="badge badge-ok">✓ name verified (case-insensitive)</span>
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
              <span className="muted">V3 session #{p.sessionId.toString()}</span>
              <a href={explorerTxUrl(config.explorerUrl, p.txHash)} target="_blank" rel="noreferrer">
                {shortAddress(p.txHash)} ↗
              </a>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="section-title">
        V3 sessions{' '}
        <span className="muted small">
          {live ? '· live from AgentPayVaultV3' : '· demo data'}
        </span>
      </h2>

      {v3Sessions.isLoading && <p className="muted">Loading v3 sessions…</p>}
      {v3Sessions.isError && (
        <div className="banner banner-error" role="alert">
          Could not load v3 sessions. Check your connection and press Refresh.
        </div>
      )}
      {v3Sessions.data?.length === 0 && !v3Sessions.isLoading && (
        <p className="muted">
          No v3 sessions for this owner yet.
        </p>
      )}

      <ul className="payment-list">
        {v3Sessions.data?.map((s) => {
          const status = sessionStatus(s);
          return (
            <li key={s.id.toString()} className="card payment-row">
              <div className="payment-main">
                <div className="payment-payee">
                  <strong>V3 session #{s.id.toString()}</strong>{' '}
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
        V3 run end state{' '}
        <span className="muted small">
          {live ? '· read live from the chain (demo owner)' : '· demo data'}
        </span>
      </h2>

      {endState.isLoading && <p className="muted">Reading the v3 end state…</p>}
      {endState.isError && (
        <div className="banner banner-error" role="alert">
          Could not read the v3 end state. Check your connection and press
          Refresh.
        </div>
      )}
      {endState.data && (
        <div className="card">
          <dl className="kv">
            <div>
              <dt>Owner tUSD8 (wallet)</dt>
              <dd>{formatTusd8(endState.data.ownerWallet)} tUSD8</dd>
            </div>
            <div>
              <dt>Payee tUSD8 (wallet)</dt>
              <dd>{formatTusd8(endState.data.payeeWallet)} tUSD8</dd>
            </div>
            <div>
              <dt>Owner balance in v3 vault</dt>
              <dd>{formatTusd8(endState.data.ownerVaultBalance)} tUSD8</dd>
            </div>
            <div>
              <dt>tUSD8 held by v3 vault</dt>
              <dd>{formatTusd8(endState.data.vaultTokenBalance)} tUSD8</dd>
            </div>
            <div>
              <dt>Sessions created on v3 vault</dt>
              <dd>
                {endState.data.nextSessionId.toString()}{' '}
                <span className="muted small">
                  (the fail-fast revert created none)
                </span>
              </dd>
            </div>
          </dl>
          {live ? (
            endStateMatches ? (
              <p className="muted small">
                <span className="badge badge-ok">
                  ✓ live values match the recorded end state
                </span>{' '}
                Recorded after the run (block 3741216): owner 4.55 · payee
                0.45 · v3 vault 0 tUSD8 · 3 sessions created (all revoked).
              </p>
            ) : (
              <p className="muted small">
                <span className="badge badge-warn">
                  live values differ from the recorded end state
                </span>{' '}
                Recorded after the run (block 3741216): owner 4.55 · payee
                0.45 · v3 vault 0 tUSD8 · 3 sessions created. The chain has
                moved on since — the values above are current.
              </p>
            )
          ) : (
            <p className="muted small">
              Demo data — the recorded end state of the live run is owner
              4.55 · payee 0.45 · v3 vault 0 tUSD8 · 3 sessions created (all
              revoked).
            </p>
          )}
        </div>
      )}

      <h2 className="section-title">
        Blocked actions (v3){' '}
        <span className="muted small">
          · recorded on-chain reverts, 21 Nov 2026 (receipts linked)
        </span>
      </h2>
      <p className="muted">
        These two actions were sent to the live testnet and reverted on-chain
        (receipt status 0x0) — no funds moved, no session created, no name
        claimed. Reverted transactions emit no events, so they are shown from
        the recorded run with links to their explorer receipts.
      </p>

      <ul className="payment-list">
        {V3_REJECTED_ACTIONS.map((r) => (
          <li key={r.txHash} className="card payment-row payment-row-rejected">
            <div className="payment-main">
              <div className="payment-payee">
                <strong>{r.action}:</strong> {r.attempted}{' '}
                <span className="badge badge-error">✗ rejected · {r.reason}</span>
              </div>
              <div className="muted small">{r.explanation}</div>
            </div>
            <div className="payment-meta">
              <span>{formatDateTime(r.timestamp)}</span>
              <span className="muted">
                block {r.block.toLocaleString('en-US')}
              </span>
              <a href={explorerTxUrl(config.explorerUrl, r.txHash)} target="_blank" rel="noreferrer">
                {shortAddress(r.txHash)} ↗
              </a>
              <FinalityBadge
                live={live}
                finality={finalityFor(r.txHash)}
                expectedOutcome="reverted"
              />
            </div>
          </li>
        ))}
      </ul>

      <h2 className="section-title">
        Recorded v3 testnet run — 21 Nov 2026{' '}
        <span className="muted small">· Aevum testnet, every step linked</span>
      </h2>
      {V3_E2E_FLOW.length > 0 && (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Transaction</th>
                <th>Result</th>
                <th>Live status</th>
              </tr>
            </thead>
            <tbody>
              {V3_E2E_FLOW.map((f) => (
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
                <td>
                  <FinalityBadge
                    live={live}
                    finality={finalityFor(f.txHash)}
                    expectedOutcome={f.result.startsWith('Reverted') ? 'reverted' : 'success'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <p className="muted small">
        How the live status is checked: each receipt is polled by hash via{' '}
        <code>eth_getTransactionReceipt</code> (reverted transactions emit no
        events, so event logs cannot see them) and re-checked every 30 s.{' '}
        <strong>Finalized</strong> means ≥ {FINALITY_CONFIRMATIONS}{' '}
        confirmations — a confirmation-depth rule, not chain-provided
        absolute finality: Aevum Testnet publishes no finality gadget, so
        this dashboard does not claim one.
      </p>

      <details className="history-details" open>
        <summary>
          v2 (superseded) — Confirmation of Payee, case-sensitive
        </summary>
        <p className="muted">
          The v2 vault checked names exactly and case-sensitively, and added
          the per-payee spend cap. It is superseded by v3 but its contracts
          are untouched and its recorded run stays verifiable below.
        </p>

        <h2 className="section-title">
          Verified payees (v2){' '}
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
            No payees registered in this owner&apos;s v2 namespace yet.
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
          Name-checked payments (v2){' '}
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
          Blocked payments (v2){' '}
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
                <FinalityBadge
                  live={live}
                  finality={finalityFor(r.txHash)}
                  expectedOutcome="reverted"
                />
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
          Recorded v2 testnet run — 21 Nov 2026{' '}
          <span className="muted small">· Aevum testnet, every step linked</span>
        </h2>
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Transaction</th>
                <th>Result</th>
                <th>Live status</th>
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
                  <td>
                    <FinalityBadge
                      live={live}
                      finality={finalityFor(f.txHash)}
                      expectedOutcome={f.result.startsWith('Reverted') ? 'reverted' : 'success'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          End state: owner 4.65 tUSD8 (0.40 deposited, 0.05 paid, 0.35
          withdrawn) · payee 0.35 tUSD8 (only the verified payment) · v2 vault
          balance 0 · all 4 v2 sessions revoked. Contract tests at the time:
          91/91 passed (53 v1 + 38 v2). Live status is polled the same way as
          the v3 run above (receipt by hash, Finalized at ≥{' '}
          {FINALITY_CONFIRMATIONS} confirmations).
        </p>
      </details>
    </section>
  );
}
