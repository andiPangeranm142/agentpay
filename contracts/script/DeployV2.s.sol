// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {AgentPayVaultV2} from "../src/AgentPayVaultV2.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys PayeeRegistry + AgentPayVaultV2 (Confirmation of Payee).
///   - Aevum testnet (44005) and `make fork` (440050): uses the real tUSD8.
///   - Local anvil (31337) only: deploys MockUSD8 first and mints 1,000 to
///     the deployer, so the full flow works with no testnet funds.
///   - Anywhere else it stops, rather than deploy a token anyone can mint.
///
///   TUSD8 env var overrides the token address (must have code on the target
///   chain). Aevum requires LEGACY transactions: always pass --legacy.
///
///   forge script script/DeployV2.s.sol --rpc-url aevum --broadcast --legacy \
///       --account agentpay-deployer
///   # or, with a private key from the environment (never commit it):
///   DEPLOYER_PRIVATE_KEY=0x... forge script script/DeployV2.s.sol \
///       --rpc-url aevum --broadcast --legacy
contract DeployV2 is Script {
    address constant AEVUM_TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 constant ANVIL_CHAIN = 31337;

    function run() external returns (PayeeRegistry registry, AgentPayVaultV2 vault, address token) {
        address tokenOverride = vm.envOr("TUSD8", address(0));
        address tusd8 = tokenOverride == address(0) ? AEVUM_TUSD8 : tokenOverride;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        if (tusd8.code.length > 0) {
            token = tusd8;
        } else {
            require(
                block.chainid == ANVIL_CHAIN,
                "tUSD8 not found on this chain. Check the RPC (Aevum testnet is 44005)."
            );
            MockUSD8 mock = new MockUSD8();
            mock.mint(deployer, 1_000e6);
            token = address(mock);
        }

        registry = new PayeeRegistry();
        vault = new AgentPayVaultV2(IERC20(token), registry);
        vm.stopBroadcast();

        console.log("chainId ", block.chainid);
        console.log("token   ", token);
        console.log("registry", address(registry));
        console.log("vaultV2 ", address(vault));
        console.log("deployer", deployer);
    }
}
