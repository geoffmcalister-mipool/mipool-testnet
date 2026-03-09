// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MITToken.sol";
import "./DeedNFT.sol";
import "./PledgeVault.sol";
import "./WADE.sol";

/**
 * @title PoolContract
 * @notice Core contract representing a single MiPool mortgage investment pool.
 *         Deployed by the PoolFactory for each new pool.
 *
 * Lifecycle:
 *   CREATED → PENDING_ACTIVATION (after Bank creates)
 *   PENDING_ACTIVATION → ACTIVE (after Issuance Partner activates)
 *   ACTIVE → REPAID (after Period 12 repayment confirmed)
 *
 * On-chain actions per the MiPool spec (22 total):
 *   Flow 1: Create Pool (2)
 *   Flow 2: Activate Pool, Mint Deed-NFT, Deposit Deed-NFT, Mint MIT (4)
 *   Flow 3: Buy MIT ×2 investors (2)
 *   Flow 4: Repay ×12 → per period: Repay + Distribute + Burn (36) + Pool Repaid + Release Deed (2) = 38
 */
contract PoolContract is AccessControl, ReentrancyGuard {
    bytes32 public constant BANK_ROLE        = keccak256("BANK_ROLE");
    bytes32 public constant ISSUANCE_ROLE    = keccak256("ISSUANCE_ROLE");
    bytes32 public constant INVESTOR_ROLE    = keccak256("INVESTOR_ROLE");

    // ─── Pool Status ─────────────────────────────────────────────────────────
    enum PoolStatus { PENDING_ACTIVATION, ACTIVE, REPAID, DEFAULTED }

    // ─── Pool Parameters (set at creation, immutable after) ──────────────────
    struct PoolParams {
        string  poolName;           // e.g. "MIT-001"
        uint256 principalAmount;    // USDC (6 decimals)
        uint256 interestRateBps;    // Annual rate in basis points (500 = 5.00%)
        uint256 termMonths;         // Loan term (e.g. 12)
        uint256 collateralValue;    // USDC (6 decimals)
        uint256 ltvBasisPoints;     // Initial LTV bp (6667 = 66.67%)
        uint256 protocolFeeBps;     // Protocol fee bp of principal/month (20 = 0.20%)
        uint256 createdAt;
        address bankAddress;
    }

    // ─── Amortisation Schedule ────────────────────────────────────────────────
    struct Period {
        uint256 dueDate;            // Unix timestamp
        uint256 principal;          // USDC base units
        uint256 interest;           // USDC base units
        uint256 protocolFee;        // USDC base units
        uint256 totalPayment;       // principal + interest + protocolFee
        uint256 mitToBurn;          // MIT tokens burned this period (= principal)
        bool    paid;
    }

    // ─── State ────────────────────────────────────────────────────────────────
    PoolParams public params;
    PoolStatus public status;
    Period[]   public schedule;

    IERC20      public immutable usdc;
    MITToken    public mitToken;
    DeedNFT     public deedNFT;
    PledgeVault public pledgeVault;
    WADE        public wade;

    uint256 public deedTokenId;
    uint256 public mitSupply;           // total MIT minted
    uint256 public mitSold;             // MIT sold to investors
    uint256 public outstandingPrincipal;
    uint256 public currentPeriod;       // 0 = not started, 1..termMonths
    uint256 public activatedAt;
    address public admin;

    // Supporting documents (IPFS CIDs or S3 keys, stored off-chain; references stored here)
    string[] public documentCIDs;

    // ─── Events ──────────────────────────────────────────────────────────────
    event PoolCreated(address indexed poolContract, string poolName, address indexed bank, uint256 principalAmount);
    event PoolActivated(address indexed mitToken, address indexed deedNFT, uint256 mitMinted, uint256 deedTokenId);
    event MITBought(address indexed investor, uint256 mitAmount, uint256 usdcPaid);
    event Repayment(uint256 indexed period, uint256 totalPaid, uint256 mitBurned, uint256 remainingPrincipal);
    event PoolRepaid(uint256 timestamp);
    event DeedReleased(address indexed bank, uint256 tokenId);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address _usdc,
        address _bank,
        address _issuancePartner,
        address _admin,
        string memory _poolName,
        uint256 _principalAmount,
        uint256 _interestRateBps,
        uint256 _termMonths,
        uint256 _collateralValue,
        uint256 _protocolFeeBps,
        string[] memory _documentCIDs
    ) {
        usdc = IERC20(_usdc);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        admin = _admin;
        _grantRole(BANK_ROLE, _bank);
        _grantRole(ISSUANCE_ROLE, _issuancePartner);

        // Compute LTV
        uint256 ltvBps = (_principalAmount * 10000) / _collateralValue;

        params = PoolParams({
            poolName:          _poolName,
            principalAmount:   _principalAmount,
            interestRateBps:   _interestRateBps,
            termMonths:        _termMonths,
            collateralValue:   _collateralValue,
            ltvBasisPoints:    ltvBps,
            protocolFeeBps:    _protocolFeeBps,
            createdAt:         block.timestamp,
            bankAddress:       _bank
        });

        outstandingPrincipal = _principalAmount;
        status = PoolStatus.PENDING_ACTIVATION;

        for (uint i = 0; i < _documentCIDs.length; i++) {
            documentCIDs.push(_documentCIDs[i]);
        }

        _buildAmortisationSchedule(_principalAmount, _interestRateBps, _termMonths, _protocolFeeBps);

        emit PoolCreated(address(this), _poolName, _bank, _principalAmount);
    }

    // ─── Flow 2: Activation ───────────────────────────────────────────────────

    /**
     * @notice Issuance Partner activates the pool.
     *         Deploys MITToken, mints Deed-NFT → deposits into PledgeVault,
     *         mints MIT tokens to the Bank.
     */
    function activatePool(
        address _deedNFT,
        address _pledgeVault,
        address _wade,
        string calldata _metadataURI
    ) external onlyRole(ISSUANCE_ROLE) nonReentrant {
        require(status == PoolStatus.PENDING_ACTIVATION, "PoolContract: not pending activation");
        require(_deedNFT != address(0) && _pledgeVault != address(0) && _wade != address(0),
            "PoolContract: invalid addresses");

        deedNFT     = DeedNFT(_deedNFT);
        pledgeVault = PledgeVault(_pledgeVault);
        wade        = WADE(_wade);

        // 1. Mint MIT ERC-20 token contract and mint to Bank
        MITToken _mitToken = new MITToken(
            params.poolName,
            string(abi.encodePacked("MIT-", _toPoolSymbol(params.poolName))),
            address(this),
            msg.sender,        // issuance partner as whitelist manager
            admin
        );
        mitToken  = _mitToken;
        mitSupply = params.principalAmount; // 1 MIT = 1 USDC face value

        _mitToken.addToWhitelist(params.bankAddress);
        _mitToken.mint(params.bankAddress, mitSupply);

        // 2. Mint Deed-NFT → send to PledgeVault
        uint256 _deedTokenId = deedNFT.mintDeed(
            address(pledgeVault),
            address(this),
            params.poolName,
            params.principalAmount,
            params.collateralValue,
            params.ltvBasisPoints,
            _metadataURI
        );
        deedTokenId = _deedTokenId;

        // 3. Update state
        status = PoolStatus.ACTIVE;
        activatedAt = block.timestamp;

        // Set period start based on activation
        _updateScheduleDates(block.timestamp);

        emit PoolActivated(address(_mitToken), address(deedNFT), mitSupply, _deedTokenId);
    }

    // ─── Flow 3: Buy MIT ──────────────────────────────────────────────────────

    /**
     * @notice Investor purchases MIT tokens.
     *         Transfers USDC from investor → Pool (held for eventual repayment routing).
     *         Transfers MIT from Bank's holding → Investor.
     *
     * @param mitAmount  Number of MIT tokens to purchase (6 decimals)
     */
    function buyMIT(uint256 mitAmount) external nonReentrant {
        require(status == PoolStatus.ACTIVE, "PoolContract: pool not active");
        require(mitAmount > 0, "PoolContract: zero amount");

        uint256 bankBalance = mitToken.balanceOf(params.bankAddress);
        require(mitAmount <= bankBalance, "PoolContract: insufficient MIT available");

        uint256 usdcRequired = mitAmount; // 1:1 parity (both 6 decimals)

        // Whitelist investor if not already
        if (!mitToken.whitelisted(msg.sender)) {
            mitToken.addToWhitelist(msg.sender);
        }

        // Settle WADE accounting before balance changes
        // wade.settleOnTransfer(msg.sender, address(0));

        // Transfer USDC from investor to this contract
        require(usdc.transferFrom(msg.sender, address(this), usdcRequired),
            "PoolContract: USDC transfer failed");

        // Transfer MIT from Bank to Investor
        // (Bank approves pool contract to move their MITs — done off-chain via MetaMask approval tx)
        require(mitToken.transferFrom(params.bankAddress, msg.sender, mitAmount),
            "PoolContract: MIT transfer failed");

        mitSold += mitAmount;

        emit MITBought(msg.sender, mitAmount, usdcRequired);
    }

    // ─── Flow 4: Repay ────────────────────────────────────────────────────────

    /**
     * @notice Bank submits monthly repayment.
     *         USDC flows: Bank → PoolContract → WADE → (Treasury + MIT holders).
     *         MIT tokens burned proportional to principal component.
     */
    function repay() external onlyRole(BANK_ROLE) nonReentrant {
        require(status == PoolStatus.ACTIVE, "PoolContract: pool not active");
        require(currentPeriod < params.termMonths, "PoolContract: all periods paid");

        Period storage period = schedule[currentPeriod];
        require(!period.paid, "PoolContract: period already paid");
        // Allow repayment up to 30 days after due date (grace period)
        // require(block.timestamp >= period.dueDate - 7 days, "PoolContract: too early");

        uint256 totalDue = period.totalPayment;

        // Transfer full payment from Bank to this contract
        require(usdc.transferFrom(params.bankAddress, address(this), totalDue),
            "PoolContract: USDC transfer failed");

        // Transfer full repayment to WADE for distribution
        require(usdc.transfer(address(wade), totalDue),
            "PoolContract: WADE transfer failed");

        period.paid = true;
        currentPeriod++;
        outstandingPrincipal -= period.principal;

        // WADE distributes
        wade.distributeRepayment(
            period.principal,
            period.interest,
            period.protocolFee,
            mitToken.totalSupply()
        );

        emit Repayment(currentPeriod, totalDue, period.mitToBurn, outstandingPrincipal);

        // Check if final period
        if (currentPeriod == params.termMonths) {
            _closePool();
        }
    }

    // ─── Internal: Pool Closure ────────────────────────────────────────────────

    function _closePool() internal {
        status = PoolStatus.REPAID;
        pledgeVault.releaseDeed();
        deedNFT.markReleased(deedTokenId);
        emit PoolRepaid(block.timestamp);
        emit DeedReleased(params.bankAddress, deedTokenId);
    }

    // ─── Internal: Amortisation Schedule ─────────────────────────────────────

    /**
     * @notice Build the full amortisation schedule at construction time.
     *         Uses standard reducing-balance (annuity) formula:
     *         monthly_payment = P * r / (1 - (1 + r)^-n)
     *         where r = annualRateBps / 10000 / 12
     *
     *         Computed in fixed-point arithmetic (×1e18 for precision).
     *         Protocol fee = principalAmount * protocolFeeBps / 10000 / 12
     */
    function _buildAmortisationSchedule(
        uint256 principal,
        uint256 annualRateBps,
        uint256 termMonths,
        uint256 protocolFeeBps
    ) internal {
        // Monthly rate scaled ×1e18
        uint256 rateScale = 1e18;
        uint256 monthlyRate = (annualRateBps * rateScale) / (10000 * 12);

        // Monthly protocol fee (fixed per period)
        uint256 monthlyFee = (principal * protocolFeeBps) / (10000 * 12);

        // Compute (1 + r)^n using iterative multiplication
        uint256 compoundFactor = rateScale; // starts at 1×1e18
        for (uint256 i = 0; i < termMonths; i++) {
            compoundFactor = compoundFactor + (compoundFactor * monthlyRate) / rateScale;
        }

        // monthly_payment = P * monthlyRate * (1+r)^n / ((1+r)^n - 1)
        // In USDC base units (after scaling back down)
        uint256 numerator   = principal * monthlyRate * compoundFactor;
        uint256 denominator = (compoundFactor - rateScale) * rateScale;
        uint256 monthlyPayment = numerator / denominator; // USDC base units (approx)

        // Build schedule period-by-period
        uint256 outstanding = principal;
        for (uint256 i = 0; i < termMonths; i++) {
            uint256 interest   = (outstanding * monthlyRate) / rateScale;
            uint256 _principal = monthlyPayment > interest ? monthlyPayment - interest : 0;

            // Last period: remaining balance
            if (i == termMonths - 1) {
                _principal = outstanding;
                monthlyPayment = _principal + interest;
            }

            schedule.push(Period({
                dueDate:      0,             // set on activation
                principal:    _principal,
                interest:     interest,
                protocolFee:  monthlyFee,
                totalPayment: _principal + interest + monthlyFee,
                mitToBurn:    _principal,    // MIT burned = principal repaid
                paid:         false
            }));

            outstanding = outstanding > _principal ? outstanding - _principal : 0;
        }
    }

    /// @dev Set actual due dates once activation timestamp is known
    function _updateScheduleDates(uint256 activationTimestamp) internal {
        for (uint256 i = 0; i < schedule.length; i++) {
            schedule[i].dueDate = activationTimestamp + ((i + 1) * 30 days);
        }
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getSchedule() external view returns (Period[] memory) {
        return schedule;
    }

    function getDocumentCIDs() external view returns (string[] memory) {
        return documentCIDs;
    }

    function currentLtvBps() external view returns (uint256) {
        if (params.collateralValue == 0) return 0;
        return (outstandingPrincipal * 10000) / params.collateralValue;
    }

    function mitAvailable() external view returns (uint256) {
        if (address(mitToken) == address(0)) return 0;
        return mitToken.balanceOf(params.bankAddress);
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    function _toPoolSymbol(string memory name) internal pure returns (string memory) {
        // Return last 3 chars as symbol suffix, e.g. "MIT-001" → "001"
        bytes memory b = bytes(name);
        if (b.length >= 3) {
            bytes memory suffix = new bytes(3);
            suffix[0] = b[b.length - 3];
            suffix[1] = b[b.length - 2];
            suffix[2] = b[b.length - 1];
            return string(suffix);
        }
        return name;
    }

    /// @notice Admin can whitelist investors post-deployment
    function whitelistInvestor(address investor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(mitToken) != address(0), "PoolContract: not activated");
        mitToken.addToWhitelist(investor);
        _grantRole(INVESTOR_ROLE, investor);
    }

    // Required for AccessControl enumeration
    function getRoleMember(bytes32 role, uint256 index) public view returns (address) {
        // Simplified — returns the first member. In production use EnumerableSet.
        if (role == DEFAULT_ADMIN_ROLE && index == 0) {
            return params.bankAddress; // fallback — override in factory
        }
        revert("PoolContract: enumeration not supported");
    }
}
