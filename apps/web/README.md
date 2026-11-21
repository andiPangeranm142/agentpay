# AgentPay — Dashboard

Autonomous stablecoin bill payments on **Aevum Testnet** (chain 44005).
An AI agent pays scheduled bills from a tUSD8 vault using narrow session keys:
payee allowlist, per-transaction + daily limits, expiry, instant owner
revocation, full on-chain audit trail.

Built for the Aevum Builder Challenge #1 (QDay), track Native AI Assistants.
Vite + React + TypeScript + wagmi/viem. Static build, deployable to GitHub Pages.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + static build into dist/
npm run preview  # serve the production build locally
```

No wallet or deployment needed to review the UI: without a vault address the
app runs in **mock mode** (clearly bannered "Demo data").

## Mock mode vs live mode

| | Mock | Live |
|---|---|---|
| Trigger | No vault address configured | Vault address from `deployments.json` or env |
| Data | Realistic demo data in `src/lib/mock.ts` | Real viem reads against AgentPayVault + tUSD8 |
| Writes | Disabled (with explanation) | Enabled: approve/deposit, withdraw, create/revoke session |

The switch is a **config change, not a rewrite**: every screen reads through
the `VaultDataProvider` interface (`src/lib/provider.ts`). `createProvider()`
picks `MockProvider` or `LiveProvider` from `config.mode`. The live-read code
is fully written against the frozen contract interface — mock mode only swaps
the data source.

## Pointing at the real deployment

Option A — `deployments.json` (preferred for a built static site; no rebuild
needed). Copy the repo-root `deployments.json` into `public/`:

```bash
cp ../../deployments.json public/deployments.json
```

The app fetches it at runtime. Recognised keys (any of these spellings):

```json
{
  "AgentPayVault": "0x…",
  "AgentPayVaultV2": "0x…",
  "PayeeRegistry": "0x…",
  "AgentPayVaultV3": "0x…",
  "PayeeRegistryV3": "0x…",
  "deployer": "0x…",
  "tUSD8": "0x456569838f1d43009A91ebA4263147Afd7233483",
  "deploymentBlock": "123456",
  "v2DeploymentBlockRegistry": "123456",
  "v2DeploymentBlockVault": "123457",
  "v3DeploymentBlockRegistry": "123456",
  "v3DeploymentBlockVault": "123456",
  "deployTx": "0x…",
  "v2DeployTxRegistry": "0x…",
  "v2DeployTxVault": "0x…",
  "v3DeployTxRegistry": "0x…",
  "v3DeployTxVault": "0x…",
  "rpcUrl": "https://rpc-test.qday.info",
  "explorerUrl": "https://explorer-test.qday.info"
}
```

**Include `deploymentBlock`** — event scans start there. Without it the app
falls back to the last 10,000 blocks. The v2/v3 keys drive the
**Payees · CoP (v3)** tab; `deployer` lets that tab show the demo owner's
registered payees when no wallet is connected (clearly labelled). The
`*DeployTx*` keys feed the finality watcher (see below).

Option B — env vars (copy `.env.example` to `.env`):

```
VITE_VAULT_ADDRESS=0x…
VITE_VAULT_V2_ADDRESS=0x…
VITE_REGISTRY_ADDRESS=0x…
VITE_VAULT_V3_ADDRESS=0x…
VITE_REGISTRY_V3_ADDRESS=0x…
VITE_TUSD8_ADDRESS=0x456569838f1d43009A91ebA4263147Afd7233483
VITE_RPC_URL=https://rpc-test.qday.info
VITE_EXPLORER_URL=https://explorer-test.qday.info
```

`deployments.json` wins over env vars when both exist. Never commit a real
`.env` (only `.env.example`); never put a private key anywhere in this app —
all signing happens in the user's wallet.

## Aevum quirks handled here

Verified against the official starter kit docs
(https://aevum-starter-kit.vercel.app/docs):

- **HTTPS-only RPC, no WebSocket** — all reads poll over HTTP (viem's default
  for `http()` transports). No `watchContractEvent` anywhere; Activity
  auto-refreshes every 30 s plus a manual Refresh button.
- **`eth_getLogs` limited to 1,000 blocks per query** — every event scan is
  chunked into ≤1,000-block windows from the deploy block, 8 windows at a
  time (see `chunked()` in `src/lib/provider.ts`; same idea as the kit's
  `getLogsChunked`).
- **Transactions must be LEGACY (type 0)** — every `writeContract` call sets
  `type: 'legacy'`.
- **EVM Shanghai** — no direct impact on the frontend.

## Contract interface — verified against the real contract

The ABI in `src/lib/abi.ts` was written against the frozen spec and then
verified field-for-field against `contracts/src/AgentPayVault.sol`
(20 Nov 2026), including:

- `getSession` returns the full `Session` struct in exact field order
  (`sessionKey, owner, payees, perTxLimit, dailyLimit, spentToday,
  lastSpendDay, expiry, revoked, exists`).
- `SessionCreated` carries non-indexed `(perTxLimit, dailyLimit, expiry)`
  — the full signature is used everywhere, because viem hashes it for the
  log topic.
- `balances(address)` is a public view, so the live vault balance is a
  single read.
- All 16 custom errors are in the ABI so viem decodes reverts; they are
  mapped to plain-language messages in `src/lib/format.ts`.

If the contract changes, update `src/lib/abi.ts` (and the `parseAbiItem`
event strings in `src/lib/provider.ts`, which must stay in sync).

## Layout

```
src/
  config.ts            # addresses/endpoints: deployments.json > env > defaults
  App.tsx              # tabs, header, mock banner, wagmi + react-query setup
  lib/
    chain.ts           # Aevum Testnet (44005) chain definition + add-network params
    abi.ts             # AgentPayVault + v2/v3 vaults + registries + ERC-20 ABIs
    types.ts           # Session / Payment / RegisteredPayee / evidence types
    mock.ts            # demo data (v1 + v2/v3)
    v2Evidence.ts      # recorded v2 on-chain evidence (reverted txs, e2e run)
    v3Evidence.ts      # recorded v3 on-chain evidence + test counts
    finality.ts        # finality watcher: receipt polling by hash, 12-conf rule
    provider.ts        # VaultDataProvider seam: Live (viem) vs Mock
    hooks.ts           # react-query wrappers (30 s polling in live mode)
    format.ts          # formatting + plain-language error translation
  components/
    ConnectButton.tsx  # injected-wallet connect (no RainbowKit, small bundle)
    NetworkBanner.tsx  # wrong-chain warning + switch / add-network helpers
    Overview.tsx       # vault balance, wallet, network, quick stats
    DepositWithdraw.tsx# approve -> deposit flow with step-by-step status
    Sessions.tsx       # create session (allowlist editor, limits, expiry), list, revoke
    Activity.tsx       # PaymentExecuted events + daily-spend summary
    FinalityBadge.tsx  # live receipt-status badge (Seen -> Finalized)
    Payees.tsx         # v3 (current): live payees, reverse lookup, payments,
                       # sessions, end state, blocked actions, recorded run;
                       # v2 kept below as labelled history
