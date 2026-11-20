# AgentPay Agent Service

Autonomous scheduler + executor that pays scheduled bills in tUSD8 from the
AgentPayVault on **Aevum Testnet** (chain 44005), using narrow session keys.

The agent never holds the vault owner's key. Each schedule is bound to a
vault session; the agent only ever calls `pay()` as that session's key.

## How it works

```
schedules.json ──► poll every 30s ──► due? ──► preflight checks ──► simulate ──► pay() (legacy tx)
                                            │                                              │
                                     state/agent-state.json ◄── record ──► PaymentExecuted on-chain
```

1. **Scheduler** — each schedule has an `every` interval (`"30s"`, `"1h"`,
   `"1d"`, `"1w"`, …) or `intervalSeconds`. A schedule is due when its
   current period (epoch-aligned bucket `floor(now / interval)`) has not
   been paid yet. Missed periods are **not** back-paid: if the agent was
   down for 3 periods, it pays once for the current period.
2. **Idempotency** — after every successful payment the period key is
   persisted to `state/agent-state.json` (atomic write: tmp file + rename).
   A restart can never double-pay the same period. A corrupt state file
   refuses to start rather than risk a double-payment.
3. **Preflight** — before sending, the agent reads `getSession`,
   `isPayeeAllowed`, `remainingDailyAllowance`, the vault's tUSD8 balance,
   and the session key's native balance. Doomed payments are skipped with a
   clear reason instead of burning gas. Then `simulateContract` runs the
   exact `pay()` call off-chain (starter kit pattern). The vault contract
   is the final enforcer regardless — preflight can only skip, never
   overpay. At startup the daemon also verifies that `VAULT_ADDRESS` and
   `TOKEN_ADDRESS` actually hold contract code and refuses to start
   otherwise: calling `pay()` on an empty address "succeeds" on the EVM
   (no code, no revert), so a misconfigured address would otherwise
   "pay" into the void and mark periods as paid.
4. **Execution** — `pay(sessionId, payee, amount)` is sent as a **legacy
   (type 0)** transaction from the session key, with exponential-backoff
   retry on RPC failures. Reverts are never retried (they are
   deterministic). Every attempt is logged (timestamp, schedule, session,
   payee, amount, tx hash or exact revert reason) to stdout and
   `logs/agent.log`, and recorded in the state file.
5. **Status** — `GET http://127.0.0.1:3100/status` (localhost only)
   shows schedules, next due times, and recent executions;
   `GET /health` is a liveness probe. `npm run status` prints the same
   from local files without touching the chain.

## Security model (least-privilege session keys)

Session keys are **not** owner keys. A session key can only call `pay()`
on the vault, and the vault enforces, on-chain, for every call:

- caller is the session's key, and the session exists, is not revoked,
  and has not expired;
- the payee is in the session's allowlist;
- the amount is within the per-transaction limit and the remaining daily
  allowance (UTC-day reset);
- the vault holds enough tUSD8.

A leaked session key **cannot drain the vault**: it cannot withdraw,
cannot create sessions, cannot change limits or the allowlist, and the
owner can revoke the session instantly (`revokeSession`). The most it can
do is pay allowlisted payees within the limits until expiry/revocation —
which is exactly what the agent was going to do anyway.

Keys live **only in environment variables** (`SESSION_KEYS_JSON` or
`SESSION_KEY_<id>`), never in code, logs, or the state file. The daemon
never prints a key; `configSummary` only lists which session ids have
keys. `.env` is gitignored; only `.env.example` (anvil throwaway keys) is
committed. Session keys also need a small tQDAY balance for gas — the
preflight reports `INSUFFICIENT_GAS` when a key holds none.

## Quick start

```bash
cp .env.example .env        # fill in VAULT_ADDRESS + session keys
cp schedules.example.json schedules.json
npm install
npm run validate            # checks env + schedules without starting
npm run build && npm start  # or: npm run dev (tsx watch)
```

