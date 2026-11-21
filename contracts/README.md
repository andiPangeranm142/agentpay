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
| `src/AgentPayVault.sol` | The vault (v1) |
| `src/PayeeRegistry.sol` | Confirmation of Payee registry: per-owner payee names |
| `src/AgentPayVaultV2.sol` | Vault v2: v1 + Confirmation of Payee + per-payee spend cap |
| `src/PayeeRegistryV3.sol` | Case-insensitive CoP registry: display name + normalized hash, reverse lookup, per-owner name uniqueness |
| `src/AgentPayVaultV3.sol` | Vault v3: v2 + case-insensitive name check + fail-fast session creation |
| `src/mocks/MockUSD8.sol` | 6-decimal mock tUSD8 — local anvil + unit tests only |
| `test/AgentPayVault.t.sol` | Unit + fuzz tests (MockUSD8) |
| `test/AgentPayVaultV2.t.sol` | CoP + per-payee cap tests, plus v1 behavior regression |
| `test/AgentPayVaultV3.t.sol` | v3 unit + fuzz tests (case permutations, reverse lookup, fail-fast) |
| `test/fork/AevumFork.t.sol` | Fork tests against the real tUSD8 (no funds needed) |
| `script/Deploy.s.sol` | Deploy script, v1 (`TUSD8` env override; MockUSD8 on chain 31337 only) |
| `script/DeployV2.s.sol` | Deploy script, registry + v2 (same token rules as v1) |
| `script/DeployV3.s.sol` | Deploy script, registry v3 + vault v3 (same token rules as v1) |
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

## Confirmation of Payee (v2)

`PayeeRegistry` binds each payee address to a human-readable name, in a
namespace owned by each vault owner (nobody can rename someone else's
payee). `AgentPayVaultV2` keeps every v1 rule and adds, on every payment:

- the session key must pass the expected payee name; the vault compares its
  keccak256 hash with the name the session owner registered for that address.
  Wrong name → `PayeeNameMismatch`; unregistered payee → `PayeeNotRegistered`.
  A mistyped or lookalike address has no matching registered name, so the
  payment cannot go through.
- a per-payee spend cap per session (cumulative), so a compromised session
  key can only drain a bounded amount to any single payee.

Names are exact, case-sensitive, max 64 bytes. v1 (`AgentPayVault`) is
untouched and still live at its original address.

## Deployment

