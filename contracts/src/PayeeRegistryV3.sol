// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PayeeRegistryV3
/// @notice On-chain Confirmation of Payee registry for AgentPay, v3.
///
/// Same per-owner namespaces as PayeeRegistry (v2), plus:
///
///  1. Case-insensitive name matching. The original name is stored for
///     display, but comparison uses the keccak256 hash of the name
///     normalized to lowercase, so "sari bakery" matches a payee
///     registered as "Sari Bakery". Normalization is ASCII-only
///     (bytes 'A'..'Z' map to 'a'..'z'); non-ASCII letters (e.g. 'É',
///     'İ', 'Ä') are NOT folded, so names differing only in non-ASCII
///     case still compare unequal. Whitespace is not trimmed either:
///     "Sari Bakery " does not match "Sari Bakery". This is a deliberate
///     scope limit — full Unicode case folding on-chain is out of scope.
///  2. Reverse lookup: `addressOf(owner, name)` returns the payee address
///     registered under that (normalized) name in the owner's namespace,
///     or address(0) when no payee has that name.
///  3. Name uniqueness per owner: within one owner's namespace, a name
///     (compared after normalization) may belong to only one payee.
///     Registering or renaming to a name another payee already holds
///     reverts with `NameAlreadyTaken`.
///
/// AgentPayVaultV3 reads this registry at payment time and at session
/// creation (fail-fast). This contract is a fresh deployment; the v2
/// registry is untouched and keeps serving AgentPayVaultV2.
contract PayeeRegistryV3 {
    /// @notice Maximum name length in bytes.
    uint256 public constant MAX_NAME_LENGTH = 64;

    /// @notice Registered name per (owner, payee), exactly as registered.
    /// Empty string = not registered.
    mapping(address => mapping(address => string)) private _names;

    /// @notice Reverse lookup: (owner, normalized-name hash) -> payee.
    /// address(0) = no payee registered under that name.
    mapping(address => mapping(bytes32 => address)) private _addressOf;

    event PayeeRegistered(address indexed owner, address indexed payee, string name);
    event PayeeUpdated(address indexed owner, address indexed payee, string oldName, string newName);
    event PayeeRemoved(address indexed owner, address indexed payee, string oldName);

    error InvalidPayee();
    error EmptyName();
    error NameTooLong();
    error PayeeNotRegistered();
    error PayeeAlreadyRegistered();
    /// @notice The (normalized) name is already taken by another payee in
    /// this owner's namespace. `holder` is the payee that owns the name.
    error NameAlreadyTaken(address holder);

    /// @notice Lowercase a name (ASCII only: 'A'..'Z' -> 'a'..'z').
    /// Non-ASCII bytes pass through unchanged — see the contract notice.
    function normalize(string memory name) public pure returns (bytes memory) {
        bytes memory raw = bytes(name);
        bytes memory out = new bytes(raw.length);
        for (uint256 i; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c >= 0x41 && c <= 0x5A) {
                // 'A' (0x41) .. 'Z' (0x5A): add 32 to reach lowercase.
                out[i] = bytes1(uint8(c) + 32);
            } else {
                out[i] = c;
            }
        }
        return out;
    }

    /// @notice keccak256 hash of the normalized (lowercased) name — the
    /// value all comparisons and the reverse lookup are keyed on.
    function normalizedHash(string memory name) public pure returns (bytes32) {
        return keccak256(normalize(name));
    }

    /// @notice The normalized-name hash of the name registered for `payee`
    /// in `owner`'s namespace, or bytes32(0) when the payee is not
    /// registered. Used by the vault to report PayeeNameMismatch with the
    /// same normalized hashes it compared.
    function registeredNameHash(address owner, address payee) external view returns (bytes32) {
        string memory stored = _names[owner][payee];
        if (bytes(stored).length == 0) return bytes32(0);
        return normalizedHash(stored);
    }

    /// @notice Register `name` for `payee` in the caller's namespace.
    /// Reverts if the payee is already registered (use updatePayee) or if
    /// the (normalized) name is already taken by another payee.
    function registerPayee(address payee, string calldata name) external {
        if (payee == address(0)) revert InvalidPayee();
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(name).length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(_names[msg.sender][payee]).length != 0) revert PayeeAlreadyRegistered();
        bytes32 hash = normalizedHash(name);
        address holder = _addressOf[msg.sender][hash];
        if (holder != address(0)) revert NameAlreadyTaken(holder);
        _names[msg.sender][payee] = name;
        _addressOf[msg.sender][hash] = payee;
        emit PayeeRegistered(msg.sender, payee, name);
    }

    /// @notice Change the registered name for `payee` in the caller's
    /// namespace. Moves the reverse-lookup entry: the old name is freed
    /// and the new name is claimed. Reverts if the new (normalized) name
    /// is taken by another payee. Renaming to the same name in a
    /// different case (same normalized hash) is allowed.
    function updatePayee(address payee, string calldata newName) external {
        if (payee == address(0)) revert InvalidPayee();
        if (bytes(newName).length == 0) revert EmptyName();
        if (bytes(newName).length > MAX_NAME_LENGTH) revert NameTooLong();
        string memory oldName = _names[msg.sender][payee];
        if (bytes(oldName).length == 0) revert PayeeNotRegistered();
        bytes32 oldHash = normalizedHash(oldName);
        bytes32 newHash = normalizedHash(newName);
        if (newHash != oldHash) {
            address holder = _addressOf[msg.sender][newHash];
            if (holder != address(0)) revert NameAlreadyTaken(holder);
            delete _addressOf[msg.sender][oldHash];
            _addressOf[msg.sender][newHash] = payee;
        }
        _names[msg.sender][payee] = newName;
        emit PayeeUpdated(msg.sender, payee, oldName, newName);
    }

    /// @notice Remove `payee` from the caller's namespace, freeing its
    /// name for reuse. Payments to the payee revert until it is
    /// registered again.
    function removePayee(address payee) external {
        if (payee == address(0)) revert InvalidPayee();
        string memory oldName = _names[msg.sender][payee];
        if (bytes(oldName).length == 0) revert PayeeNotRegistered();
        delete _addressOf[msg.sender][normalizedHash(oldName)];
        delete _names[msg.sender][payee];
        emit PayeeRemoved(msg.sender, payee, oldName);
    }

    /// @notice The registered name for `payee` in `owner`'s namespace,
    /// exactly as registered (original case). "" when not registered.
    function nameOf(address owner, address payee) external view returns (string memory) {
        return _names[owner][payee];
    }

    /// @notice The payee registered under `name` in `owner`'s namespace.
    /// Lookup is case-insensitive (the name is normalized before the
    /// lookup). Returns address(0) when no payee has that name.
    function addressOf(address owner, string calldata name) external view returns (address) {
        return _addressOf[owner][normalizedHash(name)];
    }

    /// @notice True when `payee` has a registered name in `owner`'s namespace.
    function isRegistered(address owner, address payee) external view returns (bool) {
        return bytes(_names[owner][payee]).length != 0;
    }

    /// @notice True when `expectedName` matches the registered name for
    /// `payee` in `owner`'s namespace after ASCII-lowercase
    /// normalization ("sari bakery" matches "Sari Bakery").
    /// False for unregistered payees.
    function matchesName(address owner, address payee, string calldata expectedName)
        external
        view
        returns (bool)
    {
        string memory stored = _names[owner][payee];
        if (bytes(stored).length == 0) return false;
        return normalizedHash(stored) == normalizedHash(expectedName);
    }
}
