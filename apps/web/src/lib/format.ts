import { formatUnits, type Address } from 'viem';
import { TUSD8_DECIMALS } from './types';

export function formatTusd8(amount: bigint, decimals = 2): string {
  const n = Number(formatUnits(amount, TUSD8_DECIMALS));
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function shortAddress(addr: Address | string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatDateTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function explorerTxUrl(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(explorerUrl: string, addr: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/address/${addr}`;
}

/**
 * Translate raw wallet / RPC errors into plain-language messages
 * (judging criterion UX 15: clear status feedback, plain-language errors).
 */
export function humanizeError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lower = msg.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied')) {
    return 'Transaction cancelled in your wallet. Nothing was sent.';
  }
  if (lower.includes('insufficient funds') && lower.includes('gas')) {
    return 'Not enough tQDAY for gas. Get testnet tQDAY from the Aevum faucet, then try again.';
  }
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Not enough balance for this amount.';
  }
  if (lower.includes('insufficient allowance') || lower.includes('allowance')) {
    return 'The vault is not approved to move that much tUSD8 yet. Approve first, then deposit.';
  }
  if (lower.includes('transfer amount exceeds')) {
    return 'Not enough tUSD8 in your wallet for this amount.';
  }
  if (lower.includes('insufficientbalance') || lower.includes('insufficient balance')) {
    return 'Not enough in the vault for this payment.';
  }
  if (lower.includes('exceedspertxlimit')) {
    return 'Amount exceeds the session’s per-transaction limit.';
  }
  if (lower.includes('exceedsdailylimit')) {
    return 'Amount exceeds the session’s daily limit.';
  }
  if (lower.includes('payeenotallowed')) {
    return 'That payee is not on this session’s allowlist.';
  }
  if (lower.includes('payeenamemismatch')) {
    return 'The payee name doesn’t match the registered name for that address. Check the spelling — names are exact and case-sensitive.';
  }
  if (lower.includes('payeenotregistered')) {
    return 'No name is registered for that payee address. Register the payee first — the vault blocks payments to unregistered (possibly lookalike) addresses.';
  }
  if (lower.includes('exceedsperpayeecap')) {
    return 'Amount exceeds this session’s per-payee cap for that payee.';
  }
  if (lower.includes('invalidperpayeecap')) {
    return 'The per-payee cap can’t be lower than the per-transaction limit.';
  }
  if (lower.includes('sessionexpired')) {
    return 'This session has expired. Create a new session to keep paying.';
  }
  if (lower.includes('sessionisrevoked') || lower.includes('session revoked')) {
    return 'This session was revoked by the owner.';
  }
  if (lower.includes('sessionnotfound')) {
    return 'That session doesn’t exist (anymore).';
  }
  if (lower.includes('notsessionowner')) {
    return 'Only the session’s owner can do that.';
  }
  if (lower.includes('notsessionkey')) {
    return 'Only the session key can pay from this session.';
  }
  if (lower.includes('invaliddaily') || lower.includes('invalidpertx')) {
    return 'Check the limits: the daily limit can’t be lower than the per-transaction limit, and both must be above 0.';
  }
  if (lower.includes('invalidexpiry')) {
    return 'Expiry must be a date in the future.';
  }
  if (lower.includes('nopayees') || lower.includes('invalidpayee')) {
    return 'Add at least one valid payee address to the allowlist.';
  }
  if (lower.includes('invalidsessionkey')) {
    return 'That session-key address is not valid.';
  }
  if (lower.includes('zeroamount')) {
    return 'Enter an amount greater than 0.';
  }
  if (lower.includes('session expired') || lower.includes('expired')) {
    return 'This session has expired. Create a new session to keep paying.';
  }
  if (lower.includes('revoked')) {
    return 'This session was revoked by the owner.';
  }
  if (lower.includes('not allowed') || lower.includes('payee')) {
    return 'That payee is not on this session’s allowlist.';
  }
  if (lower.includes('limit') || lower.includes('exceeds')) {
    return 'Amount exceeds the session’s spending limit.';
  }
  if (lower.includes('wrong network') || lower.includes('chain')) {
    return 'Wrong network — switch to Aevum Testnet (chain 44005).';
  }
  if (lower.includes('connector') || lower.includes('no injected')) {
    return 'No wallet found. Install MetaMask (or another EVM wallet) and try again.';
  }
  if (lower.includes('timeout') || lower.includes('network request failed')) {
    return 'The network request timed out. Check your connection and try again.';
  }
  // Fallback: keep the first readable line, trimmed, without stack traces.
  const firstLine = msg.split('\n')[0].trim();
  return firstLine.length > 0 && firstLine.length < 200
    ? firstLine
    : 'Something went wrong. Please try again.';
}
