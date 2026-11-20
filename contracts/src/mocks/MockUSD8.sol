// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal 6-decimal ERC-20 standing in for tUSD8 on local chains and
/// in unit tests. NEVER deploy to Aevum: the deploy script only uses it on
/// chain 31337, where the real tUSD8 does not exist.
contract MockUSD8 is ERC20 {
    constructor() ERC20("Mock USD8", "mUSD8") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
