// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MilestoneEscrow} from "./MilestoneEscrow.sol";
import {FileEscrow} from "./file-exchange/FileEscrow.sol";

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
        Call,
        SetupDeal,
        SetupFileDeal
    }

    /// @notice Full initial policy, so a wallet can be deployed ready to use in one transaction.
    struct Config {
        address owner;
        IERC20 token;
        address agent;
        uint64 sessionExpiresAt;
        uint256 maxPerTx;
        uint256 dailyLimit;
        address[] approvers;
        uint256 threshold;
        address[] recipients;
        address[] escrows;
    }

    struct Session {
        uint64 expiresAt; // 0 = no session
        uint256 maxPerTx;
        uint256 dailyLimit;
    }

    struct Proposal {
        Kind kind;
        address proposer;
        address target; // Transfer: recipient. Other kinds: contract.
        uint256 amount; // Transfer: token amount. ReleaseMilestone: dealId.
        uint256 index; // ReleaseMilestone: milestone index.
        bytes data; // Call: calldata. SetupDeal: escrow.createDeal calldata. SetupFileDeal: offerToBuy calldata.
        string reason;
        uint64 expiresAt;
        uint64 approverEpoch;
        uint32 approvals;
        bool executed;
        bool cancelled;
        /// @dev EIP-712 digest of the owner's signed mandate that ran it; 0 = approved the normal way.
        bytes32 mandateHash;
    }

    /// @notice An action the owner authorizes by signing it (EIP-712) instead of sending a transaction.
    ///         The signed fields cover everything that executes; `nonce` lets the owner sign the same
    ///         action twice on purpose. For a SetupFileDeal, `amount` is the total the offer locks,
    ///         so the wallet's signing prompt shows it in plain numbers. `reasonHash` keeps the
    ///         reason's text off-chain (PDPA): only its hash is signed and nothing is stored.
    struct Mandate {
        Kind kind;
        address target;
        uint256 amount;
        uint256 index;
        bytes data;
        bytes32 reasonHash;
        uint256 nonce;
        uint64 deadline;
    }

    uint64 public constant PROPOSAL_TTL = 3 days;

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(uint8 kind,address target,uint256 amount,uint256 index,bytes data,bytes32 reasonHash,uint256 nonce,uint64 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The only token the agent may spend (the settlement stablecoin).
    IERC20 public immutable token;
    uint256 public immutable createdAtBlock;

    bool public paused;

    mapping(address => Session) public sessions;
    mapping(address => mapping(uint256 => uint256)) public spentOnDay; // key => day => amount

    mapping(address => bool) public allowedRecipient;
    mapping(address => bool) public allowedEscrow;
    /// @dev Kept apart from `allowedEscrow`: FileEscrow returns differently shaped deals, so one
    ///      escrow kind's checks must never be applied to the other.
    mapping(address => bool) public allowedFileEscrow;

    mapping(address => bool) public isApprover;
    uint256 public approverCount;
    uint256 public threshold;
    /// @dev Bumped whenever the approver set or threshold changes; invalidates pending proposals.
    uint64 public approverEpoch;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    /// @notice Mandates already run or revoked, by EIP-712 digest: each signature works once.
    mapping(bytes32 => bool) public mandateUsed;

    event SessionSet(address indexed key, uint64 expiresAt, uint256 maxPerTx, uint256 dailyLimit);
    event SessionRevoked(address indexed key);
    event RecipientSet(address indexed recipient, bool allowed);
    event EscrowSet(address indexed escrow, bool allowed);
    event FileEscrowSet(address indexed escrow, bool allowed);
    event ApproverSet(address indexed approver, bool allowed);
    event ThresholdSet(uint256 threshold);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AgentTransfer(address indexed key, address indexed to, uint256 amount);
    event AgentMilestoneReleased(address indexed key, address indexed escrow, uint256 dealId, uint256 index, uint256 amount);
    event AgentFileApproved(address indexed key, address indexed escrow, uint256 dealId, uint256 index, uint256 amount);
    event ProposalCreated(uint256 indexed id, address indexed proposer, Kind kind, address target, uint256 amount, string reason);
    event ProposalApproved(uint256 indexed id, address indexed approver, uint256 approvals);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id, address indexed by);
    event OwnerExecuted(address indexed target, uint256 value, bytes data);
    event MandateExecuted(bytes32 indexed digest, uint256 indexed id);
    event MandateRevoked(bytes32 indexed digest);

    error WalletPaused();
    error NotAgent();
    error NotApprover();
    error NotAuthorized();
    error RecipientNotAllowed(address recipient);
    error EscrowNotAllowed(address escrow);
    error FileEscrowNotAllowed(address escrow);
    error ArbiterNotNeutral(address arbiter);
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
    error NotSellerOfDeal();
    error InvalidMandate();
    error MandateExpired();
    error MandateAlreadyUsed();

    constructor(Config memory c) Ownable(c.owner) {
        token = c.token;
        createdAtBlock = block.number;
        if (c.agent != address(0)) _setSession(c.agent, c.sessionExpiresAt, c.maxPerTx, c.dailyLimit);
        for (uint256 i = 0; i < c.approvers.length; i++) {
            _setApprover(c.approvers[i], true);
        }
        if (c.threshold != 0) _setThreshold(c.threshold);
        for (uint256 i = 0; i < c.recipients.length; i++) {
            _setRecipient(c.recipients[i], true);
        }
        for (uint256 i = 0; i < c.escrows.length; i++) {
            _setEscrow(c.escrows[i], true);
        }
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
        _setSession(key, expiresAt, maxPerTx, dailyLimit);
    }

    function revokeSession(address key) external onlyOwner {
        delete sessions[key];
        emit SessionRevoked(key);
    }

    function setRecipient(address recipient, bool allowed) external onlyOwner {
        _setRecipient(recipient, allowed);
    }

    function setEscrow(address escrow, bool allowed) external onlyOwner {
        _setEscrow(escrow, allowed);
    }

    function setFileEscrow(address escrow, bool allowed) external onlyOwner {
        allowedFileEscrow[escrow] = allowed;
        emit FileEscrowSet(escrow, allowed);
    }

    function setApprover(address approver, bool allowed) external onlyOwner {
        _setApprover(approver, allowed);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        _setThreshold(newThreshold);
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

    /// @notice Approves delivered work on a FileEscrow deal the wallet is buying. The milestone's
    ///         amount counts against the agent's caps now, because approving is what commits it to
    ///         the seller (paid at once without a file, or once the key goes unchallenged).
    function agentApproveFile(address escrow, uint256 dealId, uint256 index)
        external
        onlyAgent
        whenNotPaused
        nonReentrant
    {
        uint256 amount = _checkFileRelease(escrow, dealId, index);
        _spend(msg.sender, amount);
        FileEscrow(escrow).approve(dealId, index);
        emit AgentFileApproved(msg.sender, escrow, dealId, index, amount);
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
        id = _record(kind, target, amount, index, data, reason, bytes32(0));
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
    // Owner mandates (EIP-712): approve by signature, no transaction from the owner
    // ----------------------------------------------------------------------------------------

    /// @notice Runs an action the owner signed off-chain, in one transaction anyone may send (the
    ///         agent, typically). It passes the same checks as any proposal and is recorded as one,
    ///         with its digest in `mandateHash`. It needs no approver votes: the owner can already do
    ///         anything through `execute`, and a mandate is narrower than that.
    function executeMandate(Mandate calldata m, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (block.timestamp > m.deadline) revert MandateExpired();
        bytes32 digest = mandateDigest(m);
        if (mandateUsed[digest]) revert MandateAlreadyUsed();
        // Checked against the CURRENT owner: a mandate signed by a previous owner is void.
        if (!SignatureChecker.isValidSignatureNow(owner(), digest, signature)) revert InvalidMandate();
        mandateUsed[digest] = true;

        _checkProposal(m.kind, m.target, m.amount, m.index, m.data);
        id = _record(m.kind, m.target, m.amount, m.index, m.data, "", digest);
        Proposal storage p = _proposals[id];
        p.executed = true;
        _executeProposal(p);
        emit MandateExecuted(digest, id);
        emit ProposalExecuted(id);
    }

    /// @notice Voids a mandate the owner signed but no longer wants run (e.g. the signature leaked).
    function revokeMandate(bytes32 digest) external onlyOwner {
        mandateUsed[digest] = true;
        emit MandateRevoked(digest);
    }

    /// @notice The EIP-712 digest the owner signs for `m`, bound to this wallet and chain.
    function mandateDigest(Mandate calldata m) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("AgentWallet"), keccak256("1"), block.chainid, address(this))
        );
        bytes32 structHash = keccak256(
            abi.encode(
                MANDATE_TYPEHASH,
                m.kind,
                m.target,
                m.amount,
                m.index,
                keccak256(m.data),
                m.reasonHash,
                m.nonce,
                m.deadline
            )
        );
        return MessageHashUtils.toTypedDataHash(domain, structHash);
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

    function _setSession(address key, uint64 expiresAt, uint256 maxPerTx, uint256 dailyLimit) private {
        if (key == address(0) || expiresAt <= block.timestamp || maxPerTx > dailyLimit) revert InvalidSession();
        sessions[key] = Session(expiresAt, maxPerTx, dailyLimit);
        emit SessionSet(key, expiresAt, maxPerTx, dailyLimit);
    }

    function _setRecipient(address recipient, bool allowed) private {
        allowedRecipient[recipient] = allowed;
        emit RecipientSet(recipient, allowed);
    }

    function _setEscrow(address escrow, bool allowed) private {
        allowedEscrow[escrow] = allowed;
        emit EscrowSet(escrow, allowed);
    }

    function _setApprover(address approver, bool allowed) private {
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

    function _setThreshold(uint256 newThreshold) private {
        if (newThreshold == 0 || newThreshold > approverCount) revert InvalidThreshold();
        threshold = newThreshold;
        approverEpoch++;
        emit ThresholdSet(newThreshold);
    }

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
        } else if (kind == Kind.Call) {
            if (amount != 0 || index != 0) revert InvalidProposal();
            _checkCall(target, data);
        } else if (kind == Kind.SetupDeal) {
            if (amount != 0 || index != 0) revert InvalidProposal();
            _decodeSetupDeal(target, data);
        } else {
            // `amount` must state the total the offer locks, so approvers and signers see it.
            if (amount != _decodeFileOffer(target, data) || index != 0) revert InvalidProposal();
        }
    }

    /// @dev SetupFileDeal = approve + FileEscrow.offerToBuy in one human-approved step, so the
    ///      payment is locked the moment the offer is made. The seller must be allowlisted, the deal
    ///      must settle in the wallet's token and the arbiter must not be on the buyer's side.
    ///      Returns the total the offer locks.
    function _decodeFileOffer(address escrow, bytes memory data) private view returns (uint256 total) {
        if (!allowedFileEscrow[escrow]) revert FileEscrowNotAllowed(escrow);
        if (data.length < 4 || bytes4(data) != FileEscrow.offerToBuy.selector) revert InvalidProposal();
        (address seller, address arbiter, address dealToken, FileEscrow.MilestoneTerms[] memory terms,,) =
            abi.decode(_args(data), (address, address, address, FileEscrow.MilestoneTerms[], uint64, string));
        if (!allowedRecipient[seller]) revert RecipientNotAllowed(seller);
        if (dealToken != address(token)) revert WrongToken();
        _checkArbiter(arbiter);
        for (uint256 i = 0; i < terms.length; i++) {
            total += terms[i].amount;
        }
    }

    /// @dev SetupDeal = approve + createDeal + fund in one human-approved step. The payee must be
    ///      allowlisted and the deal must settle in the wallet's token. Returns the decoded call.
    function _decodeSetupDeal(address escrow, bytes memory data)
        private
        view
        returns (address payee, address arbiter, uint256[] memory amounts, string memory termsURI, uint256 total)
    {
        if (!allowedEscrow[escrow]) revert EscrowNotAllowed(escrow);
        if (data.length < 4 || bytes4(data) != MilestoneEscrow.createDeal.selector) revert InvalidProposal();
        address dealToken;
        (payee, arbiter, dealToken, amounts, termsURI) =
            abi.decode(_args(data), (address, address, address, uint256[], string));
        if (!allowedRecipient[payee]) revert RecipientNotAllowed(payee);
        if (dealToken != address(token)) revert WrongToken();
        _checkArbiter(arbiter);
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
    }

    /// @dev Generic calls are limited to setting up escrow deals: token.approve(escrow, x),
    ///      escrow.createDeal(allowlisted payee, ...), escrow.fund(id) and escrow.dispute(id, i),
    ///      plus the buyer's side of a FileEscrow deal (see `_checkFileCall`).
    ///      Anything that moves funds out (transfer, release) must use its dedicated, checked path.
    function _checkCall(address target, bytes memory data) private view {
        if (data.length < 4) revert InvalidProposal();
        bytes4 selector = bytes4(data);
        if (target == address(token)) {
            if (selector != IERC20.approve.selector || data.length != 68) revert InvalidProposal();
            (address spender,) = abi.decode(_args(data), (address, uint256));
            if (!allowedEscrow[spender] && !allowedFileEscrow[spender]) revert EscrowNotAllowed(spender);
        } else if (allowedFileEscrow[target]) {
            _checkFileCall(target, data);
        } else if (allowedEscrow[target]) {
            if (selector == MilestoneEscrow.createDeal.selector) {
                (address payee, address arbiter, address dealToken,,) =
                    abi.decode(_args(data), (address, address, address, uint256[], string));
                if (!allowedRecipient[payee]) revert RecipientNotAllowed(payee);
                if (dealToken != address(token)) revert WrongToken();
                _checkArbiter(arbiter);
            } else if (selector != MilestoneEscrow.fund.selector && selector != MilestoneEscrow.dispute.selector) {
                revert InvalidProposal();
            }
        } else {
            revert InvalidProposal();
        }
    }

    /// @dev The buyer's moves on a FileEscrow deal this wallet is the buyer of: accept, approve,
    ///      dispute, reclaim, cancel. accept locks the wallet's money and approve releases it, so
    ///      both get the same seller/token checks as every other payment path; accept also agrees
    ///      to the arbiter, so it must be neutral. The rest can only return money or stop a deal.
    function _checkFileCall(address escrow, bytes memory data) private view {
        bytes4 selector = bytes4(data);
        if (selector == FileEscrow.offerToSell.selector) {
            // Selling locks nothing here; the deal must pay in this wallet's token, under a neutral arbiter.
            (, address arbiter, address dealToken) = abi.decode(_args(data), (address, address, address));
            if (dealToken != address(token)) revert WrongToken();
            return _checkArbiter(arbiter);
        }
        if (_isSellerCall(escrow, selector, data)) return _checkSellerCall(escrow, selector, data);
        bool locksOrPays = selector == FileEscrow.accept.selector || selector == FileEscrow.approve.selector;
        bool dealOnly = selector == FileEscrow.accept.selector || selector == FileEscrow.cancel.selector;
        bool dealAndIndex = selector == FileEscrow.approve.selector || selector == FileEscrow.dispute.selector
            || selector == FileEscrow.reclaim.selector;
        if (!(dealOnly && data.length == 36) && !(dealAndIndex && data.length == 68)) revert InvalidProposal();

        FileEscrow.Deal memory d = _buyerDeal(escrow, abi.decode(_args(data), (uint256)), locksOrPays);
        if (selector == FileEscrow.accept.selector) _checkArbiter(d.arbiter);
    }

    /// @dev The seller's moves when this wallet sells: deliver, releaseKey, claim, refund, and
    ///      accepting a buyer's offer (accept is the buyer's move when the seller made the offer).
    function _isSellerCall(address escrow, bytes4 selector, bytes memory data) private view returns (bool) {
        if (
            selector == FileEscrow.deliver.selector || selector == FileEscrow.releaseKey.selector
                || selector == FileEscrow.claim.selector || selector == FileEscrow.refund.selector
        ) return true;
        bool cancel = selector == FileEscrow.cancel.selector;
        if ((!cancel && selector != FileEscrow.accept.selector) || data.length != 36) return false;
        FileEscrow.Deal memory d = FileEscrow(escrow).getDeal(abi.decode(_args(data), (uint256)));
        // accept: a buyer's offer to this wallet. cancel: withdrawing this wallet's own offer to sell.
        return d.seller == address(this) && d.creator == (cancel ? address(this) : d.buyer);
    }

    /// @dev None of the seller's moves can take money out of this wallet: accepting a buyer's offer
    ///      locks the buyer's money, claim pays this wallet, refund returns escrowed money to the
    ///      buyer. They still need the wallet to be the seller, its own token (so payouts are always
    ///      money it can account for) and, for accept, a neutral arbiter.
    function _checkSellerCall(address escrow, bytes4 selector, bytes memory data) private view {
        FileEscrow.Deal memory d = FileEscrow(escrow).getDeal(abi.decode(_args(data), (uint256)));
        if (d.seller != address(this)) revert NotSellerOfDeal();
        if (address(d.token) != address(token)) revert WrongToken();
        if (selector == FileEscrow.accept.selector) {
            _checkArbiter(d.arbiter);
        } else if (selector == FileEscrow.claim.selector || selector == FileEscrow.refund.selector) {
            if (data.length != 68) revert InvalidProposal();
        }
        // deliver and releaseKey carry a hash / key and a URI; FileEscrow validates those itself.
    }

    /// @dev Validates an approval the agent makes on its own: an allowlisted FileEscrow, a deal this
    ///      wallet buys in its own token from an allowlisted seller. Returns the milestone amount.
    function _checkFileRelease(address escrow, uint256 dealId, uint256 index) private view returns (uint256) {
        if (!allowedFileEscrow[escrow]) revert FileEscrowNotAllowed(escrow);
        _buyerDeal(escrow, dealId, true);
        return FileEscrow(escrow).getMilestone(dealId, index).amount;
    }

    /// @dev Loads a FileEscrow deal this wallet is the buyer of. `paying` = the action locks or
    ///      releases the wallet's money, so the token must be the wallet's and the seller allowlisted.
    function _buyerDeal(address escrow, uint256 dealId, bool paying) private view returns (FileEscrow.Deal memory d) {
        d = FileEscrow(escrow).getDeal(dealId);
        if (d.buyer != address(this)) revert NotPayerOfDeal();
        if (paying) {
            if (address(d.token) != address(token)) revert WrongToken();
            if (!allowedRecipient[d.seller]) revert RecipientNotAllowed(d.seller);
        }
    }

    /// @dev The escrow only sees this contract as the payer; the keys that control it (owner,
    ///      approvers, agent) are the buyer's side too and must not judge the buyer's disputes.
    function _checkArbiter(address arbiter) private view {
        if (
            arbiter == address(this) || arbiter == owner() || isApprover[arbiter] || sessions[arbiter].expiresAt != 0
        ) revert ArbiterNotNeutral(arbiter);
    }

    function _args(bytes memory data) private pure returns (bytes memory args) {
        args = new bytes(data.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = data[i + 4];
        }
    }

    function _record(
        Kind kind,
        address target,
        uint256 amount,
        uint256 index,
        bytes calldata data,
        string memory reason,
        bytes32 mandateHash
    ) private returns (uint256 id) {
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
                cancelled: false,
                mandateHash: mandateHash
            })
        );
        emit ProposalCreated(id, msg.sender, kind, target, amount, reason);
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
        } else if (p.kind == Kind.Call) {
            _checkCall(p.target, p.data);
            Address.functionCall(p.target, p.data);
        } else if (p.kind == Kind.SetupDeal) {
            (address payee, address arbiter, uint256[] memory amounts, string memory termsURI, uint256 total) =
                _decodeSetupDeal(p.target, p.data);
            MilestoneEscrow escrow = MilestoneEscrow(p.target);
            token.forceApprove(address(escrow), total);
            uint256 dealId = escrow.createDeal(payee, arbiter, token, amounts, termsURI);
            escrow.fund(dealId);
        } else {
            // Re-check: the allowlists may have changed since the proposal was created.
            uint256 total = _decodeFileOffer(p.target, p.data);
            token.forceApprove(p.target, total);
            Address.functionCall(p.target, p.data);
            // offerToBuy pulls exactly `total`; clear any leftover so nothing stays approved.
            token.forceApprove(p.target, 0);
        }
    }
}