```

## v3 — Case-insensitive Confirmation of Payee (current)

The **Payees · CoP (v3)** tab is the v3 surface. Live reads, all through
`VaultDataProvider` (the v2/v3 read shapes are shared helpers in
`provider.ts` — the v3 vault's external interface is identical to v2's):

- `listRegisteredPayeesV3(owner)` — the owner's v3 registry namespace
  (event rebuild + live `nameOf` confirmation, same as v2).
- `addressOfV3(owner, name)` — the reverse lookup: the tab queries the
  first registered payee's name in lower / UPPER / original case (all
  must resolve to the payee) plus a one-letter typo (must resolve to no
  payee).
- `listV3Payments(owner)` / `listV3Sessions(owner)` — v3 payments and
  sessions with per-payee caps, same shapes as v2.
- `getV3EndState(owner, payee)` — the recorded run's end state read live
  (owner/payee wallet balances, vault balances, `nextSessionId` = 3 —
  sessions 0–2; the fail-fast revert created no session), cross-checked
  against the recorded end state (owner 4.55 / payee 0.45 / vault 0
  tUSD8, block 3741216).
- The two **blocked actions** are recorded evidence in
  `src/lib/v3Evidence.ts` — the fail-fast `createSession` revert
  (`PayeeNotRegistered`) and the duplicate-name `registerPayee` revert
  (`NameAlreadyTaken`), both status 0x0. The full official run (15
  steps, sessions 1–2, demo payee "Kedai Kopi Senja") is recorded in
  `V3_E2E_FLOW` in the same file, including the two rejected payments
  (typo name → `PayeeNameMismatch`, removed lookalike →
  `PayeeNotRegistered`).

Contract tests (21 Nov 2026, per scope — never summed): forge 142
(53 v1 + 38 v2 + 51 v3) · fork 7 (3 v1 + 4 v3) · agent vitest 90 ·
e2e anvil 17/17.

## Finality watcher

Every recorded transaction on the Payees tab (v2/v3 flow steps, blocked
payments/actions, all five deploy txs) carries a live status badge,
polled by **hash** via `eth_getTransactionReceipt`
(`src/lib/finality.ts`, `useTxFinality`, re-checked every 30 s) — never
via event logs, because reverted transactions emit no events. The
receipt's status (0x1/0x0) is cross-checked against the recorded result;
a mismatch shows a warning badge.

**Finalized = ≥ 12 confirmations** — a confirmation-depth rule, not
chain-provided absolute finality: Aevum Testnet publishes no finality
gadget, so the dashboard does not claim one (documented in
`lib/finality.ts` and in the footnote under the evidence tables).

## v2 — Confirmation of Payee (previous version)

The v2 surface is kept on the same tab, below v3, inside a collapsible
"v2 — previous version" block. Live reads, all through
`VaultDataProvider`:

- `listRegisteredPayees(owner)` — rebuilds the owner's registry
  namespace from `PayeeRegistered` / `PayeeUpdated` / `PayeeRemoved`
  events (chronological, chunked ≤1,000 blocks), then confirms each
  surviving name with a live `nameOf` call.
- `listV2Payments(owner)` — `PaymentExecuted` events from
  `AgentPayVaultV2`, enriched with the registered payee name; every
  payment shown here passed the name check by construction.
- `listV2Sessions(owner)` — v2 sessions with `perPayeeCap` and
  per-payee spend (`spentPerPayee` / `remainingPayeeAllowance`).
- The two **blocked payments** are recorded evidence in
  `src/lib/v2Evidence.ts` — reverted transactions emit no events, so
  they cannot be discovered by scanning; each entry links to its
  explorer receipt (status 0x0). They are never mock data.

With no wallet connected, the tab shows the demo owner's (`deployer`
from `deployments.json`) namespace, clearly labelled; connecting a
wallet switches to the connected address's namespace.

## Credits

Chunked event reading follows the pattern of `getLogsChunked` from the
Aevum Starter Kit (MIT, © 2026 PQA Labs, https://github.com/qday-io/aevum-starter-kit),
reimplemented here for this app. The dashboard design and all other code are
original to AgentPay.
