import {
  FINALITY_CONFIRMATIONS,
  finalityLabel,
  type TxFinality,
} from '../lib/finality';

interface Props {
  /** Live finality for this tx, or undefined while the watcher hasn't reported yet. */
  finality?: TxFinality;
  /** False in mock mode (zero RPC calls) — the badge says so instead of faking a status. */
  live: boolean;
  /**
   * The outcome the recorded evidence expects ('success' for a tx the run
   * says succeeded, 'reverted' for a recorded revert). When the live
   * receipt disagrees, a warning badge is shown next to the status —
   * the receipt is the authority, so a mismatch must never be silent.
   */
  expectedOutcome?: 'success' | 'reverted';
}

/**
 * One evidence transaction's live receipt status: Checking… -> Seen ->
 * Finalized (>= FINALITY_CONFIRMATIONS confirmations). The badge is
 * honest about what it is: a confirmation-depth rule, not chain-provided
 * absolute finality (Aevum publishes no finality gadget) — see
 * lib/finality.ts and the footnote under the evidence tables.
 */
export function FinalityBadge({ finality, live, expectedOutcome }: Props) {
  if (!live) {
    return (
      <span className="badge badge-muted" title="Live receipt status needs the RPC — unavailable in demo mode.">
        Status: demo mode
      </span>
    );
  }
  if (!finality) {
    return <span className="badge badge-muted">Checking…</span>;
  }
  const badgeClass =
    finality.state === 'finalized'
      ? 'badge badge-ok'
      : finality.state === 'seen'
        ? 'badge badge-warn'
        : finality.state === 'not-found'
          ? 'badge badge-error'
          : 'badge badge-muted';
  const title =
    finality.state === 'finalized'
      ? `Receipt confirmed on-chain with ${finality.confirmations} confirmations (>= ${FINALITY_CONFIRMATIONS} = Finalized by the dashboard's confirmation-depth rule; Aevum publishes no absolute-finality gadget).`
      : finality.state === 'seen'
        ? `Receipt seen on-chain with ${finality.confirmations ?? '?'} confirmations; Finalized at >= ${FINALITY_CONFIRMATIONS}.`
        : finality.state === 'not-found'
          ? 'No receipt found for this hash on the RPC — the transaction may not exist on this chain.'
          : 'The RPC could not be reached to check this receipt.';
  const mismatch =
    expectedOutcome !== undefined &&
    finality.receiptStatus !== null &&
    finality.receiptStatus !== expectedOutcome;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <span className={badgeClass} title={title}>
        {finalityLabel(finality)}
      </span>
      {mismatch && (
        <span
          className="badge badge-error"
          title={`Recorded evidence says this tx ${expectedOutcome}, but the live receipt says ${finality.receiptStatus}. The receipt is authoritative — the recorded evidence needs correcting.`}
        >
          ⚠ receipt mismatch
        </span>
      )}
    </span>
  );
}
