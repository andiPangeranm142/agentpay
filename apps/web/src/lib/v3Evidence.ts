import { parseUnits } from 'viem';
import type { FlowStep, RejectedAction } from './types';
import { V2_DEMO_PAYEE, V2_LOOKALIKE_PAYEE } from './v2Evidence';

/**
 * RECORDED ON-CHAIN EVIDENCE for the v3 (case-insensitive Confirmation
 * of Payee) testnet run, 21 November 2026, Aevum testnet (chain 44005).
 *
 * Official run: sessions 1–2, demo payee "Kedai Kopi Senja" (fictional
 * name). An earlier v3 run the same day (session 0, blocks 3740187–
 * 3740270) used a different demo name and is SUPERSEDED — its txs
 * remain on-chain but are not the official v3 evidence and are not
 * listed here.
 *
 * Rules (same as v2Evidence.ts): fixed historical facts, each verifiable
 * from its explorer link — NOT live reads and NOT mock data. Reverted
 * transactions emit no events, so they cannot be discovered by scanning
 * logs; they are recorded here with their receipts (status 0x0, verified
 * with `cast receipt` + `cast run` replay). The successful v3 payment IS
 * discovered live from PaymentExecuted events; it is listed in
 * V3_E2E_FLOW only as a cross-reference.
 *
 * Source of truth: contract-evidence.md (repo-adjacent run record).
 * Full tx hashes — never truncated in this file, so every link is exact.
 */

/**
 * Demo payee for the v3 run. Same test addresses as the v2 run; the NAME
 * is new: "Kedai Kopi Senja".
 */
export const V3_DEMO_PAYEE = V2_DEMO_PAYEE;
export const V3_DEMO_PAYEE_NAME = 'Kedai Kopi Senja';
export const V3_LOOKALIKE_PAYEE = V2_LOOKALIKE_PAYEE;

const u = (v: string) => parseUnits(v, 6);

/**
 * Recorded end state of the official v3 run (verified by `cast call`
 * after the flow, block 3741216). The dashboard cross-checks the live
 * chain values against these and shows whether they still match.
 */
export const V3_RECORDED_END_STATE = {
  /** Demo owner's tUSD8 wallet balance after the run (0.40 deposited, 0.05 paid, 0.35 withdrawn). */
  ownerWallet: u('4.55'),
  /** Demo payee's tUSD8 wallet balance after the run (received the 0.05 lowercase-name payment only). */
  payeeWallet: u('0.45'),
  /** Demo owner's remaining balance inside the v3 vault (0 = fully withdrawn). */
  ownerVaultBalance: 0n,
  /** tUSD8 the v3 vault contract itself holds (0 = fully withdrawn). */
  vaultTokenBalance: 0n,
  /** Sessions ever created on the v3 vault (0 in the superseded run, 1–2 in this run; the fail-fast revert created none). */
  nextSessionId: 3n,
} as const;

/**
 * The non-payment actions the v3 contracts rejected on-chain (status
 * 0x0) in the official run. The two rejected PAYMENTS (typo name,
 * removed lookalike) are recorded in V3_E2E_FLOW below — they have no
 * separate blocked-payment list because the v3 tab shows payments from
 * live events, and reverted payments emit none.
 */
export const V3_REJECTED_ACTIONS: RejectedAction[] = [
  {
    txHash:
      '0x32baa3382afceb645d7aad456d6de9e129c64769211f1f4173e97e930912b706',
    block: 3741125,
    timestamp: 1795257944, // 21 Nov 2026 10:45:44 UTC (block time)
    action: 'Register payee',
    attempted:
      'Register "KEDAI KOPI SENJA" for the lookalike address 0xc592…Ee8Ce',
    reason: 'NameAlreadyTaken',
    explanation:
      'The name "Kedai Kopi Senja" is already registered to the real payee (0xc592…Ee8Cd), and names are unique per owner case-insensitively — so registering the same name in ALL CAPS for a lookalike address reverted. The lookalike stays unregistered and the reverse lookup still resolves "KEDAI KOPI SENJA" to the real payee.',
  },
  {
    txHash:
      '0xffbc584cf45b981b8bf89b7f226ab1e954ed4ad770c3565d792d662447d6bcec',
    block: 3741142,
    timestamp: 1795257961, // 21 Nov 2026 10:46:01 UTC (block time)
    action: 'Create session',
    attempted:
      'Create a session with the unregistered lookalike address 0xc592…Ee8Ce on the allowlist',
    reason: 'PayeeNotRegistered',
    explanation:
      'Fail-fast: createSession checks every payee against the registry before creating anything. The lookalike had no registered name, so the session was never created — nextSessionId did not advance and no unusable session exists on-chain.',
  },
];

