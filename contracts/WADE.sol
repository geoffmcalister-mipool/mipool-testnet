// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WADE {
    IERC20 public usdc;

    constructor(
        address _usdc,
        address,
        address,
        address,
        address
    ) {
        usdc = IERC20(_usdc);
    }

    function settleOnTransfer(address, address) external {
        // MockWADE — no-op passthrough
    }

    function distributeRepayment(
        uint256 principal,
        uint256 interest,
        uint256 protocolFee,
        uint256 totalSupply
    ) external {
        // MockWADE — passthrough, no distribution logic
    }
}