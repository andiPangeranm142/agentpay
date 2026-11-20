// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice TEST MOCK ONLY — implements the FROZEN AgentPayVault interface so
/// the agent service can be tested end-to-end on a local anvil chain before
/// the real contract artifacts exist. NOT the production contract (that lives
/// in ../../contracts, owned by the contracts workstream). The e2e script
/// prefers the real artifact whenever it is available.
///
/// Interface implemented (frozen spec):
///   deposit(uint256), withdraw(uint256),
///   createSession(address,address[],uint256,uint256,uint64) returns (uint256),
///   revokeSession(uint256), pay(uint256,address,uint256),
///   getSession(uint256), isPayeeAllowed(uint256,address),
///   remainingDailyAllowance(uint256),
///   events Deposited, Withdrawn, SessionCreated, SessionRevoked,
///   PaymentExecuted(sessionId, payee, amount, timestamp).
contract MockVault {
    IERC20Minimal public immutable token;
    address public immutable owner;

    struct Session {
        address sessionKey;
        address owner;
        address[] payees;
        uint256 perTxLimit;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 lastSpendDay;
        uint64 expiry;
        bool revoked;
        bool exists;
    }

    uint256 public nextSessionId;
    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public payeeAllowed;

    error NotOwner();
    error SessionNotFound();
    error NotSessionKey();
    error SessionAlreadyRevoked();
    error SessionExpired();
    error PayeeNotAllowlisted();
    error PerTxLimitExceeded();
    error DailyLimitExceeded();
    error InsufficientBalance();

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
    event PaymentExecuted(uint256 indexed sessionId, address indexed payee, uint256 amount, uint256 timestamp);

    constructor(address token_) {
        token = IERC20Minimal(token_);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function deposit(uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "deposit failed");
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyOwner {
        if (token.balanceOf(address(this)) < amount) revert InsufficientBalance();
        require(token.transfer(owner, amount), "withdraw failed");
        emit Withdrawn(owner, amount);
    }

    function createSession(
        address sessionKey,
        address[] calldata payees,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint64 expiry
    ) external onlyOwner returns (uint256 sessionId) {
        sessionId = nextSessionId++;
        sessions[sessionId].sessionKey = sessionKey;
        sessions[sessionId].owner = msg.sender;
        sessions[sessionId].payees = payees;
        sessions[sessionId].perTxLimit = perTxLimit;
        sessions[sessionId].dailyLimit = dailyLimit;
        sessions[sessionId].expiry = expiry;
        sessions[sessionId].exists = true;
        for (uint256 i = 0; i < payees.length; i++) {
            payeeAllowed[sessionId][payees[i]] = true;
        }
        emit SessionCreated(sessionId, msg.sender, sessionKey, perTxLimit, dailyLimit, expiry);
    }

    function revokeSession(uint256 sessionId) external onlyOwner {
        if (sessionId >= nextSessionId) revert SessionNotFound();
        sessions[sessionId].revoked = true;
        emit SessionRevoked(sessionId, msg.sender);
    }

    function pay(uint256 sessionId, address payee, uint256 amount) external {
        if (sessionId >= nextSessionId) revert SessionNotFound();
        Session storage s = sessions[sessionId];
        if (msg.sender != s.sessionKey) revert NotSessionKey();
        if (s.revoked) revert SessionAlreadyRevoked();
        if (block.timestamp > s.expiry) revert SessionExpired();
        if (!payeeAllowed[sessionId][payee]) revert PayeeNotAllowlisted();
        if (amount > s.perTxLimit) revert PerTxLimitExceeded();
        uint256 day = block.timestamp / 1 days;
        if (s.lastSpendDay != day) {
            s.lastSpendDay = day;
            s.spentToday = 0;
        }
        if (s.spentToday + amount > s.dailyLimit) revert DailyLimitExceeded();
        if (token.balanceOf(address(this)) < amount) revert InsufficientBalance();
        s.spentToday += amount;
        require(token.transfer(payee, amount), "payment transfer failed");
        emit PaymentExecuted(sessionId, payee, amount, block.timestamp);
    }

    function getSession(uint256 sessionId) external view returns (Session memory) {
        if (sessionId >= nextSessionId) revert SessionNotFound();
        return sessions[sessionId];
    }

    function isPayeeAllowed(uint256 sessionId, address payee) external view returns (bool) {
        if (sessionId >= nextSessionId) return false;
        return payeeAllowed[sessionId][payee];
    }

    function remainingDailyAllowance(uint256 sessionId) external view returns (uint256) {
        if (sessionId >= nextSessionId) return 0;
        Session storage s = sessions[sessionId];
        if (s.lastSpendDay != block.timestamp / 1 days) return s.dailyLimit;
        return s.dailyLimit - s.spentToday;
    }
}
