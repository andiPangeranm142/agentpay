// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPayVaultV3} from "../src/AgentPayVaultV3.sol";
import {PayeeRegistryV3} from "../src/PayeeRegistryV3.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Tests for v3: case-insensitive name matching, reverse lookup
/// (name -> address) with per-owner name uniqueness, and fail-fast session
/// creation — plus regression coverage for the v1/v2 vault behavior the v3
/// vault inherits.
contract AgentPayVaultV3Test is Test {
    AgentPayVaultV3 vault;
    PayeeRegistryV3 registry;
    MockUSD8 token;

    address owner = makeAddr("owner");
    address owner2 = makeAddr("owner2");
    address sessionKey = makeAddr("sessionKey");
    address payee1 = makeAddr("payee1");
    address payee2 = makeAddr("payee2");
    address lookalike = makeAddr("lookalike");
    address stranger = makeAddr("stranger");

    string constant NAME1 = "Kedai Kopi Senja";
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
        registry = new PayeeRegistryV3();
        vault = new AgentPayVaultV3(token, registry);
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

    /// @notice Flip the case of each ASCII letter of `base` according to
    /// the bits of `mask` (bit i flips letter i). Used by the fuzz tests.
    function _caseVariant(string memory base, uint256 mask) internal pure returns (string memory) {
        bytes memory b = bytes(base);
        bytes memory out = new bytes(b.length);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool flip = (mask >> i) & 1 == 1;
            if (c >= 0x41 && c <= 0x5A) {
                out[i] = flip ? bytes1(uint8(c) + 32) : c;
            } else if (c >= 0x61 && c <= 0x7A) {
                out[i] = flip ? bytes1(uint8(c) - 32) : c;
            } else {
                out[i] = c;
            }
        }
        return string(out);
    }

    // ---- v3: case-insensitive matching ----

    function test_v3_matchesNameIsCaseInsensitive() public view {
        assertTrue(registry.matchesName(owner, payee1, "kedai kopi senja"));
        assertTrue(registry.matchesName(owner, payee1, "KEDAI KOPI SENJA"));
        assertTrue(registry.matchesName(owner, payee1, "KeDaI KoPi SeNjA"));
        assertTrue(registry.matchesName(owner, payee1, NAME1));
        // Display name keeps its original case.
        assertEq(registry.nameOf(owner, payee1), NAME1);
    }

    function test_v3_matchesNameStillRejectsWrongNames() public view {
        assertFalse(registry.matchesName(owner, payee1, "Kedai Kopi Senaj"));
        assertFalse(registry.matchesName(owner, payee1, "kedai kopi senaj"));
        assertFalse(registry.matchesName(owner, payee1, "Kedai Kopi Senja "));
        assertFalse(registry.matchesName(owner, payee1, " Kedai Kopi Senja"));
        assertFalse(registry.matchesName(owner, payee1, ""));
        assertFalse(registry.matchesName(owner, lookalike, NAME1));
    }

    function test_v3_normalizeIsAsciiOnly() public view {
        // ASCII letters fold; digits, punctuation and non-ASCII bytes pass
        // through unchanged (documented limitation).
        assertEq(registry.normalize("AbC-123_XyZ"), bytes("abc-123_xyz"));
        assertEq(registry.normalizedHash("Kedai Kopi Senja"), registry.normalizedHash("kedai kopi senja"));
        assertEq(registry.registeredNameHash(owner, payee1), keccak256(bytes("kedai kopi senja")));
        assertEq(registry.registeredNameHash(owner, lookalike), bytes32(0));
    }

    function test_v3_fuzz_anyCaseVariantMatches(uint256 mask) public view {
        // Every case permutation of the registered name matches.
        string memory variant = _caseVariant(NAME1, mask);
        assertTrue(registry.matchesName(owner, payee1, variant));
        assertEq(registry.addressOf(owner, variant), payee1);
    }

    function test_v3_fuzz_wrongNameNeverMatches(string memory wrongName) public view {
        vm.assume(registry.normalizedHash(wrongName) != registry.normalizedHash(NAME1));
        assertFalse(registry.matchesName(owner, payee1, wrongName));
    }

    // ---- v3: reverse lookup + name uniqueness ----

    function test_v3_addressOf() public view {
        assertEq(registry.addressOf(owner, NAME1), payee1);
        assertEq(registry.addressOf(owner, "kedai kopi senja"), payee1);
        assertEq(registry.addressOf(owner, "KEDAI KOPI SENJA"), payee1);
        assertEq(registry.addressOf(owner, NAME2), payee2);
        assertEq(registry.addressOf(owner, "toko listrik jaya"), payee2);
        // Unknown names resolve to address(0).
        assertEq(registry.addressOf(owner, "Nobody"), address(0));
        assertEq(registry.addressOf(owner, ""), address(0));
        assertEq(registry.addressOf(owner2, NAME1), address(0));
    }

    function test_v3_registerRevertsOnDuplicateNameDifferentCase() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistryV3.NameAlreadyTaken.selector, payee1));
        registry.registerPayee(lookalike, "kedai kopi senja");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistryV3.NameAlreadyTaken.selector, payee1));
        registry.registerPayee(lookalike, "KEDAI KOPI SENJA");
        // Exact-case duplicate also reverts.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistryV3.NameAlreadyTaken.selector, payee1));
        registry.registerPayee(lookalike, NAME1);
        assertFalse(registry.isRegistered(owner, lookalike));
    }

    function test_v3_sameNameAllowedInDifferentOwnerNamespace() public {
        // Name uniqueness is per owner: owner2 may use the same name.
        vm.prank(owner2);
        registry.registerPayee(payee1, "kedai kopi senja");
        assertEq(registry.addressOf(owner2, "Kedai Kopi Senja"), payee1);
        assertEq(registry.addressOf(owner, "Kedai Kopi Senja"), payee1);
    }

    function test_v3_updateMovesReverseLookup() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeUpdated(owner, payee1, NAME1, "Kedai Kopi Senja Baru");
        registry.updatePayee(payee1, "Kedai Kopi Senja Baru");
        // Old name is freed, new name resolves.
        assertEq(registry.addressOf(owner, NAME1), address(0));
        assertEq(registry.addressOf(owner, "kedai kopi senja"), address(0));
        assertEq(registry.addressOf(owner, "Kedai Kopi Senja Baru"), payee1);
        assertEq(registry.addressOf(owner, "kedai kopi senja baru"), payee1);
        assertTrue(registry.matchesName(owner, payee1, "kedai kopi senja baru"));
        assertFalse(registry.matchesName(owner, payee1, NAME1));
        // The freed name can be registered by another payee.
        vm.prank(owner);
        registry.registerPayee(lookalike, NAME1);
        assertEq(registry.addressOf(owner, NAME1), lookalike);
    }

    function test_v3_updateRevertsWhenNewNameTaken() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistryV3.NameAlreadyTaken.selector, payee2));
        registry.updatePayee(payee1, "toko listrik jaya");
        // State unchanged: old mapping intact.
        assertEq(registry.nameOf(owner, payee1), NAME1);
        assertEq(registry.addressOf(owner, NAME1), payee1);
        assertEq(registry.addressOf(owner, NAME2), payee2);
    }

    function test_v3_updateToSameNameDifferentCaseIsAllowed() public {
        // Same normalized hash: just a display-case change, no conflict.
        vm.prank(owner);
        registry.updatePayee(payee1, "KEDAI KOPI SENJA");
        assertEq(registry.nameOf(owner, payee1), "KEDAI KOPI SENJA");
        assertEq(registry.addressOf(owner, "kedai kopi senja"), payee1);
        assertTrue(registry.matchesName(owner, payee1, NAME1));
    }

    function test_v3_removeDeletesReverseLookup() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeRemoved(owner, payee1, NAME1);
        registry.removePayee(payee1);
        assertEq(registry.addressOf(owner, NAME1), address(0));
        assertEq(registry.addressOf(owner, "kedai kopi senja"), address(0));
        assertFalse(registry.isRegistered(owner, payee1));
        // Name is free again after removal.
        vm.prank(owner);
        registry.registerPayee(lookalike, "KEDAI KOPI SENJA");
        assertEq(registry.addressOf(owner, "kedai kopi senja"), lookalike);
    }

    // ---- v3: registry guards carried over from v2 ----

    function test_v3_registry_registerAndRead() public view {
        assertEq(registry.nameOf(owner, payee1), NAME1);
        assertTrue(registry.isRegistered(owner, payee1));
        assertFalse(registry.isRegistered(owner, lookalike));
        assertEq(registry.nameOf(owner, lookalike), "");
    }

    function test_v3_registry_registerEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PayeeRegistered(owner, lookalike, "Lookalike Shop");
        registry.registerPayee(lookalike, "Lookalike Shop");
    }

    function test_v3_registry_namespacesArePerOwner() public {
        vm.prank(owner2);
        registry.registerPayee(payee1, "Kedai Lain");
        assertEq(registry.nameOf(owner, payee1), NAME1);
        assertEq(registry.nameOf(owner2, payee1), "Kedai Lain");
        vm.prank(owner2);
        vm.expectRevert(PayeeRegistryV3.PayeeAlreadyRegistered.selector);
        registry.registerPayee(payee1, "Hacked");
    }

    function test_v3_registry_registerRevertsOnDuplicatePayee() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.PayeeAlreadyRegistered.selector);
        registry.registerPayee(payee1, "Other Name");
    }

    function test_v3_registry_revertsOnZeroPayee() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.InvalidPayee.selector);
        registry.registerPayee(address(0), "Nobody");
    }

    function test_v3_registry_revertsOnEmptyName() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.EmptyName.selector);
        registry.registerPayee(lookalike, "");
    }

    function test_v3_registry_revertsOnNameTooLong() public {
        string memory long = new string(65);
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.NameTooLong.selector);
        registry.registerPayee(lookalike, long);
    }

    function test_v3_registry_updateRevertsWhenUnregistered() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.PayeeNotRegistered.selector);
        registry.updatePayee(lookalike, "Ghost");
    }

    function test_v3_registry_removeRevertsWhenUnregistered() public {
        vm.prank(owner);
        vm.expectRevert(PayeeRegistryV3.PayeeNotRegistered.selector);
        registry.removePayee(lookalike);
    }

    // ---- v3: fail-fast session creation ----

    function test_v3_createSession_revertsWhenPayeeUnregistered() public {
        address[] memory p = new address[](1);
        p[0] = lookalike;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV3.PayeeNotRegistered.selector, lookalike));
        vault.createSession(sessionKey, p, PER_TX, DAILY, PER_PAYEE, expiry);
        assertEq(vault.nextSessionId(), 0);
    }

    function test_v3_createSession_revertsWhenAnyPayeeUnregistered() public {
        // First payee is fine, second is not — the whole creation fails.
        address[] memory p = new address[](2);
        p[0] = payee1;
        p[1] = lookalike;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV3.PayeeNotRegistered.selector, lookalike));
        vault.createSession(sessionKey, p, PER_TX, DAILY, PER_PAYEE, expiry);
        assertEq(vault.nextSessionId(), 0);
    }

    function test_v3_createSession_succeedsAfterRegistering() public {
        vm.prank(owner);
        registry.registerPayee(lookalike, "Lookalike Shop");
        address[] memory p = new address[](1);
        p[0] = lookalike;
        vm.prank(owner);
        uint256 id = vault.createSession(sessionKey, p, PER_TX, DAILY, PER_PAYEE, expiry);
        assertEq(id, 0);
        assertTrue(vault.isPayeeAllowed(id, lookalike));
    }

    function test_v3_createSession_checksCreatorNamespace() public {
        // payee1 is registered in owner's namespace but NOT in owner2's,
        // so owner2 cannot create a session for it.
        address[] memory p = new address[](1);
        p[0] = payee1;
        vm.prank(owner2);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV3.PayeeNotRegistered.selector, payee1));
        vault.createSession(sessionKey, p, PER_TX, DAILY, PER_PAYEE, expiry);
    }

    // ---- v3: CoP payments (case-insensitive) ----

    function test_v3_pay_succeedsWithLowercaseName() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectEmit(true, true, false, true);
        emit PaymentExecuted(id, payee1, 50e6, block.timestamp);
        vault.pay(id, payee1, 50e6, "kedai kopi senja");
        assertEq(token.balanceOf(payee1), 50e6);
        assertEq(vault.balances(owner), 950e6);
        assertEq(vault.spentPerPayee(id, payee1), 50e6);
    }

    function test_v3_pay_succeedsWithAnyCaseVariant() public {
        uint256 id = _createSession();
        _pay(id, payee1, 10e6, "KEDAI KOPI SENJA");
        _pay(id, payee1, 10e6, "KeDaI KoPi SeNjA");
        _pay(id, payee2, 10e6, "TOKO LISTRIK JAYA");
        assertEq(token.balanceOf(payee1), 20e6);
        assertEq(token.balanceOf(payee2), 10e6);
    }

    function test_v3_pay_revertsOnWrongName_normalizedHashes() public {
        uint256 id = _createSession();
        bytes32 expected = keccak256(bytes("kedai kopi senaj"));
        bytes32 registered = keccak256(bytes("kedai kopi senja"));
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(AgentPayVaultV3.PayeeNameMismatch.selector, expected, registered)
        );
        vault.pay(id, payee1, 50e6, "Kedai Kopi Senaj");
        assertEq(token.balanceOf(payee1), 0);
        assertEq(vault.balances(owner), 1_000e6);
    }

    function test_v3_pay_revertsAfterPayeeRemoved_defenceInDepth() public {
        // Fail-fast passed at creation; removal afterwards must still
        // block payment (the pay-time check is kept).
        uint256 id = _createSession();
        vm.prank(owner);
        registry.removePayee(payee1);
        vm.prank(sessionKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPayVaultV3.PayeeNotRegistered.selector, payee1));
        vault.pay(id, payee1, 50e6, NAME1);
    }

    function test_v3_pay_revertsWhenNameUpdated() public {
        uint256 id = _createSession();
        vm.prank(owner);
        registry.updatePayee(payee1, "Kedai Kopi Senja Baru");
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPayVaultV3.PayeeNameMismatch.selector,
                keccak256(bytes("kedai kopi senja")),
                keccak256(bytes("kedai kopi senja baru"))
            )
        );
        vault.pay(id, payee1, 50e6, NAME1);
        // The new name works, in any case.
        _pay(id, payee1, 50e6, "kedai kopi senja baru");
        assertEq(token.balanceOf(payee1), 50e6);
    }

    function test_v3_pay_fuzz_wrongNameAlwaysReverts(string memory wrongName) public {
        bytes32 wrongHash = registry.normalizedHash(wrongName);
        vm.assume(wrongHash != registry.normalizedHash(NAME1));
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentPayVaultV3.PayeeNameMismatch.selector, wrongHash, keccak256(bytes("kedai kopi senja"))
            )
        );
        vault.pay(id, payee1, 1e6, wrongName);
    }

    function test_v3_pay_fuzz_anyCaseVariantSucceeds(uint256 mask) public {
        string memory variant = _caseVariant(NAME1, mask);
        uint256 id = _createSession();
        _pay(id, payee1, 1e6, variant);
        assertEq(token.balanceOf(payee1), 1e6);
    }

    function test_v3_pay_usesSessionOwnersNamespace() public {
        vm.prank(owner2);
        registry.registerPayee(payee1, "Kedai Lain");
        uint256 id = _createSession();
        _pay(id, payee1, 50e6, "kedai kopi senja");
        assertEq(token.balanceOf(payee1), 50e6);
    }

    // ---- regression: v1/v2 vault behavior in v3 ----

    function test_v3_depositAndWithdraw() public {
        vm.prank(owner);
        vault.deposit(500e6);
        assertEq(vault.balances(owner), 1_500e6);
        vm.prank(owner);
        vault.withdraw(1_500e6);
        assertEq(vault.balances(owner), 0);
        assertEq(token.balanceOf(owner), 10_000e6);
    }

    function test_v3_withdraw_revertsWhenInsufficient() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.InsufficientBalance.selector);
        vault.withdraw(1_001e6);
    }

    function test_v3_perPayeeCap_blocksOverCap() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1);
        _pay(id, payee1, 50e6, NAME1);
        assertEq(vault.remainingPayeeAllowance(id, payee1), 0);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.ExceedsPerPayeeCap.selector);
        vault.pay(id, payee1, 1e6, NAME1);
        _pay(id, payee2, 100e6, NAME2);
        assertEq(token.balanceOf(payee2), 100e6);
    }

    function test_v3_perPayeeCap_isPerSession() public {
        uint256 id1 = _createSession();
        uint256 id2 = _createSession();
        _pay(id1, payee1, 100e6, NAME1);
        _pay(id1, payee1, 50e6, NAME1);
        assertEq(vault.remainingPayeeAllowance(id2, payee1), PER_PAYEE);
        _pay(id2, payee1, 100e6, NAME1);
    }

    function test_v3_pay_revertsOverPerTxLimit() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.ExceedsPerTxLimit.selector);
        vault.pay(id, payee1, PER_TX + 1, NAME1);
    }

    function test_v3_pay_revertsOverDailyLimit() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1);
        _pay(id, payee2, 100e6, NAME2);
        _pay(id, payee1, 50e6, NAME1);
        assertEq(vault.remainingDailyAllowance(id), 0);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.ExceedsDailyLimit.selector);
        vault.pay(id, payee2, 1e6, NAME2);
    }

    function test_v3_dailyLimit_resetsNextDay() public {
        uint256 id = _createSession();
        _pay(id, payee1, 100e6, NAME1);
        _pay(id, payee2, 100e6, NAME2);
        _pay(id, payee1, 50e6, NAME1);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(vault.remainingDailyAllowance(id), DAILY);
        _pay(id, payee2, 50e6, NAME2);
        assertEq(token.balanceOf(payee2), 150e6);
    }

    function test_v3_pay_revertsAfterExpiry() public {
        uint256 id = _createSession();
        vm.warp(expiry + 1);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.SessionExpired.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_v3_pay_revertsAfterRevoke() public {
        uint256 id = _createSession();
        vm.prank(owner);
        vault.revokeSession(id);
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.SessionIsRevoked.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_v3_pay_revertsWhenNotSessionKey() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVaultV3.NotSessionKey.selector);
        vault.pay(id, payee1, 10e6, NAME1);
    }

    function test_v3_pay_revertsWhenPayeeNotAllowed() public {
        uint256 id = _createSession();
        vm.prank(owner);
        registry.registerPayee(lookalike, "Lookalike Shop");
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.PayeeNotAllowed.selector);
        vault.pay(id, lookalike, 10e6, "Lookalike Shop");
    }

    function test_v3_pay_revertsOnZeroAmount() public {
        uint256 id = _createSession();
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.ZeroAmount.selector);
        vault.pay(id, payee1, 0, NAME1);
    }

    function test_v3_pay_revertsOnUnknownSession() public {
        vm.prank(sessionKey);
        vm.expectRevert(AgentPayVaultV3.SessionNotFound.selector);
        vault.pay(99, payee1, 10e6, NAME1);
    }

    function test_v3_revoke_revertsWhenNotOwner() public {
        uint256 id = _createSession();
        vm.prank(stranger);
        vm.expectRevert(AgentPayVaultV3.NotSessionOwner.selector);
        vault.revokeSession(id);
    }

    function test_v3_createSession_revertsOnBadInputs() public {
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.InvalidSessionKey.selector);
        vault.createSession(address(0), _payees(), PER_TX, DAILY, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.NoPayees.selector);
        vault.createSession(sessionKey, new address[](0), PER_TX, DAILY, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.InvalidDailyLimit.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, PER_TX - 1, PER_PAYEE, expiry);
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.InvalidExpiry.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, PER_PAYEE, uint64(block.timestamp));
        vm.prank(owner);
        vm.expectRevert(AgentPayVaultV3.InvalidPerPayeeCap.selector);
        vault.createSession(sessionKey, _payees(), PER_TX, DAILY, PER_TX - 1, expiry);
    }

    function test_v3_createSession_storesPerPayeeCap() public {
        uint256 id = _createSession();
        AgentPayVaultV3.Session memory s = vault.getSession(id);
        assertEq(s.perPayeeCap, PER_PAYEE);
    }

    function test_v3_constructor_revertsOnZeroRegistry() public {
        vm.expectRevert(AgentPayVaultV3.InvalidRegistry.selector);
        new AgentPayVaultV3(token, PayeeRegistryV3(address(0)));
    }

    function test_v3_constructor_revertsOnZeroToken() public {
        vm.expectRevert(AgentPayVaultV3.InvalidPayee.selector);
        new AgentPayVaultV3(MockUSD8(address(0)), registry);
    }
}
