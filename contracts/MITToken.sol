// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MITToken
 * @notice Mortgage Investment Token (MIT) — ERC-20 with whitelist gating.
 *         Decimals match USDC (6) so 1 MIT = 1 USDC face value.
 *         Only whitelisted addresses may hold or transfer tokens.
 *         Minting and burning are restricted to POOL_CONTRACT_ROLE.
 */
contract MITToken is ERC20, AccessControl {
    bytes32 public constant POOL_CONTRACT_ROLE = keccak256("POOL_CONTRACT_ROLE");
    bytes32 public constant WHITELIST_MANAGER_ROLE = keccak256("WHITELIST_MANAGER_ROLE");

    // Pool metadata
    string public poolName;
    address public poolContract;

    // Whitelist
    mapping(address => bool) public whitelisted;

    // Events
    event AddressWhitelisted(address indexed account);
    event AddressRemovedFromWhitelist(address indexed account);

    modifier onlyWhitelisted(address account) {
        require(whitelisted[account] || account == address(0), "MITToken: address not whitelisted");
        _;
    }

    constructor(
        string memory _poolName,
        string memory _symbol,
        address _poolContract,
        address _issuancePartner,
        address _admin
    ) ERC20(_poolName, _symbol) {
        poolName = _poolName;
        poolContract = _poolContract;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(POOL_CONTRACT_ROLE, _poolContract);
        _grantRole(WHITELIST_MANAGER_ROLE, _poolContract);
        _grantRole(WHITELIST_MANAGER_ROLE, _issuancePartner);
        _grantRole(WHITELIST_MANAGER_ROLE, _admin);

        // Auto-whitelist system actors
        whitelisted[_poolContract] = true;
        whitelisted[_issuancePartner] = true;
        whitelisted[_admin] = true;
    }

    /// @notice MITs are 6 decimals (1:1 parity with USDC)
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint MIT tokens. Only callable by the pool contract.
    function mint(address to, uint256 amount) external onlyRole(POOL_CONTRACT_ROLE) onlyWhitelisted(to) {
        _mint(to, amount);
    }

    /// @notice Burn MIT tokens from an address. Only callable by the pool contract (WADE).
    function burn(address from, uint256 amount) external onlyRole(POOL_CONTRACT_ROLE) {
        _burn(from, amount);
    }

    /// @notice Add address to whitelist
    function addToWhitelist(address account) external onlyRole(WHITELIST_MANAGER_ROLE) {
        whitelisted[account] = true;
        emit AddressWhitelisted(account);
    }

    /// @notice Remove address from whitelist
    function removeFromWhitelist(address account) external onlyRole(WHITELIST_MANAGER_ROLE) {
        whitelisted[account] = false;
        emit AddressRemovedFromWhitelist(account);
    }

    /// @dev Override to enforce whitelist on all transfers
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) {
            require(whitelisted[from], "MITToken: sender not whitelisted");
        }
        if (to != address(0)) {
            require(whitelisted[to], "MITToken: recipient not whitelisted");
        }
        super._update(from, to, amount);
    }
}
