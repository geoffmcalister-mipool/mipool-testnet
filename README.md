# MiPool Protocol
### Tokenised Mortgage Investment Pools on Avalanche

| Avalanche Build Games 2026 | Stage 2 Submission | Fuji Testnet | March 2026 |
|---|---|---|---|

---

## 1. What is MiPool?

MiPool is a Web3 infrastructure protocol that tokenises real-estate mortgage investment pools on Avalanche. It enables banks and mortgage originators to issue on-chain Mortgage Investment Tokens (MITs) backed by real mortgage collateral, allowing institutional investors to purchase fractional exposure to mortgage pools and earn pro-rata yield as monthly repayments are processed automatically on-chain.

| Key Figure | Value |
|---|---|
| Demo Pool (MIT-001) | 1,000,000 USDC principal — 5% p.a. — 12 month term |
| Collateral / LTV | 1,500,000 USDC collateral — 66.67% LTV |
| Monthly Repayment | 85,778.70 USDC (principal + interest + protocol fee) |
| Protocol Fee | 0.20% per period — distributed to Treasury |
| Target Market | UAE — 23–28 active mortgage-originating banks |
| Network | Avalanche C-Chain (Fuji Testnet for this submission) |

### The Problem

Mortgage investment pools are currently opaque, illiquid, and inaccessible to most institutional capital. Banks hold large mortgage books on their balance sheets but have limited tools to efficiently distribute risk or raise capital against them. Investors who want exposure to mortgage yield have no transparent, programmable mechanism to do so.

### The Solution

MiPool puts the entire mortgage pool lifecycle on-chain — from pool creation and collateral custody, through MIT token issuance and investor participation, to automated monthly repayment distribution and final collateral release. Every action is a verifiable, auditable on-chain event. The protocol is designed for institutional participants from day one: whitelisted transfers, KYC-gated investor access, and a collateral vault that operates by code rather than counterparty trust.

---

## 2. Protocol Architecture

MiPool is built on Avalanche's C-Chain — a fully EVM-compatible execution environment. All contracts are written in Solidity 0.8.25, use OpenZeppelin v5 as a base, and are deployable with standard Hardhat tooling. The protocol consists of six core contracts and one testnet mock.

### 2.1 Contract Overview

| Contract | Standard | Responsibility |
|---|---|---|
| PoolFactory.sol | Custom | Entry point for banks. Deploys a new PoolContract for each pool. Maintains a registry of all pools. |
| PoolContract.sol | Custom | Core lifecycle manager. Handles pool states (Pending → Active → Repaid), on-chain amortisation schedule, MIT purchase, and monthly repayment processing. |
| MITToken.sol | ERC-20 | One token per pool. 6 decimal places (1 MIT = 1 USDC face value). Whitelist-gated transfers. Minted and burned exclusively by PoolContract. |
| DeedNFT.sol | ERC-721 | Digital twin of the mortgage deed. One NFT per pool, minted at activation and held in PledgeVault as collateral until full repayment. |
| PledgeVault.sol | Custom | Custodian for the Deed-NFT. Accepts the NFT via onERC721Received(). Releases only when PoolContract confirms full repayment. |
| WADE.sol | Custom | Waterfall Automation Disbursement Engine. Receives monthly repayments and distributes USDC to MIT holders via push payments. MockWADE passthrough used for testnet prototype; production upgrade path via Chainlink Automation documented in Section 2.3. |
| MockUSDC.sol | ERC-20 | Testnet-only stablecoin with public faucet(). Not deployed to mainnet. |

### 2.2 Pool Lifecycle

Every MiPool pool moves through four states. Each state transition is an on-chain event:

| State | Actor | What Happens |
|---|---|---|
| **1. PENDING** | Bank | Bank calls PoolFactory.createPool() with principal, rate, term, collateral value and supporting document hashes. A PoolContract is deployed. MIT-001 token exists but is not yet issued. |
| **2. ACTIVE** | Issuance Partner | Issuance Partner calls activatePool(). This mints the Deed-NFT, deposits it into PledgeVault, and mints 1,000,000 MIT-001 tokens to the Bank. MIT tokens become available for investor purchase. |
| **3. REPAYING** | Bank + Investors | Investors purchase MITs via buyMIT(). Each month, Bank calls repay() which transfers USDC to WADE. WADE pushes principal and interest directly to each MIT holder wallet in the same transaction. |
| **4. REPAID** | Automatic | After Period 12, PoolContract calls PledgeVault.releaseDeed(), returning the Deed-NFT to the Bank. Pool is closed. |

