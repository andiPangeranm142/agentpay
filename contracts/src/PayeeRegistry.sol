// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PayeeRegistry
/// @notice On-chain Confirmation of Payee registry for AgentPay.
///
/// Each vault owner keeps their own namespace of payee names: the caller of
/// `registerPayee`/`updatePayee`/`removePayee` owns the binding for that
/// (owner, payee) pair, so nobody can rename or remove someone else's payee.
/// AgentPayVaultV2 reads this registry at payment time and reverts unless the
/// session key supplies the exact registered name for the payee address —
/// a mistyped address or lookalike address has no matching name, so the
/// payment cannot go through.
///
/// Names are compared by keccak256 hash, so comparison is exact and
/// case-sensitive ("Sari Bakery" != "sari bakery"). A name is at most 64
/// bytes (UTF-8), which keeps registration gas small and blocks abuse via
/// oversized strings.
contract PayeeRegistry {
    /// @notice Maximum name length in bytes.
    uint256 public constant MAX_NAME_LENGTH = 64;

    /// @notice Registered name per (owner, payee). Empty string = not registered.
    mapping(address => mapping(address => string)) private _names;

    event PayeeRegistered(address indexed owner, address indexed payee, string name);
    event PayeeUpdated(address indexed owner, address indexed payee, string oldName, string newName);
    event PayeeRemoved(address indexed owner, address indexed payee, string oldName);

    error InvalidPayee();
    error EmptyName();
    error NameTooLong();
    error PayeeNotRegistered();
    error PayeeAlreadyRegistered();

    /// @notice Register `name` for `payee` in the caller's namespace.
    /// Reverts if the payee is already registered (use updatePayee).
    function registerPayee(address payee, string calldata name) external {
        if (payee == address(0)) revert InvalidPayee();
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(_names[msg.sender][payee]).length != 0) revert PayeeAlreadyRegistered();
        _names[msg.sender][payee] = name;
        emit PayeeRegistered(msg.sender, payee, name);
    }

    /// @notice Change the registered name for `payee` in the caller's namespace.
    function updatePayee(address payee, string calldata newName) external {
        if (payee == address(0)) revert InvalidPayee();
        if (bytes(newName).length == 0) revert EmptyName();
        if (bytes(newName).length > MAX_NAME_LENGTH) revert NameTooLong();
        string memory oldName = _names[msg.sender][payee];
        if (bytes(oldName).length == 0) revert PayeeNotRegistered();
        _names[msg.sender][payee] = newName;
        emit PayeeUpdated(msg.sender, payee, oldName, newName);
    }

    /// @notice Remove `payee` from the caller's namespace. Payments to the
    /// payee revert until it is registered again.
    function removePayee(address payee) external {
        if (payee == address(0)) revert InvalidPayee();
        string memory oldName = _names[msg.sender][payee];
        if (bytes(oldName).length == 0) revert PayeeNotRegistered();
        delete _names[msg.sender][payee];
        emit PayeeRemoved(msg.sender, payee, oldName);
    }

    /// @notice The registered name for `payee` in `owner`'s namespace.
    /// Returns "" when the payee is not registered.
    function nameOf(address owner, address payee) external view returns (string memory) {
        return _names[owner][payee];
    }

    /// @notice True when `payee` has a registered name in `owner`'s namespace.
    function isRegistered(address owner, address payee) external view returns (bool) {
        return bytes(_names[owner][payee]).length != 0;
    }

    /// @notice True when `expectedName` exactly matches the registered name
    /// for `payee` in `owner`'s namespace (keccak256 comparison).
    /// False for unregistered payees.
    function matchesName(address owner, address payee, string calldata expectedName)
        external
        view
        returns (bool)
    {
        string memory stored = _names[owner][payee];
        if (bytes(stored).length == 0) return false;
        return keccak256(bytes(stored)) == keccak256(bytes(expectedName));
    }
}
