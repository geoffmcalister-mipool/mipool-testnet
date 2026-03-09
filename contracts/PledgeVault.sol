// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PledgeVault
 * @notice Custodian contract that holds the Deed-NFT as collateral for
 *         the duration of a mortgage pool's life. The NFT is deposited
 *         upon pool activation and released automatically to the Bank
 *         once the final (Period 12) repayment is confirmed by the PoolContract.
 *
 *         Only the associated PoolContract may trigger release.
 */
contract PledgeVault is IERC721Receiver, AccessControl {
    bytes32 public constant POOL_CONTRACT_ROLE = keccak256("POOL_CONTRACT_ROLE");

    address public poolContract;
    address public deedNFTContract;
    uint256 public heldTokenId;
    bool public nftDeposited;
    bool public nftReleased;

    // The bank that will receive the NFT on release
    address public bankAddress;

    // Events
    event DeedDeposited(address indexed deedContract, uint256 indexed tokenId, address indexed from);
    event DeedReleased(address indexed deedContract, uint256 indexed tokenId, address indexed to);

    constructor(
        address _poolContract,
        address _bankAddress,
        address _admin
    ) {
        poolContract = _poolContract;
        bankAddress = _bankAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(POOL_CONTRACT_ROLE, _poolContract);
    }

    /**
     * @notice Accept ERC-721 deposit. Validates it comes from the registered Deed NFT contract.
     */
    function onERC721Received(
        address,        // operator
        address from,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        require(!nftDeposited, "PledgeVault: NFT already deposited");

        deedNFTContract = msg.sender;
        heldTokenId = tokenId;
        nftDeposited = true;

        emit DeedDeposited(msg.sender, tokenId, from);

        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * @notice Release the Deed-NFT back to the bank. 
     *         Only callable by the PoolContract when pool is fully repaid.
     */
    function releaseDeed() external onlyRole(POOL_CONTRACT_ROLE) {
        require(nftDeposited, "PledgeVault: no NFT held");
        require(!nftReleased, "PledgeVault: NFT already released");

        nftReleased = true;

        IERC721(deedNFTContract).safeTransferFrom(address(this), bankAddress, heldTokenId);

        emit DeedReleased(deedNFTContract, heldTokenId, bankAddress);
    }

    /**
     * @notice View function: is the Deed-NFT currently held in this vault?
     */
    function isDeedHeld() external view returns (bool) {
        return nftDeposited && !nftReleased;
    }
}
