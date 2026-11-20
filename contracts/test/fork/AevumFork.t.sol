// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentPayVault} from "../../src/AgentPayVault.sol";

/// @notice Runs AgentPayVault against the REAL tUSD8 on a local fork of
/// Aevum testnet. No funds needed: `deal` writes a balance into the fork only.
/// Run with: make test-fork
///   (or: forge test --match-path 'test/fork/*' --fork-url aevum --evm-version shanghai)
contract AevumForkTest is Test {
    IERC20 constant TUSD8 = IERC20(0x456569838f1d43009A91ebA4263147Afd7233483);

    address owner = makeAddr("fork-owner");
    address sessionKey = makeAddr("fork-sessionKey");
    address payee = makeAddr("fork-payee");

    function test_fork_chainId() public view {
        assertEq(block.chainid, 44005, "run with --fork-url aevum");
    }

    function test_fork_realTusd8_depositSessionPay() public {
        AgentPayVault vault = new AgentPayVault(TUSD8);
        deal(address(TUSD8), owner, 1_000e6);

        vm.startPrank(owner);
        TUSD8.approve(address(vault), 500e6);
        vault.deposit(500e6);
        address[] memory payees = new address[](1);
        payees[0] = payee;
        uint256 id = vault.createSession(sessionKey, payees, 100e6, 250e6, uint64(block.timestamp + 7 days));
        vm.stopPrank();

        assertEq(vault.balances(owner), 500e6);

        vm.prank(sessionKey);
        vault.pay(id, payee, 25e6);

        assertEq(TUSD8.balanceOf(payee), 25e6);
        assertEq(vault.balances(owner), 475e6);
        assertEq(vault.getSession(id).spentToday, 25e6);
        assertEq(vault.remainingDailyAllowance(id), 225e6);

        // Owner can still withdraw the rest.
        vm.prank(owner);
        vault.withdraw(475e6);
        assertEq(TUSD8.balanceOf(owner), 975e6);
    }

    function test_fork_realTusd8_limitsEnforced() public {
        AgentPayVault vault = new AgentPayVault(TUSD8);
        deal(address(TUSD8), owner, 1_000e6);

        vm.startPrank(owner);
        TUSD8.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);
        address[] memory payees = new address[](1);
        payees[0] = payee;
        uint256 id = vault.createSession(sessionKey, payees, 100e6, 100e6, uint64(block.timestamp + 7 days));
        vm.stopPrank();

        vm.startPrank(sessionKey);
        vm.expectRevert(AgentPayVault.ExceedsPerTxLimit.selector);
        vault.pay(id, payee, 100e6 + 1);

        vault.pay(id, payee, 100e6);
        vm.expectRevert(AgentPayVault.ExceedsDailyLimit.selector);
        vault.pay(id, payee, 1);
        vm.stopPrank();

        // Revocation kills the session immediately.
        vm.prank(owner);
        vault.revokeSession(id);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.SessionIsRevoked.selector);
        vault.pay(id, payee, 1);
    }
}