### 2.3 WADE — Waterfall Automation Disbursement Engine

WADE is the core distribution mechanism. It operates as a **push payment engine** — when the Bank submits a monthly repayment, WADE immediately distributes USDC directly to every MIT holder's wallet in the same transaction. No investor action is required. Funds arrive automatically.

On each repayment call, WADE executes the following atomically:

- **Protocol fee (0.20%)** → pushed directly to the Treasury address
- **Interest portion** → pushed pro-rata to each MIT holder wallet
- **Principal portion** → pushed pro-rata to each MIT holder wallet
- **MIT tokens** → burned in proportion to principal repaid, reducing total supply each period

> **Why push works for MiPool:** The whitelist-gated MIT transfer model means the investor set is small and known — typically 2–10 institutional counterparties per pool. Looping over a bounded, KYC-verified address list in a single transaction is gas-efficient and reliable at this scale. Investors receive funds in the same block the Bank repays — zero latency, zero manual action required.

#### Production Upgrade Path — Chainlink Automation

For pools with larger investor sets, or to remove any dependency on the Bank's repay() call as the sole trigger, WADE is designed to be upgraded to integrate Chainlink Automation. WADE implements the AutomationCompatibleInterface, exposing two functions:

- **checkUpkeep()** — Chainlink nodes monitor this continuously. Returns true when a repayment is due and sufficient USDC has been deposited.
- **performUpkeep()** — Called automatically by Chainlink's decentralised node network when checkUpkeep() returns true. Triggers the full push distribution without any human intervention.

Chainlink is a Build Games partner and has been engaged as part of the MiPool technical roadmap.

### 2.4 On-Chain Event Sequence

The protocol produces 22 distinct on-chain events across the full MIT-001 lifecycle:

| # | Flow | Actor | Event |
|---|---|---|---|
| 1 | Create Pool | Bank A | createPool() — deploys PoolContract |
| 2 | Create Pool | Bank A | createPool() — deploys PledgeVault |
| 3 | Activate | Issuance Partner | activatePool() — pool state → ACTIVE |
| 4 | Activate | Issuance Partner | mintDeed() — Deed-NFT minted |
| 5 | Activate | Issuance Partner | depositDeed() — Deed-NFT transferred to PledgeVault |
| 6 | Activate | Issuance Partner | mintMIT() — 1,000,000 MIT-001 minted to Bank |
| 7 | Buy MIT | Investor A | buyMIT() — 400,000 MIT-001 purchased |
| 8 | Buy MIT | Investor B | buyMIT() — 600,000 MIT-001 purchased |
| 9–20 | Repay ×12 | Bank A | repay() ×12 — USDC sent to WADE each period |
| 9–20 | Repay ×12 | WADE | distributeRepayment() ×12 — USDC pushed to each holder wallet |
| 9–20 | Repay ×12 | WADE | burnMIT() ×12 — principal portion of MITs burned |
| 21 | Final Repay | Automatic | pool state → REPAID |
| 22 | Close | Automatic | releaseDeed() — Deed-NFT returned to Bank |

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Blockchain | Avalanche C-Chain | EVM-compatible execution — sub-second finality, low fees, institutional RWA ecosystem |
| Smart Contracts | Solidity 0.8.25 | All protocol logic — PoolFactory, PoolContract, WADE, PledgeVault, MITToken, DeedNFT |
| Contract Base | OpenZeppelin v5 | AccessControl, ERC20, ERC721, ReentrancyGuard |
| Dev Framework | Hardhat | Compilation, testing, deployment, Snowtrace verification |
| Testing | Chai / Mocha | Full lifecycle test suite — 14/14 tests passing |
| Frontend | SvelteKit + ethers.js v6 | Role-based dashboards for Bank, Issuance Partner, Investor |
| Wallet | MetaMask | Browser wallet — Fuji testnet chain switching via wallet_addEthereumChain |
| Stablecoin | USDC (MockUSDC on testnet) | Payment currency for pool principal, repayments and distributions |
| Block Explorer | Snowtrace | Transaction verification — testnet.snowtrace.io |
| Testnet | Avalanche Fuji (43113) | All demo deployments — RPC: api.avax-test.network/ext/bc/C/rpc |

---

## 4. Repository Structure

