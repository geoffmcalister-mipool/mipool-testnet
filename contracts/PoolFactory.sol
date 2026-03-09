// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./PoolContract.sol";

contract PoolFactory {
    address[] public pools;
    mapping(address => bool) public whitelistedBanks;
    address public admin;
    address public usdc;
    address public issuancePartner;

    event PoolCreated(address indexed poolContract, string poolName, address indexed bank, uint256 principalAmount);

    constructor(address _usdc, address _issuancePartner) {
        admin = msg.sender;
        usdc = _usdc;
        issuancePartner = _issuancePartner;
    }

    function whitelistBank(address bank) external {
        require(msg.sender == admin, "Not admin");
        whitelistedBanks[bank] = true;
    }

    function totalPools() external view returns (uint256) {
        return pools.length;
    }

    function getAllPools() external view returns (address[] memory) {
        return pools;
    }

    function createPool(
        string memory poolName,
        uint256 principalAmount,
        uint256 interestRateBps,
        uint256 termMonths,
        uint256 collateralValue,
        uint256 protocolFeeBps,
        string[] memory documentCIDs
    ) external returns (address) {
        require(whitelistedBanks[msg.sender], "Not whitelisted");
        PoolContract pool = new PoolContract(
            usdc,
            msg.sender,
            issuancePartner,
            admin,
            poolName,
            principalAmount,
            interestRateBps,
            termMonths,
            collateralValue,
            protocolFeeBps,
            documentCIDs
        );
        pools.push(address(pool));
        emit PoolCreated(address(pool), poolName, msg.sender, principalAmount);
        return address(pool);
    }
}