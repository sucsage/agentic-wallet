// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockTHB} from "./MockTHB.sol";

/// @title MockCNY (mCNY)
/// @notice The Mock Bank's yuan, for its Chinese customers: the same rules as mTHB (bank-only
///         id-based minting with caps, holder-only redeem), in fen instead of satang.
contract MockCNY is MockTHB {
    constructor(address admin, address bank, uint256 maxPerTx, uint256 dailyCap) MockTHB(admin, bank, maxPerTx, dailyCap) {}

    function name() public pure override returns (string memory) {
        return "Mock Chinese Yuan";
    }

    function symbol() public pure override returns (string memory) {
        return "mCNY";
    }
}