| Network | Contract | Commit | Notes |
| --- | --- | --- | --- |
| Aevum testnet (44005) | AgentPayVaultV3 [`0xd17e08cD03b074a9f2e1f6a69CcD239FA7C24E2e`](https://explorer-test.qday.info/address/0xd17e08cD03b074a9f2e1f6a69CcD239FA7C24E2e) | `0a9540d` | Deployed 21 Nov 2026, block 3740129, tx [`0xf00d65cb1b7b8608b7d902633c07ef1e18e95e2a3fc7356bb4597f5150d3b445`](https://explorer-test.qday.info/tx/0xf00d65cb1b7b8608b7d902633c07ef1e18e95e2a3fc7356bb4597f5150d3b445), **source-verified**. Deploy gas 1,390,539 (~0.00139 tQDAY @ 1 gwei). Live E2E verified on-chain: deposit 0.40 tUSD8 → 0.05 tUSD8 payment with lowercase name "kedai kopi senja" OK → typo-name payment reverted on-chain (`PayeeNameMismatch`, tx `0xad8466f3a59190f828c8b86f4c29ff079073b181479d93e9327243a56ba177e6`) → duplicate ALL-CAPS registration reverted on-chain (`NameAlreadyTaken`, tx `0x32baa3382afceb645d7aad456d6de9e129c64769211f1f4173e97e930912b706`) → session creation for unregistered payee reverted on-chain (`PayeeNotRegistered`, tx `0xffbc584cf45b981b8bf89b7f226ab1e954ed4ad770c3565d792d662447d6bcec`) → payment to removed payee reverted on-chain (`PayeeNotRegistered`, tx `0xf4de0c3824f0f585388061e57c50cde3723862349ca5fe9219d952fc5588db37`) → revoke → withdraw 0.35 tUSD8. |
| Aevum testnet (44005) | PayeeRegistryV3 [`0x75d65168A8aB54dF423E350e306FAB438A312dB4`](https://explorer-test.qday.info/address/0x75d65168A8aB54dF423E350e306FAB438A312dB4) | `0a9540d` | Deployed 21 Nov 2026, block 3740129, tx [`0x723879bb3b09fead5505a631a5ee9c3bc2845ecdabc7debebc584d752b665b9e`](https://explorer-test.qday.info/tx/0x723879bb3b09fead5505a631a5ee9c3bc2845ecdabc7debebc584d752b665b9e), **source-verified**. Deploy gas 1,006,244 (~0.00101 tQDAY @ 1 gwei). |
| Aevum testnet (44005) | AgentPayVaultV2 [`0xE68518A95cbbBD75f521C86688770a98140fE06F`](https://explorer-test.qday.info/address/0xE68518A95cbbBD75f521C86688770a98140fE06F) | _this commit_ | Deployed 21 Nov 2026, block 3730440, tx [`0xd6418c855719d00fbe777b5f325f5a5b67d489c81c5bcb6ec6a77563058d0bbb`](https://explorer-test.qday.info/tx/0xd6418c855719d00fbe777b5f325f5a5b67d489c81c5bcb6ec6a77563058d0bbb), **source-verified**. Deploy gas 1,260,072 (~0.00126 tQDAY @ 1 gwei). Live E2E verified on-chain: deposit 0.40 tUSD8 → register "Sari Bakery" → session → 0.05 tUSD8 payment with matching name OK → wrong-name payment reverted on-chain (`PayeeNameMismatch`, tx `0x10f6ab903215a582825ddd30c6a4bc68c8976f0ed504d7cc5cfa8bd64adbfd04`) → lookalike payment reverted on-chain (`PayeeNotRegistered`, tx `0x5d3e1dc927b9d24f75782c6b45db5666e8381bbe7d84a1edb0538a2e432bcb58`) → revoke → withdraw 0.35 tUSD8. |
| Aevum testnet (44005) | PayeeRegistry [`0x5e1c3E6dcAfe32Df42B80277141b9F87C5FF6053`](https://explorer-test.qday.info/address/0x5e1c3e6dcafe32df42b80277141b9f87c5ff6053) | _this commit_ | Deployed 21 Nov 2026, block 3730439, tx [`0xe6727aea837fa2a6efb36740c9be664528f344426e17c376b1f62e72716828e8`](https://explorer-test.qday.info/tx/0xe6727aea837fa2a6efb36740c9be664528f344426e17c376b1f62e72716828e8), **source-verified**. Deploy gas 682,015 (~0.00068 tQDAY @ 1 gwei). |
| Aevum testnet (44005) | AgentPayVault (v1) [`0x4079f1A0f75458997DCd1A768170b96086276b47`](https://explorer-test.qday.info/address/0x4079f1a0f75458997dcd1a768170b96086276b47) | `2eca873` | Deployed 20 Nov 2026, block 3648790, tx [`0xcef3c2f73f90af7cfa914ea6d4005523c666e380be11aa53c601059f744ccf5d`](https://explorer-test.qday.info/tx/0xcef3c2f73f90af7cfa914ea6d4005523c666e380be11aa53c601059f744ccf5d), **source-verified** on the explorer. Deploy gas 1,016,383 (~0.00102 tQDAY @ 1 gwei). Live E2E verified on-chain: deposit → session → pay → revoke → withdraw (4 sessions, 6 payments of 0.05 tUSD8). tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` |
| Local fork (440050) | `0x9F1EA9089F1239583577168F6D3e5E3426F1bF96` | _uncommitted work, 20 Nov 2026_ | Verified 20 Nov 2026: deploy script + full E2E (approve → deposit 500 → session → pay to daily limit → revoke → withdraw) vs the real tUSD8, legacy txs, Shanghai hardfork. Deploy gas 1,017,663 (~0.00102 tQDAY @ 1 gwei). Fork is ephemeral; address not reusable on testnet. |

Deployer wallet: `0xf2Cc349a7629Ef20110621f713A7153306b05651`
(funded 20 Nov 2026 via the official Discord faucet — 1 tQDAY + 5 tUSD8;
wallet held 4.70 tUSD8 after the v1 E2E runs on 20 Nov 2026 (5.00 −
6 × 0.05 tUSD8 paid), and 4.55 tUSD8 after the v2/v3 runs on
21 Nov 2026, verified by `cast call` on-chain).
