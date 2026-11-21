// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentPayVaultV3} from "../../src/AgentPayVaultV3.sol";
import {PayeeRegistryV3} from "../../src/PayeeRegistryV3.sol";

/// @notice Runs AgentPayVaultV3 + PayeeRegistryV3 against the REAL tUSD8 on
/// a local fork of Aevum testnet. No funds needed: `deal` writes a balance
/// into the fork only.
/// Run with: make test-fork
///   (or: forge test --match-path 'test/fork/*' --fork-url aevum --evm-version shanghai)
contract AevumForkV3Test is Test {
    IERC20 constant TUSD8 = IERC20(0x456569838f1d43009A91ebA4263147Afd7233483);

    address owner = makeAddr("fork-v3-owner");
    address sessionKey = makeAddr("fork-v3-sessionKey");
    address payee = makeAddr("fork-v3-payee");
    address unregistered = makeAddr("fork-v3-unregistered");

    function test_fork_v3_chainId() public view {
        assertEq(block.chainid, 44005, "run with --fork-url aevum");
    }

    function test_fork_v3_realTusd8_lowercasePay() public {
        PayeeRegistryV3 registry = new PayeeRegistryV3();
        AgentPayVaultV3 vault = new AgentPayVaultV3(TUSD8, registry);
        deal(address(TUSD8), owner, 1_000e6);

        vm.startPrank(owner);
        TUSD8.approve(address(vault), 500e6);
        vault.deposit(500e6);
        registry.registerPayee(payee, "Kedai Kopi Senja");
        address[] memory payees = new address[](1);
        payees[0] = payee;
        uint256 id =
            vault.createSession(sessionKey, payees, 100e6, 250e6, 150e6, uint64(block.timestamp + 7 days));
        vm.stopPrank();

        // Reverse lookup works on the fork too.
        assertEq(registry.addressOf(owner, "kedai kopi senja"), payee);

        // Pay with the lowercase name against the real token.
        vm.prank(sessionKey);
        vault.pay(id, payee, 25e6, "kedai kopi senja");

        assertEq(TUSD8.balanceOf(payee), 25e6);
        assertEq(vault.balances(owner), 475e6);
        assertEq(vault.spentPerPayee(id, payee), 25e6);

        vm.prank(owner);
        vault.withdraw(475e6);
        assertEq(TUSD8.balanceOf(owner), 975e6);
    }

    function test_fork_v3_failFast_revertsOnUnregisteredPayee() public {
        PayeeRegistryV3 registry = new PayeeRegistryV3();
        AgentPayVaultV3 vault = new AgentPayVaultV3(TUSD8, registry);

        address[] memory payees = new address[](1);
        payees[0] = unregistered;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV3.PayeeNotRegistered.selector, unregistered));
        vault.createSession(sessionKey, payees, 100e6, 250e6, 150e6, uint64(block.timestamp + 7 days));
        assertEq(vault.nextSessionId(), 0);
    }

    function test_fork_v3_duplicateName_reverts() public {
        PayeeRegistryV3 registry = new PayeeRegistryV3();

        vm.startPrank(owner);
        registry.registerPayee(payee, "Kedai Kopi Senja");
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistryV3.NameAlreadyTaken.selector, payee));
        registry.registerPayee(unregistered, "KEDAI KOPI SENJA");
        vm.stopPrank();
    }
}
