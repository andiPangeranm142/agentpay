// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentPayVault
/// @notice Non-custodial vault for autonomous stablecoin bill payments on Aevum testnet.
///
/// An owner deposits tUSD8, then authorizes an AI agent's session key to pay
/// allowlisted payees within strict limits: per-transaction cap, daily cap,
/// expiry, and instant owner revocation. Every payment is an on-chain event,
/// forming a full audit trail.
///
/// Security model:
///  - There is NO admin/owner backdoor: only each owner can withdraw their own
///    balance, and a session key can only pay allowlisted payees within limits.
///  - All fund-moving functions are ReentrancyGuard-protected.
///  - Aevum runs the Shanghai EVM: this contract is compiled with
///    evm_version = "shanghai" and uses no Cancun-only opcodes and no
///    OpenZeppelin *Transient contracts.
contract AgentPayVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The tUSD8 token (6 decimals) this vault holds.
    IERC20 public immutable token;

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
        uint256 spentToday;
        uint256 lastSpendDay; // UTC day number: block.timestamp / 1 days
        uint64 expiry;
        bool revoked;
        bool exists;
    }

    mapping(uint256 => Session) private _sessions;

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

    error ZeroAmount();
    error InvalidSessionKey();
    error InvalidPayee();
    error NoPayees();
    error InvalidPerTxLimit();
    error InvalidDailyLimit();
    error InvalidExpiry();
    error SessionNotFound();
    error SessionIsRevoked();
    error SessionExpired();
    error NotSessionKey();
    error NotSessionOwner();
    error PayeeNotAllowed();
    error ExceedsPerTxLimit();
    error ExceedsDailyLimit();
    error InsufficientBalance();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert InvalidPayee();
        token = token_;
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
    /// within `perTxLimit` per payment and `dailyLimit` per UTC day, until
    /// `expiry`. Returns the new session id.
    function createSession(
        address sessionKey,
        address[] calldata payees,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint64 expiry
    ) external returns (uint256 sessionId) {
        if (sessionKey == address(0)) revert InvalidSessionKey();
        if (payees.length == 0) revert NoPayees();
        if (perTxLimit == 0) revert InvalidPerTxLimit();
        if (dailyLimit < perTxLimit) revert InvalidDailyLimit();
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
        s.expiry = expiry;
        s.exists = true;

        emit SessionCreated(sessionId, msg.sender, sessionKey, perTxLimit, dailyLimit, expiry);
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
    /// allowlist, per-tx limit, daily limit (resets each UTC day), expiry,
    /// revocation, and the owner's vault balance.
    function pay(uint256 sessionId, address payee, uint256 amount) external nonReentrant {
        Session storage s = _sessions[sessionId];
        if (!s.exists) revert SessionNotFound();
        if (msg.sender != s.sessionKey) revert NotSessionKey();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (!_isPayeeAllowed(s, payee)) revert PayeeNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > s.perTxLimit) revert ExceedsPerTxLimit();

        uint256 today = block.timestamp / 1 days;
        if (s.lastSpendDay != today) {
            s.spentToday = 0;
            s.lastSpendDay = today;
        }
        if (s.spentToday + amount > s.dailyLimit) revert ExceedsDailyLimit();
        if (balances[s.owner] < amount) revert InsufficientBalance();

        s.spentToday += amount;
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

    function _isPayeeAllowed(Session storage s, address payee) internal view returns (bool) {
        uint256 len = s.payees.length;
        for (uint256 i; i < len; i++) {
            if (s.payees[i] == payee) return true;
        }
        return false;
    }
}
