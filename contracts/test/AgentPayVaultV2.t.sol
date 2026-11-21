// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPayVaultV2} from "../src/AgentPayVaultV2.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Tests for Confirmation of Payee (PayeeRegistry + AgentPayVaultV2),
/// plus regression coverage for every v1 vault behavior.
contract AgentPayVaultV2Test is Test {
    AgentPayVaultV2 vault;
    PayeeRegistry registry;
    MockUSD8 token;

    address owner = makeAddr("owner");
    address owner2 = makeAddr("owner2");
    address sessionKey = makeAddr("sessionKey");
    address payee1 = makeAddr("payee1");
    address payee2 = makeAddr("payee2");
    address lookalike = makeAddr("lookalike");
    address stranger = makeAddr("stranger");

    string constant NAME1 = "Sari Bakery";
    string constant NAME2 = "Toko Listrik Jaya";

    uint256 constant PER_TX = 100e6;
    uint256 constant DAILY = 250e6;
    uint256 constant PER_PAYEE = 150e6;
    uint64 expiry;

    event PayeeRegistered(address indexed owner, address indexed payee, string name);
    event PayeeUpdated(address indexed owner, address indexed payee, string oldName, string newName);
    event PayeeRemoved(address indexed owner, address indexed payee, string oldName);
    event SessionCreated(
        uint256 indexed sessionId,
        address indexed owner,
        address indexed sessionKey,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint256 perPayeeCap,
        uint64 expiry
    );
    event PaymentExecuted(
        uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp
    );

    function setUp() public {
        vm.warp(1_763_683_200); // 2026-11-20, fixed "now"
        expiry = uint64(block.timestamp + 30 days);

        token = new MockUSD8();
        registry = new PayeeRegistry();
        vault = new AgentPayVaultV2(token, registry);
        token.mint(owner, 10_000e6);
        token.mint(owner2, 10_000e6);

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
        vm.stopPrank();

        // Owner's registered payees (the CoP ground truth).
        vm.startPrank(owner);
        registry.registerPayee(payee1, NAME1);
        registry.registerPayee(payee2, NAME2);
        vm.stopPrank();
    }

    function _payees() internal view returns (address[] memory) {
        address[] memory p = new address[](2);
        p[0] = payee1;
        p[1] = payee2;
        return p;
    }

    function _createSession() internal returns (uint256) {
        vm.prank(owner);
        return vault.createSession(sessionKey, _payees(), PER_TX, DAILY, PER_PAYEE, expiry);
    }

    function _pay(uint256 id, address payee, uint256 amount, string memory name) internal {
        vm.prank(sessionKey);
        vault.pay(id, payee, amount, name);
    }

    // ---- registry: register / update / remove ----

    function test_registry_registerAndRead() public view {
        assertEq(registry.nameOf(owner, payee1), NAME1);
        assertTrue(registry.isRegistered(owner, payee1));
        assertTrue(registry.matchesName(owner, payee1, NAME1));
        assertFalse(registry.matchesName(owner, payee1, "Sari Bakrey"));
        assertFalse(registry.isRegistered(owner, lookalike));
        assertEq(registry.nameOf(owner, lookalike), "");
    }

    function test_registry_registerEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeRegistered(owner, lookalike, "Lookalike Shop");
        registry.registerPayee(lookalike, "Lookalike Shop");
    }

    function test_registry_namespacesArePerOwner() public {
        // owner2 can register the same payee under a different name, and
        // neither namespace affects the other.
        vm.prank(owner2);
        registry.registerPayee(payee1, "Bakery Lain");
        assertEq(registry.nameOf(owner, payee1), NAME1);
        assertEq(registry.nameOf(owner2, payee1), "Bakery Lain");
        // owner2 cannot overwrite or remove owner's entry.
        vm.prank(owner2);
        vm.expectRevert(PayeeRegistry.PayeeAlreadyRegistered.selector);
        registry.registerPayee(payee1, "Hacked");
    }

    function test_registry_update() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeUpdated(owner, payee1, NAME1, "Sari Bakery Baru");
        registry.updatePayee(payee1, "Sari Bakery Baru");
        assertEq(registry.nameOf(owner, payee1), "Sari Bakery Baru");
        assertTrue(registry.matchesName(owner, payee1, "Sari Bakery Baru"));
        assertFalse(registry.matchesName(owner, payee1, NAME1));
    }

    function test_registry_remove() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeRemoved(owner, payee1, NAME1);
        registry.removePayee(payee1);
        assertFalse(registry.isRegistered(owner, payee1));
        assertEq(registry.nameOf(owner, payee1), "");
        // Re-registering after removal works.
        vm.prank(owner);
        registry.registerPayee(payee1, NAME1);
        assertTrue(registry.isRegistered(owner, payee1));
    }

    function test_registry_registerRevertsOnDuplicate() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.PayeeAlreadyRegistered.selector);
        registry.registerPayee(payee1, "Other Name");
    }

    function test_registry_revertsOnZeroPayee() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.InvalidPayee.selector);
        registry.registerPayee(address(0), "Nobody");
    }

    function test_registry_revertsOnEmptyName() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.EmptyName.selector);
        registry.registerPayee(lookalike, "");
    }

    function test_registry_revertsOnNameTooLong() public {
        string memory long = new string(65);
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.NameTooLong.selector);
        registry.registerPayee(lookalike, long);
    }

    function test_registry_updateRevertsWhenUnregistered() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.PayeeNotRegistered.selector);
        registry.updatePayee(lookalike, "Ghost");
    }

    function test_registry_removeRevertsWhenUnregistered() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistry.PayeeNotRegistered.selector);
        registry.removePayee(lookalike);
    }

    function test_registry_nameComparisonIsCaseSensitive() public view {
        assertFalse(registry.matchesName(owner, payee1, "sari bakery"));
        assertFalse(registry.matchesName(owner, payee1, "Sari Bakery "));
    }

    // ---- CoP payment checks ----

    function test_pay_succeedsWithMatchingName() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectEmit(true, true, false, true);
        emit PaymentExecuted(id, payee1, 50e6, block.timestamp);
        vault.pay(id, payee1, 50e6, NAME1);
        assertEq(token.balanceOf(payee1), 50e6);
        assertEq(vault.balances(owner), 950e6);
        assertEq(vault.spentPerPayee(id, payee1), 50e6);
    }

    function test_pay_revertsOnWrongName() public {
        uint256 id = _createSession();
        bytes32 expected = keccak256(bytes("Sari Bakrey"));
        bytes32 registered = keccak256(bytes(NAME1));
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(AgentPayVaultV2.PayeeNameMismatch.selector, expected, registered)
        );
        vault.pay(id, payee1, 50e6, "Sari Bakrey");
        assertEq(token.balanceOf(payee1), 0);
        assertEq(vault.balances(owner), 1_000e6);
    }

    function test_pay_revertsOnUnregisteredPayee() public {
        // lookalike is on the session allowlist but has no registered name.
        address[] memory p = new address[](1);
        p[0] = lookalike;
        vm.prank(owner);
        uint256 id = vault.createSession(sessionKey, p, PER_TX, DAILY, PER_PAYEE, expiry);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV2.PayeeNotRegistered.selector, lookalike));
        vault.pay(id, lookalike, 50e6, "Sari Bakery");
        assertEq(token.balanceOf(lookalike), 0);
    }

    function test_pay_revertsAfterPayeeRemoved() public {
        uint256 id = _createSession();
        vm.prank(owner);
        registry.removePayee(payee1);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV2.PayeeNotRegistered.selector, payee1));
        vault.pay(id, payee1, 50e6, NAME1);
    }

    function test_pay_usesSessionOwnersNamespace() public {
        // owner2 registers payee1 under a different name; the vault still
        // checks OWNER's namespace, so owner's name is the one that works.
        vm.prank(owner2);
        registry.registerPayee(payee1, "Bakery Lain");
        uint256 id = _createSession();
        _pay(id, payee1, 50e6, NAME1);
        assertEq(token.balanceOf(payee1), 50e6);
    }

    function test_pay_revertsWhenNameUpdated() public {
        uint256 id = _createSession();
        vm.prank(owner);
        registry.updatePayee(payee1, "Sari Bakery Baru");
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPayVaultV2.PayeeNameMismatch.selector,
                keccak256(bytes(NAME1)),
                keccak256(bytes("Sari Bakery Baru"))
            )
        );
        vault.pay(id, payee1, 50e6, NAME1);
        // The new name works.
        _pay(id, payee1, 50e6, "Sari Bakery Baru");
        assertEq(token.balanceOf(payee1), 50e6);
    }

    function test_pay_fuzz_wrongNameAlwaysReverts(string memory wrongName) public {
        vm.assume(keccak256(bytes(wrongName)) != keccak256(bytes(NAME1)));
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPayVaultV2.PayeeNameMismatch.selector,
                keccak256(bytes(wrongName)),
                keccak256(bytes(NAME1))
            )
        );
        vault.pay(id, payee1, 1e6, wrongName);
    }

    // ---- per-payee cap ----

    function test_perPayeeCap_blocksOverCap() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1); // perTx max
        _pay(id, payee1, 50e6, NAME1); // cumulative 150 = cap
        assertEq(vault.remainingPayeeAllowance(id, payee1), 0);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.ExceedsPerPayeeCap.selector);
        vault.pay(id, payee1, 1e6, NAME1);
        // Other payee is unaffected.
        _pay(id, payee2, 100e6, NAME2);
        assertEq(token.balanceOf(payee2), 100e6);
    }

    function test_perPayeeCap_isPerSession() public {
        uint256 id1 = _createSession();
        uint256 id2 = _createSession();
        _pay(id1, payee1, 100e6, NAME1);
        _pay(id1, payee1, 50e6, NAME1);
        // A fresh session has a fresh per-payee allowance.
        assertEq(vault.remainingPayeeAllowance(id2, payee1), PER_PAYEE);
        _pay(id2, payee1, 100e6, NAME1);
    }

    function test_createSession_revertsWhenPerPayeeCapBelowPerTx() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.InvalidPerPayeeCap.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, PER_TX - 1, expiry);
    }

    function test_createSession_storesPerPayeeCap() public {
        uint256 id = _createSession();
        AgentPayVaultV2.Session memory s = vault.getSession(id);
        assertEq(s.perPayeeCap, PER_PAYEE);
    }

    // ---- regression: v1 vault behavior ----

    function test_depositAndWithdraw() public {
        vm.prank(owner);
        vault.deposit(500e6);
        assertEq(vault.balances(owner), 1_500e6);
        vm.prank(owner);
        vault.withdraw(1_500e6);
        assertEq(vault.balances(owner), 0);
        assertEq(token.balanceOf(owner), 10_000e6);
    }

    function test_withdraw_revertsWhenInsufficient() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.InsufficientBalance.selector);
        vault.withdraw(1_001e6);
    }

    function test_pay_revertsOverPerTxLimit() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.ExceedsPerTxLimit.selector);
        vault.pay(id, payee1, PER_TX + 1, NAME1);
    }

    function test_pay_revertsOverDailyLimit() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1);
        _pay(id, payee2, 100e6, NAME2);
        // Exactly the remainder of the daily limit works (50 to payee1 hits
        // its per-payee cap of 150 exactly).
        _pay(id, payee1, 50e6, NAME1);
        assertEq(vault.remainingDailyAllowance(id), 0);
        // Daily limit is now exhausted; payee2 still has per-payee headroom,
        // so the revert is the daily limit, not the per-payee cap.
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.ExceedsDailyLimit.selector);
        vault.pay(id, payee2, 1e6, NAME2);
    }

    function test_dailyLimit_resetsNextDay() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1);
        _pay(id, payee2, 100e6, NAME2);
        _pay(id, payee1, 50e6, NAME1);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(vault.remainingDailyAllowance(id), DAILY);
        // Per-payee cap is lifetime, so payee2 (100 spent) can take 50 more.
        _pay(id, payee2, 50e6, NAME2);
        assertEq(token.balanceOf(payee2), 150e6);
    }

    function test_pay_revertsAfterExpiry() public {
        uint256 id = _createSession();
        vm.warp(expiry + 1);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.SessionExpired.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_pay_revertsAfterRevoke() public {
        uint256 id = _createSession();
        vm.prank(owner);
        vault.revokeSession(id);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.SessionIsRevoked.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_pay_revertsWhenNotSessionKey() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVaultV2.NotSessionKey.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_pay_revertsWhenPayeeNotAllowed() public {
        uint256 id = _createSession();
        vm.prank(owner);
        registry.registerPayee(lookalike, "Lookalike Shop");
        // Registered name matches, but not on the session allowlist.
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.PayeeNotAllowed.selector);
        vault.pay(id, lookalike, 10e6, "Lookalike Shop");
    }

    function test_pay_revertsOnZeroAmount() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.ZeroAmount.selector);
        vault.pay(id, payee1, 0, NAME1);
    }

    function test_pay_revertsOnUnknownSession() public {
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV2.SessionNotFound.selector);
        vault.pay(99, payee1, 10e6, NAME1);
    }

    function test_revoke_revertsWhenNotOwner() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVaultV2.NotSessionOwner.selector);
        vault.revokeSession(id);
    }

    function test_createSession_revertsOnBadInputs() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.InvalidSessionKey.selector);
        vault.createSession(address(0), _payees(), PER_TX, DAILY, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.NoPayees.selector);
        vault.createSession(sessionKey, new address[](0), PER_TX, DAILY, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.InvalidDailyLimit.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, PER_TX - 1, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV2.InvalidExpiry.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, PER_PAYEE, uint64(block.timestamp));
    }

    function test_constructor_revertsOnZeroRegistry() public {
        vm.expectRevert(AgentPayVaultV2.InvalidRegistry.selector);
        new AgentPayVaultV2(token, PayeeRegistry(address(0)));
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(AgentPayVaultV2.InvalidPayee.selector);
        new AgentPayVaultV2(MockUSD8(address(0)), registry);
    }
}
