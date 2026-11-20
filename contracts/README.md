# AgentPay — Contracts

`AgentPayVault`: non-custodial vault for autonomous stablecoin bill payments
on Aevum testnet. An owner deposits tUSD8, then authorizes an AI agent's
session key to pay allowlisted payees within strict limits — per-transaction
cap, daily cap (resets each UTC day), expiry, and instant owner revocation.
Every payment emits `PaymentExecuted`, forming a full on-chain audit trail.

There is **no admin/owner backdoor**: only each owner can withdraw their own
balance, and a session key can only pay allowlisted payees within limits.

## Aevum rules (from the official starter kit docs)

- **Shanghai EVM** — `evm_version = "shanghai"` in `foundry.toml`. Cancun
  opcodes (`MCOPY`, `TSTORE`/`TLOAD`, blob ops) do not exist; `make build`
  runs `tools/check-shanghai.mjs` to fail the build if any appear. No
  OpenZeppelin `*Transient` contracts.
- **Forks must use `--hardfork shanghai`** — plain anvil runs Cancun and hides
  bad bytecode. (`make fork` and `make test-fork` do this.)
- **Legacy transactions (type 0)** — always `--legacy` on `forge script`
  against Aevum testnet.
- **Explorer verification works** — the vault's source was verified on the
  Aevum explorer after deploy (20 Nov 2026). (The starter kit doc that says
  "forge verify-contract fails for now" is out of date.)
- Gas is ~1 gwei; deploying the vault costs far under 0.01 tQDAY.

## Layout

| File | What it is |
| --- | --- |
| `src/AgentPayVault.sol` | The vault (one contract) |
| `src/mocks/MockUSD8.sol` | 6-decimal mock tUSD8 — local anvil + unit tests only |
| `test/AgentPayVault.t.sol` | Unit + fuzz tests (MockUSD8) |
| `test/fork/AevumFork.t.sol` | Fork tests against the real tUSD8 (no funds needed) |
| `script/Deploy.s.sol` | Deploy script (`TUSD8` env override; MockUSD8 on chain 31337 only) |
| `tools/check-shanghai.mjs` | Bytecode check for Cancun-only opcodes (adapted from the starter kit, MIT) |

## Commands

```bash
make build      # forge build + Shanghai opcode check
make test       # unit tests (no network)
make test-fork  # fork tests vs real tUSD8 on Aevum testnet
make check      # build + unit + fork
make fork       # local Aevum fork on 127.0.0.1:8555 (chain 440050)
make deploy-fork            # deploy to the local fork (throwaway deployer)
make deploy-aevum ACCOUNT=agentpay-deployer   # deploy to Aevum testnet
```

Keystore setup (once): `cast wallet import agentpay-deployer --interactive`
— never put a private key in a file. See `.env.example`.

## Deployment

| Network | Vault address | Commit | Notes |
| --- | --- | --- | --- |
| Aevum testnet (44005) | [`0x4079f1A0f75458997DCd1A768170b96086276b47`](https://explorer-test.qday.info/address/0x4079f1a0f75458997dcd1a768170b96086276b47) | `2eca873` | Deployed 20 Nov 2026, block 3648790, tx [`0xcef3c2f73f90af7cfa914ea6d4005523c666e380be11aa53c601059f744ccf5d`](https://explorer-test.qday.info/tx/0xcef3c2f73f90af7cfa914ea6d4005523c666e380be11aa53c601059f744ccf5d), **source-verified** on the explorer. Deploy gas 1,016,383 (~0.00102 tQDAY @ 1 gwei). Live E2E verified on-chain: deposit → session → pay → revoke → withdraw (3 sessions, 5 payments of 0.05 tUSD8). tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` |
| Local fork (440050) | `0x9F1EA9089F1239583577168F6D3e5E3426F1bF96` | _uncommitted work, 20 Nov 2026_ | Verified 20 Nov 2026: deploy script + full E2E (approve → deposit 500 → session → pay to daily limit → revoke → withdraw) vs the real tUSD8, legacy txs, Shanghai hardfork. Deploy gas 1,017,663 (~0.00102 tQDAY @ 1 gwei). Fork is ephemeral; address not reusable on testnet. |

Deployer wallet: `0xf2Cc349a7629Ef20110621f713A7153306b05651`
(funded 20 Nov 2026 via the official Discord faucet — 1 tQDAY + 5 tUSD8;
wallet holds 4.75 tUSD8 after the live E2E runs, verified on-chain 20 Nov 2026).
