// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MilestoneEscrow
/// @notice Holds a buyer's payment and releases it to the contractor one milestone at a time
///         (e.g. deposit -> delivery -> FAT -> SAT -> retention). The contractor anchors
///         delivery evidence on-chain; the buyer releases; an arbiter settles disputes.
contract MilestoneEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        EvidenceSubmitted,
        Released,
        Disputed,
        Refunded
    }

    struct Deal {
        address payer;
        address payee;
        address arbiter;
        IERC20 token;
        uint256 total;
        uint256 milestoneCount;
        bool funded;
        string termsURI;
    }

    struct Milestone {
        uint256 amount;
        Status status;
        bytes32 evidenceHash;
        string evidenceURI;
    }

    uint256 public dealCount;
    mapping(uint256 => Deal) private _deals;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(address => uint256[]) private _dealsAsPayer;
    mapping(address => uint256[]) private _dealsAsPayee;

    event DealCreated(
        uint256 indexed dealId, address indexed payer, address indexed payee, address token, uint256 total, string termsURI
    );
    event DealFunded(uint256 indexed dealId, uint256 total);
    event EvidenceSubmitted(uint256 indexed dealId, uint256 indexed index, bytes32 evidenceHash, string evidenceURI);
    event MilestoneReleased(uint256 indexed dealId, uint256 indexed index, address to, uint256 amount);
    event MilestoneDisputed(uint256 indexed dealId, uint256 indexed index, address by);
    event MilestoneRefunded(uint256 indexed dealId, uint256 indexed index, address to, uint256 amount);

    error NotPayer();
    error NotPayee();
    error NotArbiter();
    error NotParty();
    error InvalidDeal();
    error AlreadyFunded();
    error NotFunded();
    error BadStatus(Status current);
    error BadIndex();

    modifier validMilestone(uint256 dealId, uint256 index) {
        if (dealId >= dealCount) revert InvalidDeal();
        if (index >= _deals[dealId].milestoneCount) revert BadIndex();
        _;
    }

    function createDeal(
        address payee,
        address arbiter,
        IERC20 token,
        uint256[] calldata amounts,
        string calldata termsURI
    ) external returns (uint256 dealId) {
        if (payee == address(0) || arbiter == address(0) || address(token) == address(0)) revert InvalidDeal();
        if (payee == msg.sender || amounts.length == 0) revert InvalidDeal();

        dealId = dealCount++;
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert InvalidDeal();
            _milestones[dealId][i].amount = amounts[i];
            total += amounts[i];
        }
        _deals[dealId] = Deal({
            payer: msg.sender,
            payee: payee,
            arbiter: arbiter,
            token: token,
            total: total,
            milestoneCount: amounts.length,
            funded: false,
            termsURI: termsURI
        });
        _dealsAsPayer[msg.sender].push(dealId);
        _dealsAsPayee[payee].push(dealId);
        emit DealCreated(dealId, msg.sender, payee, address(token), total, termsURI);
    }

    function fund(uint256 dealId) external nonReentrant {
        if (dealId >= dealCount) revert InvalidDeal();
        Deal storage d = _deals[dealId];
        if (msg.sender != d.payer) revert NotPayer();
        if (d.funded) revert AlreadyFunded();
        d.funded = true;
        d.token.safeTransferFrom(msg.sender, address(this), d.total);
        emit DealFunded(dealId, d.total);
    }

    /// @notice Contractor anchors a hash of the delivery evidence (report, photos, signed acceptance).
    function submitEvidence(uint256 dealId, uint256 index, bytes32 evidenceHash, string calldata evidenceURI)
        external
        validMilestone(dealId, index)
    {
        if (msg.sender != _deals[dealId].payee) revert NotPayee();
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Pending && m.status != Status.EvidenceSubmitted) revert BadStatus(m.status);
        m.status = Status.EvidenceSubmitted;
        m.evidenceHash = evidenceHash;
        m.evidenceURI = evidenceURI;
        emit EvidenceSubmitted(dealId, index, evidenceHash, evidenceURI);
    }

    function release(uint256 dealId, uint256 index) external nonReentrant validMilestone(dealId, index) {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.payer) revert NotPayer();
        if (!d.funded) revert NotFunded();
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Pending && m.status != Status.EvidenceSubmitted) revert BadStatus(m.status);
        m.status = Status.Released;
        d.token.safeTransfer(d.payee, m.amount);
        emit MilestoneReleased(dealId, index, d.payee, m.amount);
    }

    function dispute(uint256 dealId, uint256 index) external validMilestone(dealId, index) {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.payer && msg.sender != d.payee) revert NotParty();
        if (!d.funded) revert NotFunded();
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Pending && m.status != Status.EvidenceSubmitted) revert BadStatus(m.status);
        m.status = Status.Disputed;
        emit MilestoneDisputed(dealId, index, msg.sender);
    }

    /// @notice Arbiter settles a disputed milestone to either side.
    function resolve(uint256 dealId, uint256 index, bool toPayee) external nonReentrant validMilestone(dealId, index) {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.arbiter) revert NotArbiter();
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Disputed) revert BadStatus(m.status);
        if (toPayee) {
            m.status = Status.Released;
            d.token.safeTransfer(d.payee, m.amount);
            emit MilestoneReleased(dealId, index, d.payee, m.amount);
        } else {
            m.status = Status.Refunded;
            d.token.safeTransfer(d.payer, m.amount);
            emit MilestoneRefunded(dealId, index, d.payer, m.amount);
        }
    }

    /// @notice Contractor can voluntarily hand a milestone back to the buyer (e.g. scope cut).
    function refund(uint256 dealId, uint256 index) external nonReentrant validMilestone(dealId, index) {
        Deal storage d = _deals[dealId];
        if (msg.sender != d.payee) revert NotPayee();
        if (!d.funded) revert NotFunded();
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Pending && m.status != Status.EvidenceSubmitted) revert BadStatus(m.status);
        m.status = Status.Refunded;
        d.token.safeTransfer(d.payer, m.amount);
        emit MilestoneRefunded(dealId, index, d.payer, m.amount);
    }

    function dealsOf(address account) external view returns (uint256[] memory asPayer, uint256[] memory asPayee) {
        return (_dealsAsPayer[account], _dealsAsPayee[account]);
    }

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        if (dealId >= dealCount) revert InvalidDeal();
        return _deals[dealId];
    }

    function getMilestone(uint256 dealId, uint256 index)
        external
        view
        validMilestone(dealId, index)
        returns (Milestone memory)
    {
        return _milestones[dealId][index];
    }
}