/** Key steps of the recorded v3 end-to-end run (all on Aevum testnet). */
export const V3_E2E_FLOW: FlowStep[] = [
  {
    step: 'Rename payee to "Kedai Kopi Senja" — updatePayee',
    txHash:
      '0x559d25fa9ba7f6f791cc29bdb6749261b4adf3b32ad052d64e64975bd7ba8596',
    block: 3741044,
    result: 'Success',
  },
  {
    step: 'Approve v3 vault 0.40 tUSD8',
    txHash:
      '0x5509d716f5b37e6d445dc0e8efe12aeabb5798fd876d123463fc73ef6a8794fe',
    block: 3741065,
    result: 'Success',
  },
  {
    step: 'Deposit 0.40 tUSD8 into the v3 vault',
    txHash:
      '0x32d4def8405fa1bf3c86ef3ffa17f8a46eb6fb549db8f5d8a41dfb6679cd56a3',
    block: 3741070,
    result: 'Success',
  },
  {
    step: 'Create session 1 (per-tx 0.10 · daily 0.20 · per-payee cap 0.15)',
    txHash:
      '0xa94ad2163ac3f283d06b301bb365fefad982e1be45919da36caf2923fd98b465',
    block: 3741082,
    result: 'Success',
  },
  {
    step: 'Pay 0.05 tUSD8 with lowercase name "kedai kopi senja"',
    txHash:
      '0xaa426288359993ec741b60401e34a12663a07ebbf8014bc274913ef6549dadbe',
    block: 3741093,
    result: 'Success — name verified ✓',
  },
  {
    step: 'Pay 0.05 with typo name "Kedai Kopi Senaj"',
    txHash:
      '0xad8466f3a59190f828c8b86f4c29ff079073b181479d93e9327243a56ba177e6',
    block: 3741107,
    result: 'Reverted ✗ PayeeNameMismatch',
  },
  {
    step: 'Register duplicate name "KEDAI KOPI SENJA" for lookalike …Ee8Ce',
    txHash:
      '0x32baa3382afceb645d7aad456d6de9e129c64769211f1f4173e97e930912b706',
    block: 3741125,
    result: 'Reverted ✗ NameAlreadyTaken',
  },
  {
    step: 'Create session with unregistered payee (lookalike)',
    txHash:
      '0xffbc584cf45b981b8bf89b7f226ab1e954ed4ad770c3565d792d662447d6bcec',
    block: 3741142,
    result: 'Reverted ✗ PayeeNotRegistered',
  },
  {
    step: 'Register lookalike under temp name "Kedai Kopi Senja 2"',
    txHash:
      '0x18c91e5bf4b0c0a7fd88c036968f0ac0f0312893c596efc6ba3ce5e2d7d29b07',
    block: 3741158,
    result: 'Success',
  },
  {
    step: 'Create session 2 (lookalike on allowlist)',
    txHash:
      '0x661fe19382e74264a7a3f3bb83ed5f0d28223f416af0d0f9c1f2efc645f18040',
    block: 3741165,
    result: 'Success',
  },
  {
    step: 'Remove lookalike from registry — removePayee',
    txHash:
      '0x66ba69ae8bd35dcb3e6b14e8166de4d19f41d04559a976467551dbacf7a067ef',
    block: 3741177,
    result: 'Success',
  },
  {
    step: 'Pay 0.05 to the removed lookalike (session 2)',
    txHash:
      '0xf4de0c3824f0f585388061e57c50cde3723862349ca5fe9219d952fc5588db37',
    block: 3741185,
    result: 'Reverted ✗ PayeeNotRegistered',
  },
  {
    step: 'Revoke session 1',
    txHash:
      '0x0653ec89ef5f6c83919b3531d28ed4d7896615b54992bed38786fb0001b035f5',
    block: 3741202,
    result: 'Success',
  },
  {
    step: 'Revoke session 2',
    txHash:
      '0x7edee6843af280849c1a344a5f838c7ebce2006fc0ad0457593a35eba3b0f4ac',
    block: 3741207,
    result: 'Success',
  },
  {
    step: 'Withdraw remaining 0.35 tUSD8',
    txHash:
      '0xa7975fe6d2680c80adb32e2fe97d2f7514619aca8b579a563e4654b145aed6eb',
    block: 3741211,
    result: 'Success',
  },
];

/**
 * Final test counts for the v3 release (run 21 Nov 2026). Each scope is
 * reported separately — never summed into one number, because the suites
 * cover different things.
 */
export const V3_TEST_COUNTS = {
  /** `forge test` (unit, no network): 53 v1 + 38 v2 + 51 new v3. */
  forge: { passed: 142, failed: 0, breakdown: '53 v1 + 38 v2 + 51 v3' },
  /** `forge test` fork (real tUSD8): 3 v1 + 4 new v3. */
  fork: { passed: 7, failed: 0, breakdown: '3 v1 + 4 v3' },
  /** vitest agent (`npm test` in apps/agent, 5 files). */
  agentVitest: { passed: 90, failed: 0, breakdown: '5 files' },
  /** e2e anvil (`npm run e2e` in apps/agent). */
  e2eAnvil: { passed: 17, total: 17, breakdown: '17 checks' },
} as const;
