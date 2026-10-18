// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ChainAnchor
/// @notice Public timestamps for the per-device deal chains of the Agentic Wallet desktop app.
///         Every user keeps their own hash-linked chain of deal blocks on their computer; the server
///         keeps only the latest block (the head) of each, co-signed by the device and the server.
///         Now and then the server puts one Merkle root of all heads here. Anyone can then check that
///         a head the server shows existed at that time, and the server cannot quietly rewrite or
///         swap a user's head later: an earlier anchor would no longer verify.
/// @dev Holds no money and has no upgrade or admin path besides the one anchorer set at deployment.
contract ChainAnchor {
    struct Anchor {
        bytes32 root;
        uint64 heads;
        uint64 at;
    }

    address public immutable anchorer;
    Anchor[] private anchors;

    event Anchored(uint256 indexed seq, bytes32 indexed root, uint64 heads, uint64 at);

    error NotAnchorer();
    error EmptyRoot();

    constructor(address anchorer_) {
        anchorer = anchorer_;
    }

    /// @notice Records one Merkle root over `heads` device heads. Only the anchorer (the server).
    function anchor(bytes32 root, uint64 heads) external returns (uint256 seq) {
        if (msg.sender != anchorer) revert NotAnchorer();
        if (root == bytes32(0)) revert EmptyRoot();
        seq = anchors.length;
        anchors.push(Anchor(root, heads, uint64(block.timestamp)));
        emit Anchored(seq, root, heads, uint64(block.timestamp));
    }

    function anchorCount() external view returns (uint256) {
        return anchors.length;
    }

    function getAnchor(uint256 seq) external view returns (Anchor memory) {
        return anchors[seq];
    }
}
