// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PayeeRegistry} from "./PayeeRegistry.sol";

/// @title AgentPayVaultV2
/// @notice AgentPay vault with Confirmation of Payee (CoP).
///
/// Everything AgentPayVault (v1) does — deposit, withdraw, sessions with a
/// payee allowlist, per-tx limit, daily limit, expiry, instant revocation —
/// plus two safety upgrades:
///
///  1. Confirmation of Payee: every payment must name the payee. The session
///     key passes the expected human-readable name (e.g. "Sari Bakery") and
///     the vault checks it against the session owner's PayeeRegistry entry
///     for that address. A wrong name reverts with PayeeNameMismatch; an
///     unregistered payee reverts with PayeeNotRegistered. An agent that
///     hallucinates, mistypes, or is tricked into a lookalike address cannot
///     move funds, because the lookalike has no matching registered name.
///  2. Per-payee spend cap: each session sets a cumulative cap per payee, so
///     even a compromised session key can only drain a bounded amount to any
///     single payee.
///
/// The registry is per-owner: each owner manages their own payee names, and
/// the vault always checks the *session owner's* namespace, never the
/// session key's.
///
/// Aevum runs the Shanghai EVM: compiled with evm_version = "shanghai",
/// no Cancun-only opcodes, no OpenZeppelin *Transient contracts.
contract AgentPayVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The tUSD8 token (6 decimals) this vault holds.
    IERC20 public immutable token;

    /// @notice The on-chain payee-name registry consulted on every payment.
    PayeeRegistry public immutable registry;

    /// @notice Vault balance per owner, in tUSD8 base units.
    mapping(address => uint256) public balances;

    /// @notice Next session id to assign (also the number of sessions created).
    uint256 public nextSessionId;

    struct Session {
        address sessionKey;
        address owner;
        address[] payees;
        uint256 perTxLimit;
        uint256 dailyLimit;
        uint256 perPayeeCap; // cumulative cap per payee over the session's life
        uint256 spentToday;
        uint256 lastSpendDay; // UTC day number: block.timestamp / 1 days
        uint64 expiry;
        bool revoked;
        bool exists;
    }

    mapping(uint256 => Session) private _sessions;

    /// @notice Cumulative amount paid to each payee per session.
    mapping(uint256 => mapping(address => uint256)) public spentPerPayee;

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event SessionCreated(
        uint256 indexed sessionId,
        address indexed owner,
        address indexed sessionKey,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint256 perPayeeCap,
        uint64 expiry
    );
    event SessionRevoked(uint256 indexed sessionId, address indexed owner);
    event PaymentExecuted(
        uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp
    );

    error ZeroAmount();
    error InvalidRegistry();
    error InvalidSessionKey();
    error InvalidPayee();
    error NoPayees();
    error InvalidPerTxLimit();
    error InvalidDailyLimit();
    error InvalidPerPayeeCap();
    error InvalidExpiry();
    error SessionNotFound();
    error SessionIsRevoked();
    error SessionExpired();
    error NotSessionKey();
    error NotSessionOwner();
    error PayeeNotAllowed();
    error ExceedsPerTxLimit();
    error ExceedsDailyLimit();
    error ExceedsPerPayeeCap();
    error InsufficientBalance();
    /// @notice The payee has no registered name in the session owner's namespace.
    error PayeeNotRegistered(address payee);
    /// @notice The supplied name does not match the registered name.
    /// Hashes (not the names) are emitted to keep the error cheap.
    error PayeeNameMismatch(bytes32 expectedNameHash, bytes32 registeredNameHash);

    constructor(IERC20 token_, PayeeRegistry registry_) {
        if (address(token_) == address(0)) revert InvalidPayee();
        if (address(registry_) == address(0)) revert InvalidRegistry();
        token = token_;
        registry = registry_;
    }

    /// @notice Deposit tUSD8 into the caller's vault balance. Approve first.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw tUSD8 from the caller's own vault balance.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Create a session authorizing `sessionKey` to pay `payees`
    /// within `perTxLimit` per payment, `dailyLimit` per UTC day, and
    /// `perPayeeCap` cumulatively per payee, until `expiry`.
    /// Returns the new session id.
    function createSession(
        address sessionKey,
        address[] calldata payees,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint256 perPayeeCap,
        uint64 expiry
    ) external returns (uint256 sessionId) {
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (payees.length == 0) revert NoPayees();
        if (perTxLimit == 0) revert InvalidPerTxLimit();
        if (dailyLimit < perTxLimit) revert InvalidDailyLimit();
        if (perPayeeCap < perTxLimit) revert InvalidPerPayeeCap();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        for (uint256 i; i < payees.length; i++) {
            if (payees[i] == address(0)) revert InvalidPayee();
        }

        sessionId = nextSessionId++;
        Session storage s = _sessions[sessionId];
        s.sessionKey = sessionKey;
        s.owner = msg.sender;
        s.payees = payees;
        s.perTxLimit = perTxLimit;
        s.dailyLimit = dailyLimit;
        s.perPayeeCap = perPayeeCap;
        s.expiry = expiry;
        s.exists = true;

        emit SessionCreated(sessionId, msg.sender, sessionKey, perTxLimit, dailyLimit, perPayeeCap, expiry);
    }

    /// @notice Instantly revoke a session. Only its owner. Idempotent.
    function revokeSession(uint256 sessionId) external {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (s.owner != msg.sender) revert NotSessionOwner();
        s.revoked = true;
        emit SessionRevoked(sessionId, msg.sender);
    }

    /// @notice Pay `amount` tUSD8 from the session owner's vault balance to
    /// `payee`. Only the session's sessionKey may call. Enforces the
    /// allowlist, Confirmation of Payee (the `expectedName` must exactly
    /// match the name the session owner registered for `payee`), the
    /// per-tx limit, per-payee cap, daily limit (resets each UTC day),
    /// expiry, revocation, and the owner's vault balance.
    function pay(uint256 sessionId, address payee, uint256 amount, string calldata expectedName)
        external
        nonReentrant
    {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (msg.sender != s.sessionKey) revert NotSessionKey();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (!_isPayeeAllowed(s, payee)) revert PayeeNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > s.perTxLimit) revert ExceedsPerTxLimit();

        // Confirmation of Payee: the payee must be registered in the session
        // owner's namespace, and the supplied name must match exactly.
        string memory registeredName = registry.nameOf(s.owner, payee);
        if (bytes(registeredName).length == 0) revert PayeeNotRegistered(payee);
        bytes32 expectedHash = keccak256(bytes(expectedName));
        bytes32 registeredHash = keccak256(bytes(registeredName));
        if (expectedHash != registeredHash) {
            revert PayeeNameMismatch(expectedHash, registeredHash);
        }

        if (spentPerPayee[sessionId][payee] + amount > s.perPayeeCap) {
            revert ExceedsPerPayeeCap();
        }

        uint256 today = block.timestamp / 1 days;
        if (s.lastSpendDay != today) {
            s.spentToday = 0;
            s.lastSpendDay = today;
        }
        if (s.spentToday + amount > s.dailyLimit) revert ExceedsDailyLimit();
        if (balances[s.owner] < amount) revert InsufficientBalance();

        s.spentToday += amount;
        spentPerPayee[sessionId][payee] += amount;
        balances[s.owner] -= amount;
        token.safeTransfer(payee, amount);
        emit PaymentExecuted(sessionId, payee, amount, block.timestamp);
    }

    /// @notice Full session record, including the payee allowlist.
    function getSession(uint256 sessionId) external view returns (Session memory) {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        return s;
    }

    /// @notice True if `payee` is on the session's allowlist (false for
    /// unknown sessions).
    function isPayeeAllowed(uint256 sessionId, address payee) external view returns (bool) {
        Session storage s = _sessions[sessionId];
        if (!s.exists) return false;
        return _isPayeeAllowed(s, payee);
    }

    /// @notice How much the session may still spend today (UTC day). Resets
    /// to the full daily limit on a new day even before any payment is made.
    function remainingDailyAllowance(uint256 sessionId) external view returns (uint256) {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        uint256 spent = s.lastSpendDay == block.timestamp / 1 days ? s.spentToday : 0;
        return s.dailyLimit > spent ? s.dailyLimit - spent : 0;
    }

    /// @notice How much the session may still pay to `payee` under its
    /// per-payee cap.
    function remainingPayeeAllowance(uint256 sessionId, address payee) external view returns (uint256) {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        uint256 spent = spentPerPayee[sessionId][payee];
        return s.perPayeeCap > spent ? s.perPayeeCap - spent : 0;
    }

    function _isPayeeAllowed(Session storage s, address payee) internal view returns (bool) {
        uint256 len = s.payees.length;
        for (uint256 i; i < len; i++) {
            if (s.payees[i] == payee) return true;
        }
        return false;
    }
}