```
mipool-testnet/
├── contracts/
│   ├── PoolFactory.sol         # Entry point — bank deploys pools here
│   ├── PoolContract.sol        # Core lifecycle, amortisation schedule, repayment
│   ├── MITToken.sol            # ERC-20 mortgage investment token
│   ├── DeedNFT.sol             # ERC-721 deed digital twin
│   ├── PledgeVault.sol         # Collateral custodian
│   ├── WADE.sol                # Waterfall Automation Disbursement Engine (MockWADE for testnet)
│   └── mocks/
│       └── MockUSDC.sol        # Testnet stablecoin with public faucet()
├── scripts/
│   └── deploy.js               # Full deployment + MIT-001 demo scenario
├── test/
│   └── Pool.test.js            # Full lifecycle test suite (14/14 passing)
├── hardhat.config.js
├── package.json
├── .env.example
└── README.md
```

---

## 5. Getting Started

### 5.1 Prerequisites

- Node.js v18+ and npm
- MetaMask browser extension
- Test AVAX from faucet.avax.network (fund deployer wallet with at least 2 AVAX)

### 5.2 Installation

```bash
git clone https://github.com/geoffmcalister-mipool/mipool-testnet.git
cd mipool-testnet
npm install
cp .env.example .env
# Edit .env — add your deployer private key
```

### 5.3 Compile Contracts

```bash
npx hardhat compile
```

### 5.4 Run Tests

```bash
npx hardhat test
# Expected: 14 passing
```

### 5.5 Deploy to Fuji Testnet

```bash
npx hardhat run scripts/deploy.js --network fuji
# Verify on Snowtrace:
npx hardhat verify --network fuji <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 5.6 Run the Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

> The deploy script runs the full MIT-001 demo scenario automatically: deploys all contracts, funds demo wallets with test USDC, creates the pool, activates it, has Investor A buy 400,000 MIT and Investor B buy 600,000 MIT. All transaction hashes are printed to console for verification on Snowtrace.

---

## 6. Network Configuration

| Parameter | Fuji Testnet | Avalanche Mainnet |
|---|---|---|
| Network Name | Avalanche Fuji C-Chain | Avalanche C-Chain |
| Chain ID | 43113 | 43114 |
| RPC URL | https://api.avax-test.network/ext/bc/C/rpc | https://api.avax.network/ext/bc/C/rpc |
| Block Explorer | testnet.snowtrace.io | snowtrace.io |
| Gas Token | AVAX (test) | AVAX |
| USDC Address | MockUSDC (deployed by script) | 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E |

> The contracts and deploy scripts are identical for testnet and mainnet. The only changes for a mainnet deployment are: (1) update RPC URL and Chain ID in hardhat.config.js, (2) replace MockUSDC address with the live USDC contract address, (3) fund the deployer wallet with real AVAX.

---

## 7. Demo Walkthrough

The demo follows four flows covering the full lifecycle of a single mortgage investment pool (MIT-001).

### Flow 1 — Bank Creates Pool

- **Actor:** Bank A
- **Action:** Bank calls createPool() with MIT-001 parameters — principal 1,000,000 USDC, 5% p.a., 12 months, 1,500,000 USDC collateral
- **On-chain result:** PoolContract deployed. Pool status: Pending Activation.
- **Key figure:** Monthly payment auto-calculates to 85,778.70 USDC. LTV: 66.67%.

### Flow 2 — Issuance Partner Activates Pool

- **Actor:** Issuance Partner
- **Action:** Calls activatePool() — reviews MIT-001 parameters and confirms
- **On-chain result:** Deed-NFT minted and deposited to PledgeVault. 1,000,000 MIT-001 tokens minted to Bank. Pool status: Active.
- **Verification:** View on Snowtrace links to the activation transaction.

### Flow 3 — Investors Purchase MITs

- **Actor A:** Investor A — purchases 400,000 MIT-001 for 400,000 USDC (40% pool share)
- **Actor B:** Investor B — purchases 600,000 MIT-001 for 600,000 USDC (60% pool share)
- **On-chain result:** USDC transferred from investor to PoolContract. MIT-001 tokens transferred to investor wallet.

### Flow 4 — Bank Repays (Period 1 of 12)

- **Actor:** Bank A
- **Action:** Calls repay() — submits Period 1 repayment
- **On-chain result:** 85,778.70 USDC transferred to WADE. In the same transaction, WADE atomically pushes: 171.21 USDC to Treasury, 34,243.00 USDC directly to Investor A's wallet, 51,364.49 USDC directly to Investor B's wallet. 81,440.82 MIT-001 tokens burned.
- **Investor experience:** USDC balances update immediately. No claim transaction required — funds arrive in the same block as the Bank's repayment.
- **Production upgrade:** Chainlink Automation replaces the manual repay() trigger — WADE's checkUpkeep() detects the due date and Chainlink nodes call performUpkeep() automatically.

---

## 8. Environment Variables

### 8.1 Root .env (Hardhat / Deployment)

```
DEPLOYER_PRIVATE_KEY=0x...
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
```

### 8.2 Frontend .env

```
VITE_POOL_FACTORY_ADDRESS=0x770b591F6A171CD8D523E6515870CF7B83B5bdfD
VITE_DEED_NFT_ADDRESS=0xebcA6608089FAC5cA31A2fEbE40e1924457084F3
VITE_USDC_ADDRESS=0xC5c840Ac37f438Be2c2CA0E1188511fB71BDb73B
VITE_WADE_ADDRESS=0xCdC9424C30BfE912Af3E8b3800c919bfCEb23f47
VITE_POOL_CONTRACT_ADDRESS=0xA564dBa8454eeBd79c4EC66236D5e0eB1B1BfE36
VITE_MIT_TOKEN_ADDRESS=0xE0f7fA3a4c6ff2E672386C4796D9260FC496fdFf
VITE_PLEDGE_VAULT_ADDRESS=0x2640b1D8526820f09e60a2fC23F9Cb7D7b109295
VITE_CHAIN_ID=43113
VITE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

