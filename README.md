# MiPool Protocol

**Tokenised Mortgage Investment Pools on Avalanche**

> Avalanche Build Games 2026 — Stage 2 Submission

MiPool is a Web3 infrastructure platform that tokenises real-estate mortgage pools into **Mortgage Investment Tokens (MITs)** on Avalanche. Banks originate pools, an Issuance Partner activates them by minting Deed-NFTs and MIT ERC-20 tokens, and institutional investors purchase MITs to earn pro-rata yield. Monthly repayments are processed by **WADE** — MiPool's on-chain Waterfall Automation Disbursement Engine — which automatically distributes USDC to token holders and burns MIT tokens as principal is repaid.

---

## Architecture

```
PoolFactory
    └── createPool()
            ├── PoolContract        — pool lifecycle, repayment logic
            │       ├── activatePool() → DeedNFT.mintDeed() → PledgeVault
            │       ├── buyMIT()       → MIT ERC-20 transfer
            │       └── repay()        → WADE.distributeRepayment()
            │
            ├── MITToken (ERC-20)   — whitelisted, 6 decimals, 1:1 USDC parity
            ├── DeedNFT (ERC-721)   — digital twin of mortgage deed, held in PledgeVault
            ├── PledgeVault         — custodian for Deed-NFT collateral
            └── WADE                — pro-rata distribution engine + MIT burning
```

### Pool Lifecycle & On-Chain Events (22 total)

| Flow | Actor | On-Chain Actions |
|------|-------|-----------------|
| 1 — Create Pool | Bank | `Create Pool` → `Create Pledge Vault` |
| 2 — Activate Pool | Issuance Partner | `Activate Pool` → `Mint Deed-NFT` → `Deposit Deed-NFT` → `Mint MIT` |
| 3 — Buy MIT | Investor A + B | `Buy MIT` × 2 |
| 4 — Repay × 12 | Bank | `Repay` + `Distribute Repayment` + `Burn MIT` × 12 periods + `Pool Repaid` + `Release Deed-NFT` |

### Demo Pool — MIT-001

