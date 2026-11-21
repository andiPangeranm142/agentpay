import { parseUnits, type Address } from 'viem';
import type { RejectedPayment } from './types';

/**
 * RECORDED ON-CHAIN EVIDENCE for the v2 (Confirmation of Payee) testnet run,
 * 21 November 2026, Aevum testnet (chain 44005).
 *
 * These are fixed historical facts, each verifiable from its explorer link —
 * they are NOT live reads and NOT mock data. Reverted transactions emit no
 * events, so the two rejections below cannot be discovered by scanning logs;
 * they are recorded here with their receipts (status 0x0, verified with
 * `cast receipt` + `cast run` replay). The successful v2 payment IS
 * discovered live from PaymentExecuted events; it is listed in
 * V2_E2E_FLOW only as a cross-reference.
 *
 * Source of truth: contract-evidence.md (repo-adjacent run record).
 * Full tx hashes — never truncated in this file, so every link is exact.
 */

const A = (s: string) => s as Address;
const u = (v: string) => parseUnits(v, 6);

/** The lookalike address used in the test: last hex char differs from the real payee. */
export const V2_LOOKALIKE_PAYEE = A('0xc592286d027E701A5bb0681675C1F4d80d2Ee8Ce');
export const V2_DEMO_PAYEE = A('0xc592286d027E701A5bb0681675C1F4d80d2Ee8Cd');
export const V2_DEMO_PAYEE_NAME = 'Sari Bakery';

/** The two payments the vault rejected on-chain (status 0x0). */
export const V2_REJECTED_PAYMENTS: RejectedPayment[] = [
  {
    txHash:
      '0x10f6ab903215a582825ddd30c6a4bc68c8976f0ed504d7cc5cfa8bd64adbfd04',
    block: 3730568,
    timestamp: 1795247250, // 21 Nov 2026 07:47:30 UTC (block time)
    sessionId: 2n,
    payee: V2_DEMO_PAYEE,
    amount: u('0.05'),
    attemptedName: 'Sari Bakrey',
    reason: 'PayeeNameMismatch',
    explanation:
      'The agent asked to pay "Sari Bakrey" (typo) to the real payee address. The registered name is "Sari Bakery", so the vault reverted — a mistyped or spoofed name can never move funds.',
  },
  {
    txHash:
      '0x5d3e1dc927b9d24f75782c6b45db5666e8381bbe7d84a1edb0538a2e432bcb58',
    block: 3730575,
    timestamp: 1795247257, // 21 Nov 2026 07:47:37 UTC (block time)
    sessionId: 3n,
    payee: V2_LOOKALIKE_PAYEE,
    amount: u('0.05'),
    attemptedName: 'Sari Bakery',
    reason: 'PayeeNotRegistered',
    explanation:
      'The agent tried to pay the correct name to a lookalike address (last hex char changed: …Ee8Ce instead of …Ee8Cd). No name is registered for that address, so the vault reverted — address-spoofing is blocked even with the right name.',
  },
];

/** Key steps of the recorded v2 end-to-end run (all on Aevum testnet). */
export interface V2FlowStep {
  step: string;
  txHash: `0x${string}`;
  block: number;
  result: string;
}

export const V2_E2E_FLOW: V2FlowStep[] = [
  {
    step: 'Deposit 0.40 tUSD8 into the v2 vault',
    txHash:
      '0x08951d792055d20394e2c5b1b94d9fd2ddafa9dc193906438680d1f65772a75a',
    block: 3730490,
    result: 'Success',
  },
  {
    step: 'Register payee "Sari Bakery" → 0xc592…Ee8Cd',
    txHash:
      '0xaf6590f401888038b5d6e0c1b3a732ff7e1d2ddc98e1b15f059f51e87805765d',
    block: 3730496,
    result: 'Success',
  },
  {
    step: 'Create session 0 (per-tx 0.10 · daily 0.20 · per-payee cap 0.15)',
    txHash:
      '0x3c115ff3899f5aec123b696df7862b849adeacd860386e3aac6d7bd8f1b14a6d',
    block: 3730502,
    result: 'Success',
  },
  {
    step: 'Pay 0.05 tUSD8 with matching name "Sari Bakery"',
    txHash:
      '0xad45efe0db4e36285a608386e6e4fa520b0ffda6ff4db3bba9be3f051ecab2a5',
    block: 3730507,
    result: 'Success — name verified ✓',
  },
  {
    step: 'Pay 0.05 with wrong name "Sari Bakrey"',
    txHash:
      '0x10f6ab903215a582825ddd30c6a4bc68c8976f0ed504d7cc5cfa8bd64adbfd04',
    block: 3730568,
    result: 'Reverted ✗ PayeeNameMismatch',
  },
  {
    step: 'Pay 0.05 to lookalike address …Ee8Ce',
    txHash:
      '0x5d3e1dc927b9d24f75782c6b45db5666e8381bbe7d84a1edb0538a2e432bcb58',
    block: 3730575,
    result: 'Reverted ✗ PayeeNotRegistered',
  },
  {
    step: 'Withdraw remaining 0.35 tUSD8',
    txHash:
      '0xeb5b613bdc879d7fd214fc8c170afad7886f6251aadfcc3e46fbbb3a92975be7',
    block: 3730535,
    result: 'Success',
  },
];
