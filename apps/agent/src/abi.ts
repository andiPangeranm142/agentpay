/**
 * AgentPayVault ABI — verified against the real contract artifact at
 * ../../contracts/out/AgentPayVault.sol/AgentPayVault.json (contracts
 * workstream). The interface matches the frozen spec; the `getSession`
 * return shape is the real struct:
 *   (sessionKey, owner, payees[], perTxLimit, dailyLimit, spentToday,
 *    lastSpendDay, expiry, revoked, exists).
 * If the contracts workstream ever changes the struct, update this ABI and
 * the SessionInfo parsing in executor.ts together. The executor still
 * treats `getSession` as best-effort preflight: if the call fails, it logs
 * a warning and falls back to the other views + the on-chain `pay()`
 * enforcement, which is authoritative.
 */

export const VAULT_ABI = [
  // Custom errors (copied verbatim from the real artifact) so viem decodes
  // revert reasons into names instead of raw 4-byte selectors.
  { type: 'error', name: 'ExceedsDailyLimit', inputs: [] },
  { type: 'error', name: 'ExceedsPerTxLimit', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  { type: 'error', name: 'InvalidDailyLimit', inputs: [] },
  { type: 'error', name: 'InvalidExpiry', inputs: [] },
  { type: 'error', name: 'InvalidPayee', inputs: [] },
  { type: 'error', name: 'InvalidPerTxLimit', inputs: [] },
  { type: 'error', name: 'InvalidSessionKey', inputs: [] },
  { type: 'error', name: 'NoPayees', inputs: [] },
  { type: 'error', name: 'NotSessionKey', inputs: [] },
  { type: 'error', name: 'NotSessionOwner', inputs: [] },
  { type: 'error', name: 'PayeeNotAllowed', inputs: [] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
  { type: 'error', name: 'SafeERC20FailedOperation', inputs: [{ name: 'token', type: 'address' }] },
  { type: 'error', name: 'SessionExpired', inputs: [] },
  { type: 'error', name: 'SessionIsRevoked', inputs: [] },
  { type: 'error', name: 'SessionNotFound', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
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
  {
    type: 'function',
    name: 'getSession',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [
      {
        name: '',
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
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'remainingDailyAllowance',
    inputs: [{ name: 'sessionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
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
] as const;

/** Minimal ERC-20 surface the agent needs (balance checks only). */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

/** tUSD8 has 6 decimals on Aevum Testnet. */
export const TOKEN_DECIMALS = 6;
