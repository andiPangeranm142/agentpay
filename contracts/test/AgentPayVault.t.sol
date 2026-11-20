// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentPayVault} from "../src/AgentPayVault.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice ERC-20 that tries to re-enter the vault on every transfer.
/// The re-entrant call is made with a low-level call and its success is
/// recorded, so the test can prove the guard blocked it while the outer
/// operation still completed normally.
contract MaliciousToken is ERC20 {
    address public vault;
    bool public attackEnabled;
    bool public reentrancySucceeded;

    constructor() ERC20("Malicious USD8", "MAL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVault(address v) external {
        vault = v;
    }

    function setAttack(bool on) external {
        attackEnabled = on;
    }

    function _attack() internal {
        if (!attackEnabled || vault == address(0)) return;
        (bool ok,) = vault.call(abi.encodeWithSignature("withdraw(uint256)", 1));
        if (ok) reentrancySucceeded = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _attack();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _attack();
        return super.transferFrom(from, to, amount);
    }
}

contract AgentPayVaultTest is Test {
    AgentPayVault vault;
    MockUSD8 token;

    address owner = makeAddr("owner");
    address sessionKey = makeAddr("sessionKey");
    address payee1 = makeAddr("payee1");
    address payee2 = makeAddr("payee2");
    address stranger = makeAddr("stranger");

    uint256 constant PER_TX = 100e6;
    uint256 constant DAILY = 250e6;
    uint64 expiry;

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event SessionCreated(
        uint256 indexed sessionId,
        address indexed owner,
        address indexed sessionKey,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint64 expiry
    );
    event SessionRevoked(uint256 indexed sessionId, address indexed owner);
    event PaymentExecuted(
        uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp
    );

    function setUp() public {
        // Fixed realistic "now" (2026-11-20) so expiry/warp math is readable.
        vm.warp(1_763_683_200);
        expiry = uint64(block.timestamp + 30 days);

        token = new MockUSD8();
        vault = new AgentPayVault(token);
        token.mint(owner, 10_000e6);

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
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
        return vault.createSession(sessionKey, _payees(), PER_TX, DAILY, expiry);
    }

    // ---- deposit / withdraw ----

    function test_deposit() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit Deposited(owner, 500e6);
        vault.deposit(500e6);
        assertEq(vault.balances(owner), 1_500e6);
        assertEq(token.balanceOf(address(vault)), 1_500e6);
    }

    function test_deposit_revertsZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_revertsWithoutApproval() public {
        address poor = makeAddr("poor");
        token.mint(poor, 10e6);
        vm.prank(poor);
        vm.expectRevert(); // ERC20InsufficientAllowance from the token
        vault.deposit(10e6);
    }

    function test_deposit_balancesIsolatedPerOwner() public {
        token.mint(stranger, 50e6);
        vm.startPrank(stranger);
        token.approve(address(vault), 50e6);
        vault.deposit(50e6);
        vm.stopPrank();
        assertEq(vault.balances(owner), 1_000e6);
        assertEq(vault.balances(stranger), 50e6);
    }

    function test_withdraw() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(owner, 400e6);
        vault.withdraw(400e6);
        assertEq(vault.balances(owner), 600e6);
        assertEq(token.balanceOf(owner), 9_400e6);
    }

    function test_withdraw_fullBalance() public {
        vm.prank(owner);
        vault.withdraw(1_000e6);
        assertEq(vault.balances(owner), 0);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_withdraw_revertsZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_withdraw_revertsInsufficientBalance() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InsufficientBalance.selector);
        vault.withdraw(1_000e6 + 1);
    }

    function test_withdraw_cannotTakeOthersBalance() public {
        vm.prank(stranger);
        vm.expectRevert(AgentPayVault.InsufficientBalance.selector);
        vault.withdraw(1);
    }

    function testFuzz_depositWithdrawRoundTrip(uint256 amount) public {
        // Owner holds 9_000e6 after setUp deposited 1_000e6 of the 10_000e6 minted.
        amount = bound(amount, 1, 9_000e6);
        vm.startPrank(owner);
        vault.deposit(amount);
        vault.withdraw(amount);
        vm.stopPrank();
        assertEq(vault.balances(owner), 1_000e6);
        assertEq(token.balanceOf(owner), 9_000e6);
    }

    // ---- createSession ----

    function test_createSession() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit SessionCreated(0, owner, sessionKey, PER_TX, DAILY, expiry);
        uint256 id = vault.createSession(sessionKey, _payees(), PER_TX, DAILY, expiry);
        assertEq(id, 0);
        assertEq(vault.nextSessionId(), 1);

        AgentPayVault.Session memory s = vault.getSession(id);
        assertEq(s.sessionKey, sessionKey);
        assertEq(s.owner, owner);
        assertEq(s.payees.length, 2);
        assertEq(s.payees[0], payee1);
        assertEq(s.payees[1], payee2);
        assertEq(s.perTxLimit, PER_TX);
        assertEq(s.dailyLimit, DAILY);
        assertEq(s.spentToday, 0);
        assertEq(s.expiry, expiry);
        assertFalse(s.revoked);
        assertTrue(s.exists);
    }

    function test_createSession_idsIncrement() public {
        assertEq(_createSession(), 0);
        assertEq(_createSession(), 1);
        assertEq(vault.nextSessionId(), 2);
    }

    function test_createSession_dailyEqualsPerTxOk() public {
        vm.prank(owner);
        uint256 id = vault.createSession(sessionKey, _payees(), PER_TX, PER_TX, expiry);
        assertEq(vault.getSession(id).dailyLimit, PER_TX);
    }

    function test_createSession_revertsZeroSessionKey() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidSessionKey.selector);
        vault.createSession(address(0), _payees(), PER_TX, DAILY, expiry);
    }

    function test_createSession_revertsNoPayees() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.NoPayees.selector);
        vault.createSession(sessionKey, new address[](0), PER_TX, DAILY, expiry);
    }

    function test_createSession_revertsZeroPayee() public {
        address[] memory p = new address[](2);
        p[0] = payee1;
        p[1] = address(0);
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidPayee.selector);
        vault.createSession(sessionKey, p, PER_TX, DAILY, expiry);
    }

    function test_createSession_revertsZeroPerTxLimit() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidPerTxLimit.selector);
        vault.createSession(sessionKey, _payees(), 0, DAILY, expiry);
    }

    function test_createSession_revertsDailyBelowPerTx() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidDailyLimit.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, PER_TX - 1, expiry);
    }

    function test_createSession_revertsExpiredExpiry() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidExpiry.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, uint64(block.timestamp));
    }

    function test_createSession_revertsPastExpiry() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.InvalidExpiry.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, uint64(block.timestamp - 1));
    }

    // ---- revokeSession ----

    function test_revokeSession() public {
        uint256 id = _createSession();
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit SessionRevoked(id, owner);
        vault.revokeSession(id);
        assertTrue(vault.getSession(id).revoked);
    }

    function test_revokeSession_isIdempotent() public {
        uint256 id = _createSession();
        vm.startPrank(owner);
        vault.revokeSession(id);
        vault.revokeSession(id); // must not revert
        vm.stopPrank();
        assertTrue(vault.getSession(id).revoked);
    }

    function test_revokeSession_revertsNotOwner() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVault.NotSessionOwner.selector);
        vault.revokeSession(id);
    }

    function test_revokeSession_revertsSessionKeyCannotRevoke() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.NotSessionOwner.selector);
        vault.revokeSession(id);
    }

    function test_revokeSession_revertsNonexistent() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVault.SessionNotFound.selector);
        vault.revokeSession(99);
    }

    // ---- pay: happy path ----

    function test_pay() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectEmit(true, true, false, true);
        emit PaymentExecuted(id, payee1, 40e6, block.timestamp);
        vault.pay(id, payee1, 40e6);

        assertEq(token.balanceOf(payee1), 40e6);
        assertEq(vault.balances(owner), 960e6);
        assertEq(vault.getSession(id).spentToday, 40e6);
        assertEq(vault.remainingDailyAllowance(id), 210e6);
    }

    function test_pay_secondPayee() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vault.pay(id, payee2, 10e6);
        assertEq(token.balanceOf(payee2), 10e6);
    }

    function test_pay_atPerTxLimitOk() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        assertEq(token.balanceOf(payee1), PER_TX);
    }

    function test_pay_atDailyLimitOk() public {
        uint256 id = _createSession();
        vm.startPrank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, 50e6); // 100 + 100 + 50 = 250 = daily limit
        vm.stopPrank();
        assertEq(vault.remainingDailyAllowance(id), 0);
    }

    function test_pay_atExactExpiryOk() public {
        uint256 id = _createSession();
        vm.warp(expiry); // block.timestamp == expiry is still allowed
        vm.prank(sessionKey);
        vault.pay(id, payee1, 10e6);
        assertEq(token.balanceOf(payee1), 10e6);
    }

    function test_pay_sessionsAreIndependent() public {
        uint256 a = _createSession();
        uint256 b = _createSession();
        vm.prank(sessionKey);
        vault.pay(a, payee1, PER_TX);
        assertEq(vault.getSession(a).spentToday, PER_TX);
        assertEq(vault.getSession(b).spentToday, 0);
        assertEq(vault.remainingDailyAllowance(b), DAILY);
    }

    function testFuzz_payWithinLimits(uint256 amount) public {
        amount = bound(amount, 1, PER_TX);
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vault.pay(id, payee1, amount);
        assertEq(token.balanceOf(payee1), amount);
    }

    // ---- pay: reverts ----

    function test_pay_revertsNonexistentSession() public {
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.SessionNotFound.selector);
        vault.pay(99, payee1, 1);
    }

    function test_pay_revertsNotSessionKey() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVault.NotSessionKey.selector);
        vault.pay(id, payee1, 1);
    }

    function test_pay_revertsOwnerCannotPayDirectly() public {
        uint256 id = _createSession();
        vm.prank(owner); // the owner is not the session key
        vm.expectRevert(AgentPayVault.NotSessionKey.selector);
        vault.pay(id, payee1, 1);
    }

    function test_pay_revertsRevoked() public {
        uint256 id = _createSession();
        vm.prank(owner);
        vault.revokeSession(id);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.SessionIsRevoked.selector);
        vault.pay(id, payee1, 1);
    }

    function test_pay_revertsExpired() public {
        uint256 id = _createSession();
        vm.warp(expiry + 1);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.SessionExpired.selector);
        vault.pay(id, payee1, 1);
    }

    function test_pay_revertsPayeeNotAllowed() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.PayeeNotAllowed.selector);
        vault.pay(id, stranger, 1);
    }

    function test_pay_revertsZeroAmount() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.ZeroAmount.selector);
        vault.pay(id, payee1, 0);
    }

    function test_pay_revertsExceedsPerTxLimit() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.ExceedsPerTxLimit.selector);
        vault.pay(id, payee1, PER_TX + 1);
    }

    function test_pay_revertsExceedsDailyLimit() public {
        uint256 id = _createSession();
        vm.startPrank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, PER_TX);
        vm.expectRevert(AgentPayVault.ExceedsDailyLimit.selector);
        vault.pay(id, payee1, 50e6 + 1); // 100 + 100 + 50.000001 > 250
        vm.stopPrank();
    }

    function test_pay_revertsInsufficientVaultBalance() public {
        // Session limits allow 250/day, but the vault only holds 1,000 total;
        // drain it via withdraw first, then pay must fail on balance.
        vm.prank(owner);
        vault.withdraw(1_000e6);
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVault.InsufficientBalance.selector);
        vault.pay(id, payee1, 10e6);
    }

    function test_pay_dailyLimitStillEnforcedWhenBalanceIsLow() public {
        // Balance 1,000 covers the 250 daily cap; the cap binds first.
        uint256 id = _createSession();
        vm.startPrank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, 50e6);
        vm.expectRevert(AgentPayVault.ExceedsDailyLimit.selector);
        vault.pay(id, payee1, 1);
        vm.stopPrank();
    }

    // ---- daily reset ----

    function test_pay_dailyResetNextDay() public {
        uint256 id = _createSession();
        vm.startPrank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        vault.pay(id, payee1, 50e6); // spend 150 of 250
        vm.stopPrank();
        assertEq(vault.remainingDailyAllowance(id), PER_TX);

        vm.warp(block.timestamp + 1 days);
        assertEq(vault.remainingDailyAllowance(id), DAILY); // reset, no payment yet

        vm.prank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        assertEq(vault.getSession(id).spentToday, PER_TX);
    }

    function test_pay_dailyResetAfterManyDays() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        vm.warp(block.timestamp + 5 days);
        assertEq(vault.remainingDailyAllowance(id), DAILY);
        vm.prank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        assertEq(vault.getSession(id).spentToday, PER_TX);
    }

    function test_pay_dailyResetAtMidnightBoundary() public {
        uint256 id = _createSession();
        // Warp to the last second of the current UTC day, spend, then cross midnight.
        uint256 ts = vm.getBlockTimestamp();
        uint256 todayStart = (ts / 1 days) * 1 days;
        vm.warp(todayStart + 1 days - 1);
        vm.prank(sessionKey);
        vault.pay(id, payee1, PER_TX);
        assertEq(vault.remainingDailyAllowance(id), DAILY - PER_TX);

        vm.warp(todayStart + 1 days); // exactly midnight UTC
        assertEq(vault.remainingDailyAllowance(id), DAILY);
    }

    // ---- views ----

    function test_getSession_revertsNonexistent() public {
        vm.expectRevert(AgentPayVault.SessionNotFound.selector);
        vault.getSession(99);
    }

    function test_isPayeeAllowed() public {
        uint256 id = _createSession();
        assertTrue(vault.isPayeeAllowed(id, payee1));
        assertTrue(vault.isPayeeAllowed(id, payee2));
        assertFalse(vault.isPayeeAllowed(id, stranger));
        assertFalse(vault.isPayeeAllowed(99, payee1));
    }

    function test_remainingDailyAllowance_revertsNonexistent() public {
        vm.expectRevert(AgentPayVault.SessionNotFound.selector);
        vault.remainingDailyAllowance(99);
    }

    function test_remainingDailyAllowance_fullBeforeAnySpend() public {
        uint256 id = _createSession();
        assertEq(vault.remainingDailyAllowance(id), DAILY);
    }

    // ---- reentrancy ----

    function _maliciousVault() internal returns (MaliciousToken mToken, AgentPayVault mVault) {
        mToken = new MaliciousToken();
        mVault = new AgentPayVault(mToken);
        mToken.setVault(address(mVault));
        mToken.setAttack(true);
        mToken.mint(owner, 10_000e6);
        vm.prank(owner);
        mToken.approve(address(mVault), type(uint256).max);
    }

    function test_reentrancy_depositBlocked() public {
        (MaliciousToken mToken, AgentPayVault mVault) = _maliciousVault();
        vm.prank(owner);
        mVault.deposit(1_000e6); // succeeds: the re-entrant withdraw was blocked
        assertFalse(mToken.reentrancySucceeded());
        assertEq(mVault.balances(owner), 1_000e6);
    }

    function test_reentrancy_withdrawBlocked() public {
        (MaliciousToken mToken, AgentPayVault mVault) = _maliciousVault();
        vm.startPrank(owner);
        mVault.deposit(1_000e6);
        mVault.withdraw(100e6); // succeeds: the re-entrant withdraw was blocked
        vm.stopPrank();
        assertFalse(mToken.reentrancySucceeded());
        assertEq(mVault.balances(owner), 900e6);
    }

    function test_reentrancy_payBlocked() public {
        (MaliciousToken mToken, AgentPayVault mVault) = _maliciousVault();
        vm.prank(owner);
        mVault.deposit(1_000e6);
        vm.prank(owner);
        uint256 id = mVault.createSession(sessionKey, _payees(), PER_TX, DAILY, expiry);
        vm.prank(sessionKey);
        mVault.pay(id, payee1, 10e6); // succeeds: the re-entrant withdraw was blocked
        assertFalse(mToken.reentrancySucceeded());
        assertEq(mToken.balanceOf(payee1), 10e6);
        assertEq(mVault.balances(owner), 990e6);
    }
}
