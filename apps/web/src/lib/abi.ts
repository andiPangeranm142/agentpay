/**
 * ABIs for AgentPayVault + tUSD8 (ERC-20).
 *
 * Written against the FROZEN interface spec, then VERIFIED field-for-field
 * against the real contract at contracts/src/AgentPayVault.sol (20 Nov 2026):
 *   - getSession returns the full Session struct in exact field order:
 *     (sessionKey, owner, payees, perTxLimit, dailyLimit, spentToday,
 *     lastSpendDay, expiry, revoked, exists).
 *   - SessionCreated carries non-indexed (perTxLimit, dailyLimit, expiry)
 *     in addition to the indexed (sessionId, owner, sessionKey) — the full
 *     signature matters: viem hashes it for the log topic, and a shorter
 *     signature would match zero events.
 *   - `balances(address)` is a public view: the live vault balance is a
 *     single read, not an event derivation.
 *   - Custom errors are included so viem can decode reverts into readable
 *     names (mapped to plain language in lib/format.ts).
 *
 * If the contract changes, update this file only — nothing else imports
 * raw signatures except the parseAbiItem event strings in lib/provider.ts,
 * which must be kept in sync with the event definitions below.
 */
export const VAULT_ABI = [
  // --- Writes ---
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createSession',
    inputs: [
      { name: 'sessionKey', type: 'address' },
      { name: 'payees', type: 'address[]' },
      { name: 'perTxLimit', type: 'uint256' },
      { name: 'dailyLimit', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'sessionId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeSession',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pay',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // --- Views ---
  {
    type: 'function',
    name: 'balances',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextSessionId',
    inputs: [],
    outputs: [{ name: 'nextId', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSession',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [
      {
        name: 'session',
        type: 'tuple',
        components: [
          { name: 'sessionKey', type: 'address' },
          { name: 'owner', type: 'address' },
          { name: 'payees', type: 'address[]' },
          { name: 'perTxLimit', type: 'uint256' },
          { name: 'dailyLimit', type: 'uint256' },
          { name: 'spentToday', type: 'uint256' },
          { name: 'lastSpendDay', type: 'uint256' },
          { name: 'expiry', type: 'uint64' },
          { name: 'revoked', type: 'bool' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPayeeAllowed',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'allowed', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'remainingDailyAllowance',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [{ name: 'remaining', type: 'uint256' }],
    stateMutability: 'view',
  },
  // --- Events ---
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionCreated',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'sessionKey', type: 'address', indexed: true },
      { name: 'perTxLimit', type: 'uint256', indexed: false },
      { name: 'dailyLimit', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionRevoked',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PaymentExecuted',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  // --- Custom errors (so viem decodes reverts to readable names) ---
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'InvalidSessionKey', inputs: [] },
  { type: 'error', name: 'InvalidPayee', inputs: [] },
  { type: 'error', name: 'NoPayees', inputs: [] },
  { type: 'error', name: 'InvalidPerTxLimit', inputs: [] },
  { type: 'error', name: 'InvalidDailyLimit', inputs: [] },
  { type: 'error', name: 'InvalidExpiry', inputs: [] },
  { type: 'error', name: 'SessionNotFound', inputs: [] },
  { type: 'error', name: 'SessionIsRevoked', inputs: [] },
  { type: 'error', name: 'SessionExpired', inputs: [] },
  { type: 'error', name: 'NotSessionKey', inputs: [] },
  { type: 'error', name: 'NotSessionOwner', inputs: [] },
  { type: 'error', name: 'PayeeNotAllowed', inputs: [] },
  { type: 'error', name: 'ExceedsPerTxLimit', inputs: [] },
  { type: 'error', name: 'ExceedsDailyLimit', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
] as const;

/** Minimal ERC-20 surface needed for the approve + deposit flow. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'remaining', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'ok', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

/**
 * ABIs for AgentPayVaultV2 + PayeeRegistry (Confirmation of Payee, v2).
 *
 * Verified field-for-field against contracts/src/AgentPayVaultV2.sol and
 * contracts/src/PayeeRegistry.sol (21 Nov 2026):
 *   - V2 Session struct adds `perPayeeCap` after `dailyLimit` (before
 *     `spentToday`); field order matters for viem's tuple decoding.
 *   - V2 SessionCreated gains the non-indexed `perPayeeCap` field — the
 *     full signature matters for the log topic hash.
 *   - `pay` takes an extra `expectedName` string; the vault compares its
 *     keccak256 hash against the name registered for (session owner,
 *     payee) and reverts `PayeeNameMismatch` / `PayeeNotRegistered`.
 *   - `spentPerPayee` is a public mapping; `remainingPayeeAllowance` is
 *     the per-payee view helper.
 *   - Registry names live in per-owner namespaces:
 *     `nameOf(owner, payee)`.
 */
export const VAULT_V2_ABI = [
  // --- Writes ---
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createSession',
    inputs: [
      { name: 'sessionKey', type: 'address' },
      { name: 'payees', type: 'address[]' },
      { name: 'perTxLimit', type: 'uint256' },
      { name: 'dailyLimit', type: 'uint256' },
      { name: 'perPayeeCap', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'sessionId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeSession',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pay',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expectedName', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // --- Views ---
  {
    type: 'function',
    name: 'balances',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextSessionId',
    inputs: [],
    outputs: [{ name: 'nextId', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSession',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [
      {
        name: 'session',
        type: 'tuple',
        components: [
          { name: 'sessionKey', type: 'address' },
          { name: 'owner', type: 'address' },
          { name: 'payees', type: 'address[]' },
          { name: 'perTxLimit', type: 'uint256' },
          { name: 'dailyLimit', type: 'uint256' },
          { name: 'perPayeeCap', type: 'uint256' },
          { name: 'spentToday', type: 'uint256' },
          { name: 'lastSpendDay', type: 'uint256' },
          { name: 'expiry', type: 'uint64' },
          { name: 'revoked', type: 'bool' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPayeeAllowed',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'allowed', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'remainingDailyAllowance',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [{ name: 'remaining', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'spentPerPayee',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'spent', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'remainingPayeeAllowance',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'remaining', type: 'uint256' }],
    stateMutability: 'view',
  },
  // --- Events ---
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionCreated',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'sessionKey', type: 'address', indexed: true },
      { name: 'perTxLimit', type: 'uint256', indexed: false },
      { name: 'dailyLimit', type: 'uint256', indexed: false },
      { name: 'perPayeeCap', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionRevoked',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PaymentExecuted',
    inputs: [
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  // --- Custom errors ---
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'InvalidRegistry', inputs: [] },
  { type: 'error', name: 'InvalidSessionKey', inputs: [] },
  { type: 'error', name: 'InvalidPayee', inputs: [] },
  { type: 'error', name: 'NoPayees', inputs: [] },
  { type: 'error', name: 'InvalidPerTxLimit', inputs: [] },
  { type: 'error', name: 'InvalidDailyLimit', inputs: [] },
  { type: 'error', name: 'InvalidPerPayeeCap', inputs: [] },
  { type: 'error', name: 'InvalidExpiry', inputs: [] },
  { type: 'error', name: 'SessionNotFound', inputs: [] },
  { type: 'error', name: 'SessionIsRevoked', inputs: [] },
  { type: 'error', name: 'SessionExpired', inputs: [] },
  { type: 'error', name: 'NotSessionKey', inputs: [] },
  { type: 'error', name: 'NotSessionOwner', inputs: [] },
  { type: 'error', name: 'PayeeNotAllowed', inputs: [] },
  { type: 'error', name: 'ExceedsPerTxLimit', inputs: [] },
  { type: 'error', name: 'ExceedsDailyLimit', inputs: [] },
  { type: 'error', name: 'ExceedsPerPayeeCap', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  {
    type: 'error',
    name: 'PayeeNotRegistered',
    inputs: [{ name: 'payee', type: 'address' }],
  },
  {
    type: 'error',
    name: 'PayeeNameMismatch',
    inputs: [
      { name: 'expectedNameHash', type: 'bytes32' },
      { name: 'registeredNameHash', type: 'bytes32' },
    ],
  },
] as const;

/** PayeeRegistry: per-owner payee-name registry (v2). */
export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerPayee',
    inputs: [
      { name: 'payee', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updatePayee',
    inputs: [
      { name: 'payee', type: 'address' },
      { name: 'newName', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removePayee',
    inputs: [{ name: 'payee', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nameOf',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'name', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isRegistered',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'registered', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'matchesName',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'expectedName', type: 'string' },
    ],
    outputs: [{ name: 'matches', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'PayeeRegistered',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PayeeUpdated',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'oldName', type: 'string', indexed: false },
      { name: 'newName', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PayeeRemoved',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'oldName', type: 'string', indexed: false },
    ],
  },
  { type: 'error', name: 'InvalidPayee', inputs: [] },
  { type: 'error', name: 'EmptyName', inputs: [] },
  { type: 'error', name: 'NameTooLong', inputs: [] },
  { type: 'error', name: 'PayeeNotRegistered', inputs: [] },
  { type: 'error', name: 'PayeeAlreadyRegistered', inputs: [] },
] as const;

/**
 * ABIs for AgentPayVaultV3 + PayeeRegistryV3 (case-insensitive
 * Confirmation of Payee, v3).
 *
 * Verified field-for-field against contracts/src/AgentPayVaultV3.sol and
 * contracts/src/PayeeRegistryV3.sol (21 Nov 2026):
 *
 * - AgentPayVaultV3's EXTERNAL interface is identical to v2's: same
 *   functions, events, session struct (perPayeeCap included) and error
 *   names. The v3 differences are internal — fail-fast createSession
 *   (reverts PayeeNotRegistered for unregistered payees) and
 *   case-insensitive name matching via the v3 registry — so the v2 ABI
 *   is reused verbatim. (PayeeNameMismatch now carries normalized-name
 *   hashes, but the error signature is unchanged.)
 * - PayeeRegistryV3 keeps every v2 function/event and adds the reverse
 *   lookup `addressOf(owner, name)`, the `normalize` /
 *   `normalizedHash` / `registeredNameHash` views, and the
 *   `NameAlreadyTaken(holder)` error for per-owner name uniqueness.
 */
export const VAULT_V3_ABI = VAULT_V2_ABI;

export const REGISTRY_V3_ABI = [
  ...REGISTRY_ABI,
  {
    type: 'function',
    name: 'addressOf',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [{ name: 'payee', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'normalize',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'normalized', type: 'bytes' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'normalizedHash',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'hash', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'registeredNameHash',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: 'hash', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'error',
    name: 'NameAlreadyTaken',
    inputs: [{ name: 'holder', type: 'address' }],
  },
] as const;
