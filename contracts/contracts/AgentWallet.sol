// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {MilestoneEscrow} from "./MilestoneEscrow.sol";

/// @title AgentWallet
/// @notice A smart-contract wallet that an AI agent can operate through scoped, expiring session keys.
///         Every rule the agent must follow is enforced here, on-chain, so a manipulated or
///         hallucinating agent still cannot move funds outside policy.
///
///         Permission tiers:
///           Tier 0 Read      - off-chain only (balances, history).
///           Tier 1 Propose   - agent drafts an action; `threshold` human approvers must sign off.
///           Tier 2 Auto      - agent executes directly within per-tx / daily caps, allowlisted
///                              recipients and allowlisted escrows only.
///           Tier 3 Emergency - agent, approvers and owner can pause; only the owner can unpause.
contract AgentWallet is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        Transfer,
        ReleaseMilestone,
        Call
    }

    struct Session {
        uint64 expiresAt; // 0 = no session
        uint256 maxPerTx;
        uint256 dailyLimit;
    }

    struct Proposal {
        Kind kind;
        address proposer;
        address target; // Transfer: recipient. ReleaseMilestone/Call: contract.
        uint256 amount; // Transfer: token amount. ReleaseMilestone: dealId.
        uint256 index; // ReleaseMilestone: milestone index.
        bytes data; // Call only.
        string reason;
        uint64 expiresAt;
        uint64 approverEpoch;
        uint32 approvals;
        bool executed;
        bool cancelled;
    }

    uint64 public constant PROPOSAL_TTL = 3 days;

    /// @notice The only token the agent may spend (the settlement stablecoin).
    IERC20 public immutable token;

    bool public paused;

    mapping(address => Session) public sessions;
    mapping(address => mapping(uint256 => uint256)) public spentOnDay; // key => day => amount

    mapping(address => bool) public allowedRecipient;
    mapping(address => bool) public allowedEscrow;

    mapping(address => bool) public isApprover;
    uint256 public approverCount;
    uint256 public threshold;
    /// @dev Bumped whenever the approver set or threshold changes; invalidates pending proposals.
    uint64 public approverEpoch;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    event SessionSet(address indexed key, uint64 expiresAt, uint256 maxPerTx, uint256 dailyLimit);
    event SessionRevoked(address indexed key);
    event RecipientSet(address indexed recipient, bool allowed);
    event EscrowSet(address indexed escrow, bool allowed);
    event ApproverSet(address indexed approver, bool allowed);
    event ThresholdSet(uint256 threshold);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AgentTransfer(address indexed key, address indexed to, uint256 amount);
    event AgentMilestoneReleased(address indexed key, address indexed escrow, uint256 dealId, uint256 index, uint256 amount);
    event ProposalCreated(uint256 indexed id, address indexed proposer, Kind kind, address target, uint256 amount, string reason);
    event ProposalApproved(uint256 indexed id, address indexed approver, uint256 approvals);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id, address indexed by);
    event OwnerExecuted(address indexed target, uint256 value, bytes data);

    error WalletPaused();
    error NotAgent();
    error NotApprover();
    error NotAuthorized();
    error RecipientNotAllowed(address recipient);
    error EscrowNotAllowed(address escrow);
    error ExceedsPerTxLimit(uint256 amount, uint256 maxPerTx);
    error ExceedsDailyLimit(uint256 amount, uint256 remaining);
    error NotPayerOfDeal();
    error WrongToken();
    error InvalidProposal();
    error ProposalClosed();
    error ProposalExpired();
    error ProposalStale();
    error AlreadyApproved();
    error InvalidThreshold();
    error InvalidSession();

    constructor(address owner_, IERC20 token_) Ownable(owner_) {
        token = token_;
    }

    receive() external payable {}

    // ----------------------------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------------------------

    modifier whenNotPaused() {
        if (paused) revert WalletPaused();
        _;
    }

    modifier onlyAgent() {
        if (!isActiveSession(msg.sender)) revert NotAgent();
        _;
    }

    modifier onlyApprover() {
        if (!isApprover[msg.sender]) revert NotApprover();
        _;
    }

    // ----------------------------------------------------------------------------------------
    // Owner configuration
    // ----------------------------------------------------------------------------------------

    function setSession(address key, uint64 expiresAt, uint256 maxPerTx, uint256 dailyLimit) external onlyOwner {
        if (key == address(0) || expiresAt <= block.timestamp || maxPerTx > dailyLimit) revert InvalidSession();
        sessions[key] = Session(expiresAt, maxPerTx, dailyLimit);
        emit SessionSet(key, expiresAt, maxPerTx, dailyLimit);
    }

    function revokeSession(address key) external onlyOwner {
        delete sessions[key];
        emit SessionRevoked(key);
    }

    function setRecipient(address recipient, bool allowed) external onlyOwner {
        allowedRecipient[recipient] = allowed;
        emit RecipientSet(recipient, allowed);
    }

    function setEscrow(address escrow, bool allowed) external onlyOwner {
        allowedEscrow[escrow] = allowed;
        emit EscrowSet(escrow, allowed);
    }

    function setApprover(address approver, bool allowed) external onlyOwner {
        if (approver == address(0) || isApprover[approver] == allowed) revert InvalidThreshold();
        isApprover[approver] = allowed;
        if (allowed) {
            approverCount++;
        } else {
            approverCount--;
            if (threshold > approverCount) revert InvalidThreshold();
        }
        approverEpoch++;
        emit ApproverSet(approver, allowed);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > approverCount) revert InvalidThreshold();
        threshold = newThreshold;
        approverEpoch++;
        emit ThresholdSet(newThreshold);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Unrestricted escape hatch for the human owner (setup, funding escrows, recovery).
    ///         The owner key should be a hardware wallet or a multisig, never held by the agent.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        nonReentrant
        returns (bytes memory)
    {
        bytes memory result = Address.functionCallWithValue(target, data, value);
        emit OwnerExecuted(target, value, data);
        return result;
    }

    // ----------------------------------------------------------------------------------------
    // Tier 3: emergency stop
    // ----------------------------------------------------------------------------------------

    function pause() external {
        if (msg.sender != owner() && !isApprover[msg.sender] && !isActiveSession(msg.sender)) revert NotAuthorized();
        paused = true;
        emit Paused(msg.sender);
    }

    // ----------------------------------------------------------------------------------------
    // Tier 2: autonomous agent actions (capped)
    // ----------------------------------------------------------------------------------------

    function agentTransfer(address to, uint256 amount) external onlyAgent whenNotPaused nonReentrant {
        if (!allowedRecipient[to]) revert RecipientNotAllowed(to);
        _spend(msg.sender, amount);
        token.safeTransfer(to, amount);
        emit AgentTransfer(msg.sender, to, amount);
    }

    function agentReleaseMilestone(address escrow, uint256 dealId, uint256 index)
        external
        onlyAgent
        whenNotPaused
        nonReentrant
    {
        uint256 amount = _checkRelease(escrow, dealId, index);
        _spend(msg.sender, amount);
        MilestoneEscrow(escrow).release(dealId, index);
        emit AgentMilestoneReleased(msg.sender, escrow, dealId, index, amount);
    }

    // ----------------------------------------------------------------------------------------
    // Tier 1: propose -> human approval
    // ----------------------------------------------------------------------------------------

    function propose(
        Kind kind,
        address target,
        uint256 amount,
        uint256 index,
        bytes calldata data,
        string calldata reason
    ) external whenNotPaused returns (uint256 id) {
        if (!isActiveSession(msg.sender) && !isApprover[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        if (threshold == 0) revert InvalidThreshold();
        _checkProposal(kind, target, amount, index, data);

        id = _proposals.length;
        _proposals.push(
            Proposal({
                kind: kind,
                proposer: msg.sender,
                target: target,
                amount: amount,
                index: index,
                data: data,
                reason: reason,
                expiresAt: uint64(block.timestamp) + PROPOSAL_TTL,
                approverEpoch: approverEpoch,
                approvals: 0,
                executed: false,
                cancelled: false
            })
        );
        emit ProposalCreated(id, msg.sender, kind, target, amount, reason);
    }

    function approve(uint256 id) external onlyApprover whenNotPaused nonReentrant {
        Proposal storage p = _openProposal(id);
        if (hasApproved[id][msg.sender]) revert AlreadyApproved();
        hasApproved[id][msg.sender] = true;
        p.approvals++;
        emit ProposalApproved(id, msg.sender, p.approvals);

        if (p.approvals >= threshold) {
            p.executed = true;
            _executeProposal(p);
            emit ProposalExecuted(id);
        }
    }

    function cancel(uint256 id) external {
        Proposal storage p = _openProposal(id);
        if (msg.sender != p.proposer && !isApprover[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        p.cancelled = true;
        emit ProposalCancelled(id, msg.sender);
    }

    // ----------------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------------

    function isActiveSession(address key) public view returns (bool) {
        return sessions[key].expiresAt > block.timestamp;
    }

    function remainingToday(address key) external view returns (uint256) {
        Session memory s = sessions[key];
        uint256 spent = spentOnDay[key][block.timestamp / 1 days];
        return spent >= s.dailyLimit ? 0 : s.dailyLimit - spent;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id >= _proposals.length) revert InvalidProposal();
        return _proposals[id];
    }

    // ----------------------------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------------------------

    function _spend(address key, uint256 amount) private {
        Session memory s = sessions[key];
        if (amount > s.maxPerTx) revert ExceedsPerTxLimit(amount, s.maxPerTx);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[key][day];
        uint256 remaining = spent >= s.dailyLimit ? 0 : s.dailyLimit - spent;
        if (amount > remaining) revert ExceedsDailyLimit(amount, remaining);
        spentOnDay[key][day] = spent + amount;
    }

    /// @dev Validates that a milestone release pays an allowlisted payee, in the settlement token,
    ///      from a deal this wallet is the payer of. Returns the milestone amount.
    function _checkRelease(address escrow, uint256 dealId, uint256 index) private view returns (uint256) {
        if (!allowedEscrow[escrow]) revert EscrowNotAllowed(escrow);
        MilestoneEscrow.Deal memory d = MilestoneEscrow(escrow).getDeal(dealId);
        if (d.payer != address(this)) revert NotPayerOfDeal();
        if (address(d.token) != address(token)) revert WrongToken();
        if (!allowedRecipient[d.payee]) revert RecipientNotAllowed(d.payee);
        return MilestoneEscrow(escrow).getMilestone(dealId, index).amount;
    }

    function _checkProposal(Kind kind, address target, uint256 amount, uint256 index, bytes calldata data)
        private
        view
    {
        if (kind == Kind.Transfer) {
            if (!allowedRecipient[target]) revert RecipientNotAllowed(target);
            if (amount == 0 || data.length != 0) revert InvalidProposal();
        } else if (kind == Kind.ReleaseMilestone) {
            _checkRelease(target, amount, index);
            if (data.length != 0) revert InvalidProposal();
        } else {
            if (amount != 0 || index != 0) revert InvalidProposal();
            _checkCall(target, data);
        }
    }

    /// @dev Generic calls are limited to setting up escrow deals: token.approve(escrow, x),
    ///      escrow.createDeal(allowlisted payee, ...), escrow.fund(id) and escrow.dispute(id, i).
    ///      Anything that moves funds out (transfer, release) must use its dedicated, checked path.
    function _checkCall(address target, bytes memory data) private view {
        if (data.length < 4) revert InvalidProposal();
        bytes4 selector = bytes4(data);
        if (target == address(token)) {
            if (selector != IERC20.approve.selector || data.length != 68) revert InvalidProposal();
            (address spender,) = abi.decode(_args(data), (address, uint256));
            if (!allowedEscrow[spender]) revert EscrowNotAllowed(spender);
        } else if (allowedEscrow[target]) {
            if (selector == MilestoneEscrow.createDeal.selector) {
                (address payee,, address dealToken,,) =
                    abi.decode(_args(data), (address, address, address, uint256[], string));
                if (!allowedRecipient[payee]) revert RecipientNotAllowed(payee);
                if (dealToken != address(token)) revert WrongToken();
            } else if (selector != MilestoneEscrow.fund.selector && selector != MilestoneEscrow.dispute.selector) {
                revert InvalidProposal();
            }
        } else {
            revert InvalidProposal();
        }
    }

    function _args(bytes memory data) private pure returns (bytes memory args) {
        args = new bytes(data.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = data[i + 4];
        }
    }

    function _openProposal(uint256 id) private view returns (Proposal storage p) {
        if (id >= _proposals.length) revert InvalidProposal();
        p = _proposals[id];
        if (p.executed || p.cancelled) revert ProposalClosed();
        if (block.timestamp > p.expiresAt) revert ProposalExpired();
        if (p.approverEpoch != approverEpoch) revert ProposalStale();
    }

    function _executeProposal(Proposal storage p) private {
        if (p.kind == Kind.Transfer) {
            // Re-check: the allowlist may have changed since the proposal was created.
            if (!allowedRecipient[p.target]) revert RecipientNotAllowed(p.target);
            token.safeTransfer(p.target, p.amount);
        } else if (p.kind == Kind.ReleaseMilestone) {
            _checkRelease(p.target, p.amount, p.index);
            MilestoneEscrow(p.target).release(p.amount, p.index);
        } else {
            _checkCall(p.target, p.data);
            Address.functionCall(p.target, p.data);
        }
    }
}
