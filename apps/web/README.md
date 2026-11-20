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
  "tUSD8": "0x456569838f1d43009A91ebA4263147Afd7233483",
  "deploymentBlock": "123456",
  "rpcUrl": "https://rpc-test.qday.info",
  "explorerUrl": "https://explorer-test.qday.info"
}
```

**Include `deploymentBlock`** — event scans start there. Without it the app
falls back to the last 10,000 blocks.

Option B — env vars (copy `.env.example` to `.env`):

```
VITE_VAULT_ADDRESS=0x…
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
    abi.ts             # AgentPayVault + minimal ERC-20 ABIs
    types.ts           # Session / Payment types
    mock.ts            # demo data
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
```

## Credits

Chunked event reading follows the pattern of `getLogsChunked` from the
Aevum Starter Kit (MIT, © 2026 PQA Labs, https://github.com/qday-io/aevum-starter-kit),
reimplemented here for this app. The dashboard design and all other code are
original to AgentPay.
