import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi';
import { isAddress, parseUnits, type Address } from 'viem';
import type { AppConfig } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import { VAULT_ABI } from '../lib/abi';
import { useSessions } from '../lib/hooks';
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatDate,
  formatTusd8,
  humanizeError,
  shortAddress,
} from '../lib/format';
import { sessionStatus, spentToday, type Session } from '../lib/types';
import { aevumTestnet } from '../lib/chain';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
}

function defaultExpiryInput(): string {
  const d = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Sessions({ config, provider }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const sessions = useSessions(provider, address);

  const live = config.mode === 'live';
  const onRightChain = chainId === aevumTestnet.id;

  // --- Create-session form state ---
  const [sessionKey, setSessionKey] = useState('');
  const [payeeInput, setPayeeInput] = useState('');
  const [payees, setPayees] = useState<Address[]>([]);
  const [payeeError, setPayeeError] = useState<string | null>(null);
  const [perTx, setPerTx] = useState('50');
  const [daily, setDaily] = useState('120');
  const [expiryInput, setExpiryInput] = useState(defaultExpiryInput);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createTx, setCreateTx] = useState<string | null>(null);

  // --- Revoke state: id awaiting confirmation, id in flight ---
  const [confirmRevokeId, setConfirmRevokeId] = useState<bigint | null>(null);
  const [revokingId, setRevokingId] = useState<bigint | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const addPayee = () => {
    const v = payeeInput.trim();
    if (!isAddress(v)) {
      setPayeeError('That doesn’t look like a valid address (0x… + 40 hex characters).');
      return;
    }
    if (payees.some((p) => p.toLowerCase() === v.toLowerCase())) {
      setPayeeError('That payee is already on the list.');
      return;
    }
    setPayees([...payees, v as Address]);
    setPayeeInput('');
    setPayeeError(null);
  };

  const parseLimit = (s: string): bigint | null => {
    try {
      const v = parseUnits(s.trim() === '' ? '0' : s.trim(), 6);
      return v;
    } catch {
      return null;
    }
  };

  const expirySec = Math.floor(new Date(expiryInput).getTime() / 1000);

  const formError: string | null = (() => {
    if (!live) return null;
    if (!isConnected) return 'Connect your wallet to create a session.';
    if (!onRightChain) return 'Wrong network — switch to Aevum Testnet (chain 44005).';
    if (!isAddress(sessionKey.trim())) return 'Enter a valid session-key address.';
    if (payees.length === 0) return 'Add at least one payee to the allowlist.';
    const p = parseLimit(perTx);
    const d = parseLimit(daily);
    if (p === null || p <= 0n) return 'Per-transaction limit must be a number above 0.';
    if (d === null || d <= 0n) return 'Daily limit must be a number above 0.';
    if (p > d) return 'Per-transaction limit can’t be higher than the daily limit.';
    if (!Number.isFinite(expirySec) || expirySec <= Date.now() / 1000)
      return 'Expiry must be a date in the future.';
    return null;
  })();

  const createSession = async () => {
    if (!live || !publicClient || formError) return;
    const p = parseLimit(perTx);
    const d = parseLimit(daily);
    if (p === null || d === null) return;
    setCreating(true);
    setCreateError(null);
    setCreateTx(null);
    try {
      const hash = await writeContractAsync({
        address: config.vaultAddress,
        abi: VAULT_ABI,
        functionName: 'createSession',
        args: [sessionKey.trim() as Address, payees, p, d, BigInt(expirySec)],
        type: 'legacy',
      });
      setCreateTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSessionKey('');
      setPayees([]);
      setPerTx('50');
      setDaily('120');
      setExpiryInput(defaultExpiryInput());
    } catch (e) {
      setCreateError(humanizeError(e));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: bigint) => {
    if (!live || !publicClient) return;
    setRevokingId(id);
    setRevokeError(null);
    setConfirmRevokeId(null);
    try {
      const hash = await writeContractAsync({
        address: config.vaultAddress,
        abi: VAULT_ABI,
        functionName: 'revokeSession',
        args: [id],
        type: 'legacy',
      });
      await publicClient.waitForTransactionReceipt({ hash });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    } catch (e) {
      setRevokeError(humanizeError(e));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section aria-label="Sessions">
      {!live && (
        <div className="banner banner-info">
          <strong>Demo data — contracts not deployed yet.</strong> The sessions below
          are examples. Creating and revoking sessions opens automatically once the
          vault is deployed.
        </div>
      )}

      <div className="card">
        <h2>Create a session key</h2>
        <p className="muted">
          A session key lets your AI agent pay — but only to the payees you allow,
          only up to your limits, and only until the expiry date. You can revoke it
          instantly at any time.
        </p>

        <label className="field">
          <span className="field-label">Session-key address</span>
          <input
            type="text"
            placeholder="0x… (the agent’s wallet address)"
            value={sessionKey}
            disabled={creating}
            onChange={(e) => setSessionKey(e.target.value)}
          />
          <span className="field-hint">
            This is the address your agent pays from. It never holds funds itself —
            it only spends from your vault within the limits below.
          </span>
        </label>

        <div className="field">
          <span className="field-label">Payee allowlist</span>
          <div className="input-row">
            <input
              type="text"
              placeholder="0x… payee address"
              value={payeeInput}
              disabled={creating}
              onChange={(e) => {
                setPayeeInput(e.target.value);
                setPayeeError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPayee();
                }
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addPayee} disabled={creating}>
              Add payee
            </button>
          </div>
          {payeeError && (
            <div className="inline-error" role="alert">
              {payeeError}
            </div>
          )}
          {payees.length > 0 && (
            <ul className="chip-list">
              {payees.map((p) => (
                <li key={p} className="chip">
                  <span title={p}>{shortAddress(p)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p}`}
                    onClick={() => setPayees(payees.filter((x) => x !== p))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {payees.length === 0 && (
            <span className="field-hint">No payees yet — the agent can only pay addresses on this list.</span>
          )}
        </div>

        <div className="grid grid-2">
          <label className="field">
            <span className="field-label">Per-transaction limit (tUSD8)</span>
            <input
              type="text"
              inputMode="decimal"
              value={perTx}
              disabled={creating}
              onChange={(e) => setPerTx(e.target.value.replace(/[^0-9.]/g, ''))}
            />
          </label>
          <label className="field">
            <span className="field-label">Daily limit (tUSD8)</span>
            <input
              type="text"
              inputMode="decimal"
              value={daily}
              disabled={creating}
              onChange={(e) => setDaily(e.target.value.replace(/[^0-9.]/g, ''))}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Expiry</span>
          <input
            type="datetime-local"
            value={expiryInput}
            disabled={creating}
            onChange={(e) => setExpiryInput(e.target.value)}
          />
          <span className="field-hint">After this date the session key can no longer pay.</span>
        </label>

        {formError && live && (
          <div className="inline-error" role="alert">
            {formError}
          </div>
        )}
        {createError && (
          <div className="banner banner-error" role="alert">
            {createError}
          </div>
        )}
        {createTx && !createError && (
          <div className="banner banner-ok" role="status">
            <strong>Session created.</strong>{' '}
            <a href={explorerTxUrl(config.explorerUrl, createTx)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          disabled={!live || creating || !!formError}
          onClick={createSession}
        >
          {creating ? 'Creating… confirm in your wallet' : 'Create session'}
        </button>
      </div>

      <h2 className="section-title">
        Your sessions
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void sessions.refetch()}
          disabled={sessions.isFetching}
        >
          {sessions.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </h2>

      {revokeError && (
        <div className="banner banner-error" role="alert">
          {revokeError}
        </div>
      )}
      {sessions.isLoading && <p className="muted">Loading sessions…</p>}
      {sessions.isError && (
        <div className="banner banner-error" role="alert">
          Could not load sessions. Check your connection and press Refresh.
        </div>
      )}
      {sessions.data?.length === 0 && (
        <p className="muted">
          No sessions yet. Create one above to let your agent start paying bills.
        </p>
      )}

      <div className="session-list">
        {sessions.data?.map((s) => (
          <SessionCard
            key={s.id.toString()}
            session={s}
            explorerUrl={config.explorerUrl}
            live={live}
            confirmRevoke={confirmRevokeId === s.id}
            revoking={revokingId === s.id}
            onAskRevoke={() => setConfirmRevokeId(s.id)}
            onCancelRevoke={() => setConfirmRevokeId(null)}
            onRevoke={() => void revoke(s.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SessionCard({
  session: s,
  explorerUrl,
  live,
  confirmRevoke,
  revoking,
  onAskRevoke,
  onCancelRevoke,
  onRevoke,
}: {
  session: Session;
  explorerUrl: string;
  live: boolean;
  confirmRevoke: boolean;
  revoking: boolean;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
}) {
  const status = sessionStatus(s);
  const spent = spentToday(s);
  const usedPct =
    s.dailyLimit > 0n ? Math.min(100, Number((spent * 100n) / s.dailyLimit)) : 0;

  return (
    <article className="card session-card">
      <div className="session-head">
        <h3>
          {s.label ?? `Session #${s.id.toString()}`}
          {!s.label && <span className="muted small"> · #{s.id.toString()}</span>}
        </h3>
        <span
          className={`badge ${
            status === 'active' ? 'badge-ok' : status === 'expired' ? 'badge-warn' : 'badge-muted'
          }`}
        >
          {status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Revoked'}
        </span>
      </div>

      <dl className="kv">
        <div>
          <dt>Session key</dt>
          <dd>
            <a href={explorerAddressUrl(explorerUrl, s.sessionKey)} target="_blank" rel="noreferrer">
              {shortAddress(s.sessionKey)} ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>Payees allowed</dt>
          <dd>
            {s.payees.length} —{' '}
            {s.payees.slice(0, 3).map((p) => shortAddress(p)).join(', ')}
            {s.payees.length > 3 && ` +${s.payees.length - 3} more`}
          </dd>
        </div>
        <div>
          <dt>Per-transaction limit</dt>
          <dd>{formatTusd8(s.perTxLimit)} tUSD8</dd>
        </div>
        <div>
          <dt>Daily limit</dt>
          <dd>{formatTusd8(s.dailyLimit)} tUSD8</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatDate(s.expiry)}</dd>
        </div>
        <div>
          <dt>Remaining today</dt>
          <dd>
            <strong>{formatTusd8(s.remainingDaily)} tUSD8</strong>{' '}
            <span className="muted">({formatTusd8(spent)} spent)</span>
          </dd>
        </div>
      </dl>

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

      {status === 'active' && (
        <div className="card-actions">
          {confirmRevoke ? (
            <>
              <button className="btn btn-danger" disabled={revoking} onClick={onRevoke}>
                {revoking ? 'Revoking…' : 'Yes, revoke now'}
              </button>
              <button className="btn btn-ghost" disabled={revoking} onClick={onCancelRevoke}>
                Cancel
              </button>
              <span className="muted small">
                Revoking stops this session key immediately. It cannot be undone.
              </span>
            </>
          ) : (
            <button className="btn btn-danger-outline" disabled={!live} onClick={onAskRevoke}>
              Revoke session
            </button>
          )}
        </div>
      )}
    </article>
  );
}
