import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import type { AppConfig } from '../config';
import type { VaultDataProvider } from '../lib/provider';
import { ERC20_ABI, VAULT_ABI } from '../lib/abi';
import { useAllowance, useVaultBalance, useWalletTusd8Balance } from '../lib/hooks';
import { explorerTxUrl, formatTusd8, humanizeError } from '../lib/format';
import { TUSD8_DECIMALS } from '../lib/types';
import { aevumTestnet } from '../lib/chain';

type Mode = 'deposit' | 'withdraw';
type Step =
  | 'idle'
  | 'approving'
  | 'approve-confirming'
  | 'depositing'
  | 'deposit-confirming'
  | 'withdrawing'
  | 'withdraw-confirming'
  | 'done'
  | 'error';

interface Props {
  config: AppConfig;
  provider: VaultDataProvider;
}

const STEP_LABEL: Record<Exclude<Step, 'idle' | 'done' | 'error'>, string> = {
  approving: 'Approving… confirm in your wallet',
  'approve-confirming': 'Approving… waiting for confirmation',
  depositing: 'Depositing… confirm in your wallet',
  'deposit-confirming': 'Depositing… waiting for confirmation',
  withdrawing: 'Withdrawing… confirm in your wallet',
  'withdraw-confirming': 'Withdrawing… waiting for confirmation',
};

/**
 * Deposit / Withdraw with an explicit approve -> deposit flow and
 * step-by-step status. All transactions are LEGACY (type 0) — Aevum
 * requires it (see starter kit docs).
 */