`npm run status` prints schedules + last executions from local state.
`npx tsx src/cli.ts history --from-block <vaultDeployBlock>` reads the
on-chain `PaymentExecuted` audit trail (chunked ≤1,000 blocks per
`eth_getLogs` call, per Aevum's limit).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `RPC_URL` | `https://rpc-test.qday.info` | HTTPS only — Aevum has no WebSocket RPC; the agent polls, never subscribes |
| `CHAIN_ID` | `44005` | The daemon probes the RPC's real chain id and warns on mismatch |
| `VAULT_ADDRESS` | — (required) | Deployed `AgentPayVault` |
| `TOKEN_ADDRESS` | `0x4565…3483` | tUSD8 (6 decimals) |
| `SESSION_KEYS_JSON` | — | `{"0":"0x…","1":"0x…"}` — wins over `SESSION_KEY_<id>` |
| `POLL_INTERVAL_MS` | `30000` | |
| `STATUS_PORT` | `3100` | Bound to `127.0.0.1` only |
| `SCHEDULES_PATH` / `STATE_PATH` / `LOG_PATH` | `./schedules.json` / `./state/agent-state.json` / `./logs/agent.log` | |
| `MAX_RETRIES` / `RETRY_BASE_MS` | `5` / `1000` | RPC failures only; backoff `base * 2^attempt + jitter` |
| `VAULT_DEPLOY_BLOCK` | — | First block for `history` scans |

`schedules.json` entries:

```json
{
  "id": "rent",
  "sessionId": 0,
  "payee": "0x7099…79C8",
  "amount": "5.0",
  "every": "1d",
  "active": true
}
```

`amount` is tUSD8 in human units (6 decimals). `intervalSeconds` may be
used instead of `every` and wins when both are set.

## Skip / failure reasons

| Reason | Meaning |
|---|---|
| `SESSION_EXPIRED` / `SESSION_REVOKED` / `SESSION_NOT_FOUND` | Session unusable; owner must create a new session |
| `PAYEE_NOT_ALLOWED` | Payee not in the session allowlist |
| `PER_TX_LIMIT` / `DAILY_LIMIT` | Amount exceeds the session's limits |
| `INSUFFICIENT_BALANCE` | Vault holds too little tUSD8 — owner must `deposit` |
| `INSUFFICIENT_GAS` | Session key holds no tQDAY for gas — fund it |
| `NO_SESSION_KEY` | No key configured for the schedule's session |
| `RPC_ERROR` | Transient RPC failure (retried, then reported) |
| `REVERT` / `UNKNOWN` | On-chain revert / unexpected failure (see `detail`) |

Skipped and failed attempts do **not** advance the idempotency key, so
the period stays payable on the next tick (e.g. after the owner tops up
the vault or the daily allowance resets). The daemon never crashes on a
per-schedule failure.

## Aevum specifics (from the official starter kit)

- **HTTPS only, no WebSocket** — polling via `http()` transport.
- **`eth_getLogs` ≤ 1,000 blocks per query** — `src/events.ts` chunks all
  history reads (`getLogsChunked`, same approach as the kit, MIT).
- **Legacy (type 0) transactions** — every `writeContract` sets
  `type: "legacy"`.
- **EVM Shanghai** — the test mocks compile with `evm_version = "shanghai"`.
- Chain definitions mirror the kit (`src/chain.ts`).

## Tests

```bash
npm test        # unit tests (vitest): scheduler/idempotency, state store,
                # preflight decisions, failure classification, retry, config,
                # log chunking — 87 tests
npm run e2e     # end-to-end on a local anvil chain (Shanghai): deploys a
                # mock tUSD8 + the vault, funds it, creates sessions, runs
                # the real agent ticks and asserts on-chain outcomes — 17 checks
```

The e2e script prefers the **real** vault artifact
(`../../contracts/out/AgentPayVault.sol/AgentPayVault.json`) when it
exists, and falls back to the local test mock in `test/mocks/` (a minimal
implementation of the same frozen interface, for testing only — not a
copy of the production contract). Both paths are verified 17/17.

The e2e assumes the vault constructor is `(address token)`; if the real
contract's constructor differs, deployment fails with a clear message.

## Layout

```
src/
  abi.ts          AgentPayVault ABI (verified against the real artifact,
                  incl. custom errors so viem decodes revert reasons)
  agent.ts        poll loop + status snapshot (never throws per schedule)
  chain.ts        Aevum/anvil chain definitions, MAX_LOG_RANGE = 1000
  cli.ts          status | validate | run-once | history
  config.ts       .env + schedules.json loading/validation (no secrets logged)
  events.ts       chunked eth_getLogs reader + PaymentExecuted audit trail
  executor.ts     preflight + simulate + legacy pay() + receipt handling
  index.ts        daemon entrypoint (SIGINT/SIGTERM shutdown)
  logger.ts       stdout + JSON-lines file logging
  retry.ts        exponential backoff + failure classification
  scheduler.ts    interval parsing, period keys, due logic (pure, tested)
  setup.ts        shared wiring for daemon + CLI
  state.ts        atomic JSON state store (idempotency)
  status-server.ts  localhost-only HTTP status endpoint
  types.ts        shared types
test/             vitest suites
test/mocks/       foundry project: MockERC20 + MockVault (test-only)
scripts/e2e.ts    anvil end-to-end script
```
