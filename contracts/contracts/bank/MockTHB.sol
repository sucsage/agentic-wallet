// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title MockTHB (mTHB)
/// @notice Testnet token that mirrors baht held in the Mock Bank. It has no value and cannot be
///         exchanged for real money.
///
///         Every token in circulation must be backed by baht in the Mock Bank's reserve account:
///           Mock Bank debits a buyer        -> BANK_ROLE mints to the buyer's AgentWallet
///           a holder redeems (burns) tokens -> Mock Bank credits that holder's bank account
///         so the off-chain reconciler can check  reserve balance == totalSupply()  at one block.
///
///         Because the Mock Bank and the chain cannot change together atomically, every mint and
///         redeem carries an id that can only be used once. After an RPC timeout the bank asks the
///         chain (`minted`, `redeemed`) instead of guessing, and retries without minting twice.
///
///         BANK_ROLE is a hot server key, so the contract also limits what a stolen one can do:
///         caps per mint and per day, and an emergency pause. It cannot burn anyone's tokens.
contract MockTHB is ERC20, AccessControl, Pausable {
    bytes32 public constant BANK_ROLE = keccak256("BANK_ROLE");

    uint256 public maxMintPerTx;
    uint256 public dailyMintCap;
    mapping(uint256 => uint256) public mintedOnDay;

    /// @notice Funding ids already minted against.
    mapping(bytes32 => bool) public minted;
    /// @notice Redeem ids already used, per holder: the Mock Bank credits (holder, id) exactly once.
    mapping(address => mapping(bytes32 => bool)) public redeemed;

    event Minted(bytes32 indexed fundingId, address indexed to, uint256 amount);
    event Redeemed(address indexed from, bytes32 indexed redeemId, uint256 amount);
    event MintCapsSet(uint256 maxMintPerTx, uint256 dailyMintCap);

    error InvalidId();
    error IdAlreadyUsed(bytes32 id);
    error InvalidAmount();
    error ExceedsMintPerTx(uint256 amount, uint256 maxMintPerTx);
    error ExceedsDailyMintCap(uint256 amount, uint256 remaining);
    error InvalidCaps();
    error AdminMustNotMint();

    /// @param admin   Manages roles, caps and unpausing. Keep it cold (hardware wallet / multisig).
    /// @param bank    The Mock Bank server's hot key. Must not be the admin.
    constructor(address admin, address bank, uint256 maxPerTx, uint256 dailyCap) ERC20("Mock Thai Baht", "mTHB") {
        if (admin == bank) revert AdminMustNotMint();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BANK_ROLE, bank);
        _setMintCaps(maxPerTx, dailyCap);
    }

    /// @notice Satang: amounts match the Mock Bank's integer minor units exactly.
    function decimals() public pure override returns (uint8) {
        return 2;
    }

    // ----------------------------------------------------------------------------------------
    // Bank side
    // ----------------------------------------------------------------------------------------

    /// @notice Mints tokens backed by baht the Mock Bank just moved into its reserve account.
    /// @param fundingId The Mock Bank's funding record id; one mint per id, ever.
    function mint(address to, uint256 amount, bytes32 fundingId) external onlyRole(BANK_ROLE) whenNotPaused {
        if (fundingId == bytes32(0)) revert InvalidId();
        if (minted[fundingId]) revert IdAlreadyUsed(fundingId);
        if (amount == 0) revert InvalidAmount();
        if (amount > maxMintPerTx) revert ExceedsMintPerTx(amount, maxMintPerTx);
        uint256 day = block.timestamp / 1 days;
        uint256 used = mintedOnDay[day];
        uint256 remaining = used >= dailyMintCap ? 0 : dailyMintCap - used;
        if (amount > remaining) revert ExceedsDailyMintCap(amount, remaining);

        minted[fundingId] = true;
        mintedOnDay[day] = used + amount;
        _mint(to, amount);
        emit Minted(fundingId, to, amount);
    }

    // ----------------------------------------------------------------------------------------
    // Holder side
    // ----------------------------------------------------------------------------------------

    /// @notice Burns the caller's own tokens so the Mock Bank pays out the same amount in baht.
    ///         Only the holder can do this: the bank key can never destroy anyone's tokens.
    /// @param redeemId The payout's id; the Mock Bank credits each (holder, id) once.
    function redeem(uint256 amount, bytes32 redeemId) external whenNotPaused {
        if (redeemId == bytes32(0)) revert InvalidId();
        if (redeemed[msg.sender][redeemId]) revert IdAlreadyUsed(redeemId);
        if (amount == 0) revert InvalidAmount();

        redeemed[msg.sender][redeemId] = true;
        _burn(msg.sender, amount);
        emit Redeemed(msg.sender, redeemId, amount);
    }

    // ----------------------------------------------------------------------------------------
    // Admin and emergency
    // ----------------------------------------------------------------------------------------

    function setMintCaps(uint256 maxPerTx, uint256 dailyCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMintCaps(maxPerTx, dailyCap);
    }

    /// @notice Stops minting and redeeming. Transfers keep working, so deals already locked in an
    ///         escrow can still settle. The bank key can pull the brake; only the admin releases it.
    function pause() external {
        if (!hasRole(BANK_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, BANK_ROLE);
        }
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _setMintCaps(uint256 maxPerTx, uint256 dailyCap) private {
        if (maxPerTx == 0 || maxPerTx > dailyCap) revert InvalidCaps();
        maxMintPerTx = maxPerTx;
        dailyMintCap = dailyCap;
        emit MintCapsSet(maxPerTx, dailyCap);
    }
}
