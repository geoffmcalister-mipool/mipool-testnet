// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title DeedNFT
 * @notice Represents the digital twin of a mortgage pool's collateral deed.
 *         One NFT is minted per pool upon activation, deposited into the
 *         PledgeVault as on-chain collateral, and released on full repayment.
 *
 *         Token URI points to IPFS metadata containing the collateral package
 *         (facility agreement, security deed, DLD registration, loan tape).
 */
contract DeedNFT is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _nextTokenId;

    // tokenId → pool metadata
    struct DeedMetadata {
        address poolContract;
        string poolName;
        uint256 principalAmount;    // in USDC base units (6 decimals)
        uint256 collateralValue;    // in USDC base units (6 decimals)
        uint256 ltvBasisPoints;     // e.g. 6667 = 66.67%
        uint256 activationTimestamp;
        bool released;
    }

    mapping(uint256 => DeedMetadata) public deedMetadata;

    // Events
    event DeedMinted(uint256 indexed tokenId, address indexed poolContract, string poolName);
    event DeedReleased(uint256 indexed tokenId, address indexed recipient);

    constructor(address _admin) ERC721("MiPool Deed NFT", "DEED") {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
    }

    /**
     * @notice Mint a Deed NFT for a newly activated pool.
     * @param to            Initial recipient (will be PledgeVault)
     * @param poolContract  The PoolContract address this deed represents
     * @param poolName      Human-readable pool name (e.g. "MIT-001")
     * @param principalAmount  Pool principal in USDC base units
     * @param collateralValue  Collateral value in USDC base units
     * @param ltvBasisPoints   Initial LTV in basis points (6667 = 66.67%)
     * @param metadataURI      IPFS URI for collateral document package
     * @return tokenId
     */
    function mintDeed(
        address to,
        address poolContract,
        string calldata poolName,
        uint256 principalAmount,
        uint256 collateralValue,
        uint256 ltvBasisPoints,
        string calldata metadataURI
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);

        deedMetadata[tokenId] = DeedMetadata({
            poolContract: poolContract,
            poolName: poolName,
            principalAmount: principalAmount,
            collateralValue: collateralValue,
            ltvBasisPoints: ltvBasisPoints,
            activationTimestamp: block.timestamp,
            released: false
        });

        emit DeedMinted(tokenId, poolContract, poolName);
    }

    /**
     * @notice Mark a deed as released (called by PledgeVault on final repayment).
     */
    function markReleased(uint256 tokenId) external onlyRole(MINTER_ROLE) {
        require(!deedMetadata[tokenId].released, "DeedNFT: already released");
        deedMetadata[tokenId].released = true;
        emit DeedReleased(tokenId, ownerOf(tokenId));
    }

    /// @dev Required override for AccessControl + ERC721
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