```

---

## 9. Known Limitations (MVP Scope)

The following are intentional MVP exclusions — not bugs.

| Limitation | Notes |
|---|---|
| MockWADE for testnet | The testnet WADE is a passthrough mock. Production WADE implements full pro-rata distribution logic with Chainlink Automation. |
| No secondary market | MIT trading between investors (MiPool Markets) is a separate product stream — not in scope for this MVP. |
| No default / liquidation logic | The PledgeVault holds the Deed-NFT but automated liquidation on missed repayments is post-MVP. |
| Manual KYC whitelist | The MIT transfer whitelist is managed manually by the Issuance Partner. Production requires integration with a regulated KYC provider API. |
| MockUSDC only | Testnet uses a mock stablecoin with a free faucet. Mainnet connects to the native Circle USDC contract. |
| No audit | Contracts have not been professionally audited. Required before any mainnet deployment involving real capital. |

---

## 10. Roadmap

| Phase | Timeline | Milestones |
|---|---|---|
| **Phase 1 MVP** | Now — Q2 2026 | Fuji testnet deployment · Build Games submission · Pilot with 1–2 UAE banks · Initial investor onboarding |
| **Phase 2 Mainnet** | Q3 2026 | Security audit · Avalanche mainnet launch · Live USDC integration · KYC provider API · Chainlink Automation integration for trustless repayment triggering · First live pool issuance |
| **Phase 3 Markets** | Q4 2026 | MiPool Markets (secondary MIT trading) · Multi-pool WADE · Default / liquidation logic · Data & API SaaS layer |
| **Phase 4 Scale** | 2027 | 5+ active UAE banks · Regional expansion (GCC) · ZK-privacy features for institutional investor confidentiality |

---

## 11. Team

| Name | Role | Background |
|---|---|---|
| Geoff McAlister | MiPool Founder & CEO | Goldman Sachs / FAB pedigree and former MD & Head of Hex Trust Markets & Group Chief Risk Officer at M2 Exchange. Institutional capital markets. UAE banking relationships. Active engagement with Emirates NBD and Blackstone, LOI being discussed. |
| Vadim Zolotokrylin | MiPool CTO & Development Partner (CEO Holdex.io) | Smart contract development and frontend implementation. Avalanche ecosystem experience (Clearpool.Finance). |

---

## 12. Links

| Resource | URL |
|---|---|
| GitHub Repository | https://github.com/geoffmcalister-mipool/mipool-testnet |
| Demo Video | TO BE ADDED — max 5 minutes |
| Fuji Deployment | TO BE ADDED — Snowtrace links populated after deployment |
| Block Explorer | testnet.snowtrace.io |
| Build Games | build.avax.network/build-games |

---

*MiPool Protocol | Built on Avalanche | Avalanche Build Games 2026*