| Parameter | Value |
|-----------|-------|
| Principal | 1,000,000 USDC |
| Interest Rate | 5.00% per annum |
| Term | 12 months |
| Collateral | 1,500,000 USDC (LTV 66.67%) |
| Monthly Payment | 85,778.70 USDC |
| Protocol Fee | 171.21 USDC / period (0.20%) |
| MIT Token | 1 MIT-001 = 1 USDC (face value) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.20, OpenZeppelin v5 |
| Development/Testing | Hardhat, Chai, ethers.js v6 |
| Network | Avalanche Fuji Testnet (Chain ID: 43113) |
| Frontend | SvelteKit, ethers.js v6, Tailwind CSS |
| Storage | IPFS (document CIDs), on-chain event indexing |
| Block Explorer | Snowtrace (testnet.snowtrace.io) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- MetaMask with Avalanche Fuji Testnet added
- Fuji testnet AVAX (from [faucet.avax.network](https://faucet.avax.network))

### 1. Install Dependencies

```bash
# Smart contracts
cd mipool-protocol
npm install

# Frontend
cd frontend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and fill in your private keys
```

Your `.env` needs:
```
PRIVATE_KEY_DEPLOYER=0x...
PRIVATE_KEY_BANK=0x...
PRIVATE_KEY_ISSUANCE=0x...
PRIVATE_KEY_INVESTOR_A=0x...
PRIVATE_KEY_INVESTOR_B=0x...
SNOWTRACE_API_KEY=...   # optional, for contract verification
```

### 3. Compile Contracts

```bash
npm run compile
```

### 4. Run Tests

```bash
npm test
```

### 5. Deploy to Fuji Testnet

```bash
npm run deploy:fuji
```

This deploys the full system and runs the demo scenario (create pool → activate → investors buy → Period 1 repayment). Deployment addresses are saved to `deployments/latest.json`.

### 6. Run Frontend Locally

```bash
cd frontend
# Copy contract addresses from deployments/latest.json to frontend/.env
cp .env.example .env
# Set VITE_POOL_FACTORY_ADDRESS, VITE_DEED_NFT_ADDRESS, VITE_USDC_ADDRESS from latest.json
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and connect MetaMask on Fuji testnet.

---

## Contract Addresses (Fuji Testnet)

> Updated after each deployment. See `deployments/latest.json` for current addresses.

| Contract | Address |
|----------|---------|
| MockUSDC | `TBD` |
| DeedNFT | `TBD` |
| PoolFactory | `TBD` |
| MIT-001 PoolContract | `TBD` |
| MIT-001 PledgeVault | `TBD` |
| MIT-001 MITToken | `TBD` |
| MIT-001 WADE | `TBD` |

---

## Contracts Overview

### `MITToken.sol` — ERC-20 Mortgage Investment Token
- 6 decimals (1:1 USDC parity)
- Whitelist-gated transfers (KYC-ready)
- Mint/burn restricted to PoolContract role
- Deployed fresh for each pool by the PoolContract on activation

### `DeedNFT.sol` — ERC-721 Deed NFT
- Represents the digital twin of the mortgage pool's collateral deed
- Minted to PledgeVault on activation, released on full repayment
- Metadata URI points to IPFS document package

### `PledgeVault.sol` — Collateral Custodian
- Holds the Deed-NFT for the pool's duration
- Accepts NFT via `onERC721Received`
- Releases NFT to Bank only when called by PoolContract after final repayment

### `WADE.sol` — Waterfall Automation Disbursement Engine
- Receives repayments from PoolContract
- Distributes protocol fee to Treasury
- Accumulates yield/principal per MIT token (staking-style accounting)
- Investors pull-claim their USDC; MIT tokens burned on claim proportional to principal

### `PoolContract.sol` — Core Pool Logic
- Created by PoolFactory for each pool
- Manages the full lifecycle: Pending → Active → Repaid
- Builds on-chain amortisation schedule at construction
- Orchestrates WADE, PledgeVault, DeedNFT interactions

### `PoolFactory.sol` — Pool Registry & Deployer
- Banks call `createPool()` to instantiate new pools
- Maintains registry of all pools for off-chain indexing
- Emits `PoolCreated` event for each new pool

---

## Frontend

The SvelteKit frontend provides role-based dashboards for all three actors:

| Route | Role | Description |
|-------|------|-------------|
| `/bank` | Bank | Create pools, view repayment schedule, submit repayments |
| `/issuance` | Issuance Partner | Review pending pools, activate (mint Deed-NFT + MITs) |
| `/investor` | Investor | Browse pool marketplace, buy MITs, view positions & yield |

---

## Known Limitations (MVP / Testnet)

This is a draft MVP for the Build Games demo — not production-ready:

1. **WADE per-pool deployment** — WADE is designed to be deployed per pool; the deploy script uses a shared instance for simplicity. Production: each pool gets its own WADE.
2. **Pull-based claiming only** — WADE uses pull-based distribution. Investors must call `claim()` to receive USDC. Push distribution (auto-send on repayment) is a planned enhancement.
3. **No secondary market** — MiPool Markets (secondary MIT trading) is not in this MVP scope.
4. **Simulated KYC** — Whitelist management is manual via `addToWhitelist()`. Production: integrate with regulated KYC provider.
5. **No default handling** — Pool defaults/liquidation logic is excluded from MVP scope.
6. **IPFS stubs** — Document CIDs use placeholder values. Production: integrate with IPFS pinning service.
7. **Admin key management** — Private key management is basic. Production: use multisig (Gnosis Safe).

---

## Testing

```bash
npm test              # run full test suite
npm run coverage      # coverage report
npm run gas           # gas usage report
```

Test suite covers:
- PoolFactory deployment and access control
- Pool creation and amortisation schedule generation
- Activation (Deed-NFT minting, MIT minting, PledgeVault deposit)
- MIT purchase by investors (whitelist, USDC transfer)
- Period 1 repayment (principal reduction, WADE distribution)
- Full 12-period repayment → pool closure → Deed-NFT release
- MIT whitelist transfer enforcement

---

## Team

**MiPool Protocol** — Building institutional RWA infrastructure on Avalanche.

- Goldman Sachs / First Abu Dhabi Bank pedigree
- Blackstone LOI secured
- Emirates NBD engaged as Tier 1 issuer
- UAE mortgage market: $170B+ outstanding loans

---

## Links

- [Avalanche Fuji Explorer](https://testnet.snowtrace.io)
- [Fuji Faucet](https://faucet.avax.network)
- [Build Games 2026](https://www.avax.network/build-games)
- [MiPool Website](https://mipool.finance) *(coming soon)*

---

*MiPool Protocol — Avalanche Build Games 2026 — Stage 2 MVP*
