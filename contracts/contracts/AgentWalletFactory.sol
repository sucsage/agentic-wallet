// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentWallet} from "./AgentWallet.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @title AgentWalletFactory
/// @notice Deploys a fully configured AgentWallet in one transaction. On testnet it can also seed
///         the wallet from a mintable mock stablecoin, so every demo visitor gets an isolated sandbox.
contract AgentWalletFactory {
    event WalletCreated(address indexed wallet, address indexed owner, address indexed agent, address creator);

    mapping(address => address[]) private _walletsOf;

    function createWallet(AgentWallet.Config calldata config, uint256 seedAmount) external returns (AgentWallet wallet) {
        wallet = new AgentWallet(config);
        if (seedAmount != 0) IMintable(address(config.token)).mint(address(wallet), seedAmount);
        _walletsOf[config.owner].push(address(wallet));
        emit WalletCreated(address(wallet), config.owner, config.agent, msg.sender);
    }

    function walletsOf(address owner) external view returns (address[] memory) {
        return _walletsOf[owner];
    }
}
