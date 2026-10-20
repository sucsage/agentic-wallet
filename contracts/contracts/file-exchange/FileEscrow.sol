// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FileEscrow
/// @notice Fair exchange of work (optionally a file) for a token payment between two people who
///         do not trust each other. Either side may make the offer; the other side accepts it.
///
///         The buyer's payment is locked before any work is shown, and a file's decryption key is
///         only published after the buyer approves the work, in exchange for the payment. Neither
///         side can walk away holding both halves.
///
///         Deal:
///           Proposed --accept--> Active         the counterparty agrees; the buyer's funds are locked
///           Proposed --cancel--> Cancelled      creator only; a buyer's up-front funds are returned
///
///         Milestone (in an Active deal):
///           Pending     --deliver-->    Delivered    seller anchors the work hash + encrypted file/preview URI
///           Delivered   --approve-->    Approved     buyer accepts the work (file milestone)
///           Delivered   --approve-->    Released     buyer accepts the work (no file: paid at once)
///           Approved    --releaseKey--> KeyReleased  seller publishes the key, encrypted to the buyer
///           KeyReleased --approve-->    Released     buyer confirms the key opens the file: paid at once
///           KeyReleased --claim-->      Released     after the challenge window, the seller is paid
///
///         Every window lasts `reviewPeriod`, agreed in the offer. When a window passes:
///           Delivered, buyer silent         -> seller may releaseKey (file) or claim (no file)
///           Approved, seller withholds key  -> buyer may reclaim the payment
///           KeyReleased, no challenge       -> seller may claim the payment
///         Inside a review or challenge window the buyer may dispute; a neutral arbiter settles it,
///         to one side (resolve) or split by share of the work delivered (resolveSplit).
contract FileEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum DealStatus {
        Proposed,
        Active,
        Cancelled
    }

    enum Status {
        Pending,
        Delivered,
        Approved,
        KeyReleased,
        Released,
        Disputed,
        Refunded,
        /// @dev Settled by the arbiter in two parts: see splitOf.
        Split
    }

    /// @notice One milestone as written in an offer.
    struct MilestoneTerms {
        uint256 amount;
        bool hasFile;
        /// @dev A seller selling a file it already has may commit to it up front; 0 = not known yet.
        bytes32 workHash;
    }

    struct Deal {
        address buyer;
        address seller;
        address arbiter;
        address creator;
        IERC20 token;
        uint256 total;
        uint256 milestoneCount;
        uint64 reviewPeriod;
        DealStatus status;
        string termsURI;
    }

    struct Milestone {
        uint256 amount;
        bool hasFile;
        Status status;
        /// @dev End of the window the milestone is currently in; its meaning follows `status`.
        uint64 deadline;
        /// @dev Hash committed in the offer; a delivery must match it. 0 = none committed.
        bytes32 agreedWorkHash;
        /// @dev Hash of the delivered work: the plaintext file, or the evidence of a no-file milestone.
        bytes32 workHash;
        /// @dev Where the encrypted file and its preview (or the evidence) can be fetched.
        string deliveryURI;
        /// @dev The file's decryption key, encrypted to the buyer.
        bytes encryptedKey;
    }

    /// @notice Shortest review window an offer may set, so a window cannot lapse before anyone can react.
    uint64 public constant MIN_REVIEW_PERIOD = 1 hours;
    /// @notice A split is written in basis points of the milestone paid to the seller.
    uint16 public constant BPS = 10_000;

    /// @notice The first deal number of this escrow; lower numbers belong to the one it replaced.
    uint256 public immutable FIRST_DEAL_ID;
    uint256 public dealCount;
    mapping(uint256 => Deal) private _deals;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(address => uint256[]) private _dealsOf;
    /// @dev What the seller received from a Split milestone; the buyer got the rest.
    mapping(uint256 => mapping(uint256 => uint256)) private _splitToSeller;
    /// @dev When the buyer opened the dispute; starts the arbiter's window (DC-M-01).
    mapping(uint256 => mapping(uint256 => uint64)) private _disputedAt;
    /// @notice How long the arbiter has to rule before anyone may return the money to the buyer.
    uint64 public constant ARBITER_WINDOW = 7 days;

    event OfferCreated(
        uint256 indexed dealId, address indexed buyer, address indexed seller, address creator, uint256 total, string termsURI
    );
    event OfferAccepted(uint256 indexed dealId);
    event OfferCancelled(uint256 indexed dealId);
    event Delivered(uint256 indexed dealId, uint256 indexed index, bytes32 workHash, string deliveryURI);
    event Approved(uint256 indexed dealId, uint256 indexed index);
    event KeyReleased(uint256 indexed dealId, uint256 indexed index, bytes encryptedKey);
    event Disputed(uint256 indexed dealId, uint256 indexed index);
    event Released(uint256 indexed dealId, uint256 indexed index, uint256 amount);
    event Refunded(uint256 indexed dealId, uint256 indexed index, uint256 amount);
    event ArbiterTimedOut(uint256 indexed dealId, uint256 indexed index, address indexed caller);
    event SplitResolved(uint256 indexed dealId, uint256 indexed index, uint256 toSeller, uint256 toBuyer);

    error InvalidOffer();
    error ArbiterNotNeutral();
    error InvalidIndex();
    error NotAllowed();
    error WrongDealStatus(DealStatus current);
    error WrongStatus(Status current);
    error InvalidDelivery();
    error WorkMismatch();
    error NoFile();
    error WindowOpen();
    error WindowClosed();
    error InvalidSplit();

    /// @param firstDealId Where deal numbers start. A replacement escrow continues the old one's
    ///        numbering, so a deal id names one deal across both contracts.
    constructor(uint256 firstDealId) {
        FIRST_DEAL_ID = firstDealId;
        dealCount = firstDealId;
    }

    // ----------------------------------------------------------------------------------------
    // Offers
    // ----------------------------------------------------------------------------------------

    /// @notice Buyer offers to pay for work. The payment is locked now, so the seller knows it exists.
    function offerToBuy(
        address seller,
        address arbiter,
        IERC20 token,
        MilestoneTerms[] calldata terms,
        uint64 reviewPeriod,
        string calldata termsURI
    ) external nonReentrant returns (uint256 dealId) {
        dealId = _create(msg.sender, seller, arbiter, token, terms, reviewPeriod, termsURI);
        token.safeTransferFrom(msg.sender, address(this), _deals[dealId].total);
    }

    /// @notice Seller offers work or a ready-made file. Nothing is locked until the buyer accepts.
    function offerToSell(
        address buyer,
        address arbiter,
        IERC20 token,
        MilestoneTerms[] calldata terms,
        uint64 reviewPeriod,
        string calldata termsURI
    ) external returns (uint256 dealId) {
        dealId = _create(buyer, msg.sender, arbiter, token, terms, reviewPeriod, termsURI);
    }

    /// @notice The counterparty agrees to the offer as written. A buyer accepting pays in now.
    function accept(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (d.status != DealStatus.Proposed) revert WrongDealStatus(d.status);
        address counterparty = d.creator == d.buyer ? d.seller : d.buyer;
        if (msg.sender != counterparty) revert NotAllowed();

        d.status = DealStatus.Active;
        if (msg.sender == d.buyer) d.token.safeTransferFrom(d.buyer, address(this), d.total);
        emit OfferAccepted(dealId);
    }

    /// @notice The creator withdraws an offer nobody has accepted yet.
    function cancel(uint256 dealId) external nonReentrant {
        Deal storage d = _deal(dealId);
        if (msg.sender != d.creator) revert NotAllowed();
        if (d.status != DealStatus.Proposed) revert WrongDealStatus(d.status);

        d.status = DealStatus.Cancelled;
        if (d.creator == d.buyer) d.token.safeTransfer(d.buyer, d.total);
        emit OfferCancelled(dealId);
    }

    // ----------------------------------------------------------------------------------------
    // Seller
    // ----------------------------------------------------------------------------------------

    /// @notice Anchors the work. For a file, `deliveryURI` points at the encrypted file and a preview,
    ///         so the buyer can judge it without receiving it. Can be redone until the buyer approves.
    function deliver(uint256 dealId, uint256 index, bytes32 workHash, string calldata deliveryURI) external {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.seller) revert NotAllowed();
        if (m.status != Status.Pending && m.status != Status.Delivered) revert WrongStatus(m.status);
        if (workHash == bytes32(0)) revert InvalidDelivery();
        if (m.agreedWorkHash != bytes32(0) && workHash != m.agreedWorkHash) revert WorkMismatch();

        m.status = Status.Delivered;
        m.workHash = workHash;
        m.deliveryURI = deliveryURI;
        m.deadline = _windowEnd(d);
        emit Delivered(dealId, index, workHash, deliveryURI);
    }

    /// @notice Hands over the file by publishing its key, encrypted to the buyer. Allowed once the
    ///         buyer approved, or once the buyer let the review window pass in silence.
    function releaseKey(uint256 dealId, uint256 index, bytes calldata encryptedKey) external {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.seller) revert NotAllowed();
        if (!m.hasFile) revert NoFile();
        if (encryptedKey.length == 0) revert InvalidDelivery();
        if (m.status == Status.Approved) {
            if (block.timestamp > m.deadline) revert WindowClosed();
        } else if (m.status == Status.Delivered) {
            if (block.timestamp <= m.deadline) revert WindowOpen();
        } else {
            revert WrongStatus(m.status);
        }

        m.status = Status.KeyReleased;
        m.encryptedKey = encryptedKey;
        m.deadline = _windowEnd(d);
        emit KeyReleased(dealId, index, encryptedKey);
    }

    /// @notice Collects the payment once the buyer can no longer object: the key went unchallenged,
    ///         or (no file) the buyer let the review window pass.
    function claim(uint256 dealId, uint256 index) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.seller) revert NotAllowed();
        bool keyUnchallenged = m.status == Status.KeyReleased;
        bool noFileUnanswered = m.status == Status.Delivered && !m.hasFile;
        if (!keyUnchallenged && !noFileUnanswered) revert WrongStatus(m.status);
        if (block.timestamp <= m.deadline) revert WindowOpen();

        _payOut(dealId, index, d, m);
    }

    /// @notice Gives a milestone's payment back to the buyer at any point before it is settled.
    /// @dev Allowed only while the escrow still holds the money. A list of the settled states would
    ///      miss any status added later (Split was, DC-H-02: a split milestone was refunded a second time
    ///      out of other deals' funds), so the states that hold money are listed instead.
    function refund(uint256 dealId, uint256 index) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.seller) revert NotAllowed();
        Status s = m.status;
        if (
            s != Status.Pending && s != Status.Delivered && s != Status.Approved && s != Status.KeyReleased
                && s != Status.Disputed
        ) revert WrongStatus(s);

        _payBack(dealId, index, d, m);
    }

    // ----------------------------------------------------------------------------------------
    // Buyer
    // ----------------------------------------------------------------------------------------

    /// @notice Accepts the delivered work after checking its preview and verification report.
    ///         A no-file milestone is paid at once; a file milestone now waits for the seller's key.
    ///         Once the key is out, approving again confirms it opens the file and pays the seller
    ///         without waiting out the challenge window.
    function approve(uint256 dealId, uint256 index) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.buyer) revert NotAllowed();
        if (m.status == Status.KeyReleased) return _payOut(dealId, index, d, m);
        if (m.status != Status.Delivered) revert WrongStatus(m.status);

        if (!m.hasFile) {
            _payOut(dealId, index, d, m);
        } else {
            m.status = Status.Approved;
            m.deadline = _windowEnd(d);
            emit Approved(dealId, index);
        }
    }

    /// @notice Objects inside a window: to the work itself (Delivered) or to a key that does not open
    ///         the file matching `workHash` (KeyReleased). The arbiter decides.
    function dispute(uint256 dealId, uint256 index) external {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.buyer) revert NotAllowed();
        if (m.status != Status.Delivered && m.status != Status.KeyReleased) revert WrongStatus(m.status);
        if (block.timestamp > m.deadline) revert WindowClosed();

        m.status = Status.Disputed;
        _disputedAt[dealId][index] = uint64(block.timestamp);
        emit Disputed(dealId, index);
    }

    /// @notice Takes the payment back when the seller did not hand over the key after approval.
    function reclaim(uint256 dealId, uint256 index) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.buyer) revert NotAllowed();
        if (m.status != Status.Approved) revert WrongStatus(m.status);
        if (block.timestamp <= m.deadline) revert WindowOpen();

        _payBack(dealId, index, d, m);
    }

    // ----------------------------------------------------------------------------------------
    // Arbiter
    // ----------------------------------------------------------------------------------------

    /// @notice Settles a disputed milestone to either side.
    function resolve(uint256 dealId, uint256 index, bool toSeller) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.arbiter) revert NotAllowed();
        if (m.status != Status.Disputed) revert WrongStatus(m.status);

        if (toSeller) _payOut(dealId, index, d, m);
        else _payBack(dealId, index, d, m);
    }

    /// @notice Settles a disputed milestone by sharing it: `sellerBps` / 10,000 of the amount to the
    ///         seller (for the part of the work delivered), the rest back to the buyer. 10,000 and 0
    ///         are the same as resolve(true) and resolve(false).
    function resolveSplit(uint256 dealId, uint256 index, uint16 sellerBps) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (msg.sender != d.arbiter) revert NotAllowed();
        if (m.status != Status.Disputed) revert WrongStatus(m.status);
        if (sellerBps > BPS) revert InvalidSplit();

        if (sellerBps == BPS) return _payOut(dealId, index, d, m);
        if (sellerBps == 0) return _payBack(dealId, index, d, m);

        uint256 toSeller = (m.amount * sellerBps) / BPS;
        uint256 toBuyer = m.amount - toSeller;
        m.status = Status.Split;
        _splitToSeller[dealId][index] = toSeller;
        d.token.safeTransfer(d.seller, toSeller);
        d.token.safeTransfer(d.buyer, toBuyer);
        emit SplitResolved(dealId, index, toSeller, toBuyer);
    }

    /// @notice Last resort when the arbiter stays silent: after ARBITER_WINDOW anyone may return a
    ///         disputed milestone's money to the buyer (DC-M-01). The outcome is fixed here, not chosen
    ///         by the caller: the money came from the buyer and nobody has confirmed the work. Before
    ///         the window ends only the arbiter (or the seller's own refund) can settle it.
    function timeoutResolve(uint256 dealId, uint256 index) external nonReentrant {
        (Deal storage d, Milestone storage m) = _active(dealId, index);
        if (m.status != Status.Disputed) revert WrongStatus(m.status);
        if (block.timestamp < uint256(_disputedAt[dealId][index]) + ARBITER_WINDOW) revert WindowOpen();

        emit ArbiterTimedOut(dealId, index, msg.sender);
        _payBack(dealId, index, d, m);
    }

    // ----------------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------------

    /// @notice When the dispute on a milestone was opened; 0 if it never was.
    function disputedAt(uint256 dealId, uint256 index) external view returns (uint64) {
        return _disputedAt[dealId][index];
    }

    /// @notice How a Split milestone was paid out; (0, 0) for any other status.
    function splitOf(uint256 dealId, uint256 index) external view returns (uint256 toSeller, uint256 toBuyer) {
        Milestone storage m = _milestones[dealId][index];
        if (m.status != Status.Split) return (0, 0);
        toSeller = _splitToSeller[dealId][index];
        toBuyer = m.amount - toSeller;
    }

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _deal(dealId);
    }

    function getMilestone(uint256 dealId, uint256 index) external view returns (Milestone memory) {
        if (index >= _deal(dealId).milestoneCount) revert InvalidIndex();
        return _milestones[dealId][index];
    }

    /// @notice Every deal an account is a party to, as buyer or seller.
    function dealsOf(address account) external view returns (uint256[] memory) {
        return _dealsOf[account];
    }

    // ----------------------------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------------------------

    function _create(
        address buyer,
        address seller,
        address arbiter,
        IERC20 token,
        MilestoneTerms[] calldata terms,
        uint64 reviewPeriod,
        string calldata termsURI
    ) private returns (uint256 dealId) {
        if (buyer == address(0) || seller == address(0) || buyer == seller) revert InvalidOffer();
        if (address(token) == address(0) || terms.length == 0 || reviewPeriod < MIN_REVIEW_PERIOD) revert InvalidOffer();
        // A party judging its own dispute could take back the money after receiving the work.
        if (arbiter == address(0) || arbiter == buyer || arbiter == seller) revert ArbiterNotNeutral();

        dealId = dealCount++;
        uint256 total;
        for (uint256 i = 0; i < terms.length; i++) {
            MilestoneTerms calldata t = terms[i];
            if (t.amount == 0) revert InvalidOffer();
            // Only a seller can commit to a file it already has.
            if (t.workHash != bytes32(0) && (!t.hasFile || msg.sender != seller)) revert InvalidOffer();
            Milestone storage m = _milestones[dealId][i];
            m.amount = t.amount;
            m.hasFile = t.hasFile;
            m.agreedWorkHash = t.workHash;
            total += t.amount;
        }

        Deal storage d = _deals[dealId];
        d.buyer = buyer;
        d.seller = seller;
        d.arbiter = arbiter;
        d.creator = msg.sender;
        d.token = token;
        d.total = total;
        d.milestoneCount = terms.length;
        d.reviewPeriod = reviewPeriod;
        d.termsURI = termsURI;

        _dealsOf[buyer].push(dealId);
        _dealsOf[seller].push(dealId);
        emit OfferCreated(dealId, buyer, seller, msg.sender, total, termsURI);
    }

    function _deal(uint256 dealId) private view returns (Deal storage) {
        if (dealId < FIRST_DEAL_ID || dealId >= dealCount) revert InvalidIndex();
        return _deals[dealId];
    }

    function _active(uint256 dealId, uint256 index) private view returns (Deal storage d, Milestone storage m) {
        d = _deal(dealId);
        if (d.status != DealStatus.Active) revert WrongDealStatus(d.status);
        if (index >= d.milestoneCount) revert InvalidIndex();
        m = _milestones[dealId][index];
    }

    function _windowEnd(Deal storage d) private view returns (uint64) {
        return uint64(block.timestamp) + d.reviewPeriod;
    }

    function _payOut(uint256 dealId, uint256 index, Deal storage d, Milestone storage m) private {
        m.status = Status.Released;
        d.token.safeTransfer(d.seller, m.amount);
        emit Released(dealId, index, m.amount);
    }

    function _payBack(uint256 dealId, uint256 index, Deal storage d, Milestone storage m) private {
        m.status = Status.Refunded;
        d.token.safeTransfer(d.buyer, m.amount);
        emit Refunded(dealId, index, m.amount);
    }
}