export function DepositWithdraw({ config, provider }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const vault = useVaultBalance(provider, address);
  const wallet = useWalletTusd8Balance(provider, address);
  const allowance = useAllowance(provider, address);

  const live = config.mode === 'live';
  const onRightChain = chainId === aevumTestnet.id;
  const busy = step !== 'idle' && step !== 'done' && step !== 'error';

  const parsed = (() => {
    try {
      const v = amount.trim() === '' ? 0n : parseUnits(amount.trim(), TUSD8_DECIMALS);
      return v;
    } catch {
      return null;
    }
  })();

  const walletBalance = wallet.data ?? 0n;
  const vaultBalance = vault.data ?? 0n;
  const needsApproval =
    live && mode === 'deposit' && parsed !== null && parsed > 0n && (allowance.data ?? 0n) < parsed;

  const validationError: string | null = (() => {
    if (!live) return null;
    if (!isConnected) return 'Connect your wallet to deposit or withdraw.';
    if (!onRightChain) return 'Wrong network — switch to Aevum Testnet (chain 44005).';
    if (parsed === null) return 'Enter a valid amount, e.g. 10.50.';
    if (parsed <= 0n) return 'Enter an amount greater than 0.';
    if (mode === 'deposit' && parsed > walletBalance)
      return `Not enough tUSD8 — your wallet holds ${formatTusd8(walletBalance)} tUSD8.`;
    if (mode === 'withdraw' && parsed > vaultBalance)
      return `Not enough in the vault — it holds ${formatTusd8(vaultBalance)} tUSD8.`;
    return null;
  })();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['vaultBalance'] });
    void queryClient.invalidateQueries({ queryKey: ['walletTusd8'] });
    void queryClient.invalidateQueries({ queryKey: ['allowance'] });
  };

  const submit = async () => {
    if (!live || !address || !publicClient || parsed === null || validationError) return;
    setError(null);
    setLastTx(null);
    try {
      if (mode === 'deposit') {
        if (needsApproval) {
          setStep('approving');
          const approveHash = await writeContractAsync({
            address: config.tusd8Address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [config.vaultAddress, parsed],
            type: 'legacy',
          });
          setLastTx(approveHash);
          setStep('approve-confirming');
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        setStep('depositing');
        const depHash = await writeContractAsync({
          address: config.vaultAddress,
          abi: VAULT_ABI,
          functionName: 'deposit',
          args: [parsed],
          type: 'legacy',
        });
        setLastTx(depHash);
        setStep('deposit-confirming');
        await publicClient.waitForTransactionReceipt({ hash: depHash });
      } else {
        setStep('withdrawing');
        const wHash = await writeContractAsync({
          address: config.vaultAddress,
          abi: VAULT_ABI,
          functionName: 'withdraw',
          args: [parsed],
          type: 'legacy',
        });
        setLastTx(wHash);
        setStep('withdraw-confirming');
        await publicClient.waitForTransactionReceipt({ hash: wHash });
      }
      setStep('done');
      setAmount('');
      refresh();
    } catch (e) {
      setStep('error');
      setError(humanizeError(e));
    }
  };

  return (
    <section aria-label="Deposit and withdraw">
      {!live && (
        <div className="banner banner-info">
          <strong>Demo data — contracts not deployed yet.</strong> Deposits and
          withdrawals are disabled until the vault contract is deployed and
          configured. The full approve → deposit flow is implemented and ready.
        </div>
      )}

      <div className="card card-narrow">
        <div className="segmented" role="tablist" aria-label="Deposit or withdraw">
          <button
            role="tab"
            aria-selected={mode === 'deposit'}
            className={mode === 'deposit' ? 'active' : ''}
            onClick={() => {
              setMode('deposit');
              setStep('idle');
              setError(null);
            }}
          >
            Deposit
          </button>
          <button
            role="tab"
            aria-selected={mode === 'withdraw'}
            className={mode === 'withdraw' ? 'active' : ''}
            onClick={() => {
              setMode('withdraw');
              setStep('idle');
              setError(null);
            }}
          >
            Withdraw
          </button>
        </div>

        <label className="field">
          <span className="field-label">
            Amount (tUSD8)
            <span className="field-hint">
              {live && !isConnected
                ? '—'
                : mode === 'deposit'
                  ? `Wallet: ${formatTusd8(walletBalance)} tUSD8`
                  : `Vault: ${formatTusd8(vaultBalance)} tUSD8`}
            </span>
          </span>
          <div className="input-row">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={busy}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                if (step === 'done' || step === 'error') setStep('idle');
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || (live && !isConnected)}
              onClick={() =>
                setAmount(
                  formatUnits(mode === 'deposit' ? walletBalance : vaultBalance, TUSD8_DECIMALS),
                )
              }
            >
              Max
            </button>
          </div>
        </label>

        {mode === 'deposit' && live && isConnected && (
          <p className="muted small">
            {needsApproval
              ? 'This needs two transactions: 1) approve the vault to move your tUSD8, 2) deposit. You confirm each in your wallet.'
              : 'The vault is already approved for this amount — one transaction.'}
          </p>
        )}

        {validationError && live && (
          <div className="inline-error" role="alert">
            {validationError}
          </div>
        )}

        {busy && (
          <div className="status-line" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {STEP_LABEL[step as keyof typeof STEP_LABEL]}
            {lastTx && (
              <a
                href={explorerTxUrl(config.explorerUrl, lastTx)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
          </div>
        )}

        {step === 'done' && lastTx && (
          <div className="banner banner-ok" role="status">
            <strong>Done.</strong>{' '}
            {mode === 'deposit' ? 'Deposit confirmed.' : 'Withdrawal confirmed.'}{' '}
            <a href={explorerTxUrl(config.explorerUrl, lastTx)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          </div>
        )}

        {step === 'error' && error && (
          <div className="banner banner-error" role="alert">
            {error}
            {lastTx && (
              <>
                {' '}
                <a href={explorerTxUrl(config.explorerUrl, lastTx)} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              </>
            )}
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          disabled={!live || busy || !!validationError}
          onClick={submit}
        >
          {mode === 'deposit'
            ? needsApproval
              ? 'Approve & deposit'
              : 'Deposit'
            : 'Withdraw'}
        </button>
        {!live && (
          <p className="muted small center">
            Live deposits open automatically once the vault is deployed.
          </p>
        )}
      </div>
    </section>
  );
}
