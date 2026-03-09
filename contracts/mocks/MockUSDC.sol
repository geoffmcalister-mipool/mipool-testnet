// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Testnet USDC with free mint for development and demo purposes.
 *         Mimics Circle USDC: 6 decimals, transferable to any address.
 *         DO NOT deploy to mainnet.
 */
contract MockUSDC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("USD Coin (Testnet)", "USDC") Ownable(initialOwner) {
        // Mint initial supply to deployer for distribution to demo wallets
        _mint(initialOwner, 10_000_000 * 1e6); // 10M USDC
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint testnet USDC (for demo purposes)
    function faucet(address to, uint256 amount) external {
        require(amount <= 10_000_000 * 1e6, "MockUSDC: max 10M per mint");
        _mint(to, amount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
