/**
 * deploy.js
 * 
 * Full deployment script for MiPool Protocol on Avalanche Fuji testnet.
 * 
 * Deploys (in order):
 *   1. MockUSDC            — testnet stable token
 *   2. DeedNFT             — shared NFT contract (1 per protocol deployment)
 *   3. WADE                — distribution engine (1 per pool in production; shared here for MVP)
 *   4. PoolFactory         — pool registry and deployer
 * 
 * Then runs the full demo scenario:
 *   5. Bank creates MIT-001 pool via PoolFactory
 *   6. Issuance Partner activates pool (deploys MITToken, mints Deed-NFT, mints MITs)
 *   7. Investor A buys 400,000 MIT-001
 *   8. Investor B buys 600,000 MIT-001
 *   9. Bank makes Period 1 repayment → WADE distributes
 *
 * Run:
 *   npx hardhat run scripts/deploy.js --network fuji
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Pool Parameters (MIT-001) ─────────────────────────────────────────────
const POOL_NAME         = "MIT-001";
const PRINCIPAL         = ethers.parseUnits("1000000", 6);   // 1,000,000 USDC
const INTEREST_RATE_BPS = 500;                                // 5.00% per annum
const TERM_MONTHS       = 12;
const COLLATERAL_VALUE  = ethers.parseUnits("1500000", 6);   // 1,500,000 USDC
const PROTOCOL_FEE_BPS  = 20;                                 // 0.20%

const INVESTOR_A_AMOUNT = ethers.parseUnits("400000", 6);    // 400,000 MIT
const INVESTOR_B_AMOUNT = ethers.parseUnits("600000", 6);    // 600,000 MIT

const DEED_METADATA_URI = "ipfs://QmPlaceholderCID/deed-mit001.json";
const DOCUMENT_CIDS = [
  "ipfs://QmPlaceholderCID/facility_agreement.pdf",
  "ipfs://QmPlaceholderCID/security.docx",
  "ipfs://QmPlaceholderCID/dld_registration.pdf",
  "ipfs://QmPlaceholderCID/loan_tape.pdf",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, bank, issuancePartner, investorA, investorB, treasury] = signers;

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║       MiPool Protocol — Fuji Testnet Deploy      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("Deployer:          ", deployer.address);
  console.log("Bank A:            ", bank.address);
  console.log("Issuance Partner:  ", issuancePartner.address);
  console.log("Investor A:        ", investorA.address);
  console.log("Investor B:        ", investorB.address);
  console.log("Treasury:          ", treasury.address);
  console.log("");

  // ─── 1. Deploy MockUSDC ────────────────────────────────────────────────────
  console.log("1. Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy(deployer.address);
  await usdc.waitForDeployment();
  console.log("   MockUSDC deployed:", await usdc.getAddress());

  // Fund demo wallets
  await usdc.faucet(bank.address,       ethers.parseUnits("2000000", 6));  // 2M for repayments
  await usdc.faucet(investorA.address,  ethers.parseUnits("1000000", 6));  // 1M
  await usdc.faucet(investorB.address,  ethers.parseUnits("1000000", 6));  // 1M
  console.log("   USDC distributed to demo wallets ✓");

  // ─── 2. Deploy DeedNFT ─────────────────────────────────────────────────────
  console.log("\n2. Deploying DeedNFT...");
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const deedNFT = await DeedNFT.deploy(deployer.address);
  await deedNFT.waitForDeployment();
  const deedNFTAddress = await deedNFT.getAddress();
  console.log("   DeedNFT deployed:", deedNFTAddress);

  // ─── 3. Deploy PoolFactory ─────────────────────────────────────────────────
  // Note: WADE is deployed per-pool in production; for MVP deploy factory first
  // and WADE will be deployed alongside each pool activation.
  console.log("\n3. Deploying PoolFactory...");
  const PoolFactory = await ethers.getContractFactory("PoolFactory");
  const factory = await PoolFactory.deploy(
    await usdc.getAddress(),
    deedNFTAddress,
    ethers.ZeroAddress,          // wade placeholder — set per pool
    treasury.address,
    issuancePartner.address,
    deployer.address
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("   PoolFactory deployed:", factoryAddress);

  // Whitelist Bank
  await factory.connect(deployer).whitelistBank(bank.address);
  console.log("   Bank A whitelisted ✓");

  // ─── 4. Bank creates MIT-001 pool ─────────────────────────────────────────
  console.log("\n4. Bank A creates MIT-001 pool...");
  const createTx = await factory.connect(bank).createPool(
    POOL_NAME,
    PRINCIPAL,
    INTEREST_RATE_BPS,
    TERM_MONTHS,
    COLLATERAL_VALUE,
    PROTOCOL_FEE_BPS,
    DOCUMENT_CIDS
  );
  const createReceipt = await createTx.wait();
  
  // Extract pool address from event
  const poolCreatedEvent = createReceipt.logs.find(
    log => log.topics[0] === ethers.id("PoolCreated(address,address,address,string,uint256,uint256,uint256,uint256,uint256)")
  );
  
  // Get all pools
  const pools = await factory.getAllPools();
  const poolAddress = pools[0];
  console.log("   Pool MIT-001 created:", poolAddress);
  console.log("   Tx hash:", createTx.hash);

  const PoolContract = await ethers.getContractFactory("PoolContract");
  const pool = PoolContract.attach(poolAddress);

  // ─── 5. Deploy WADE for this pool ─────────────────────────────────────────
  console.log("\n5. Deploying WADE for MIT-001...");
  // At this point we don't have MITToken address yet (minted on activation)
  // WADE needs to be deployed after activation in the real flow.
  // For the deploy script, we deploy a placeholder WADE and will update after activation.
  // In production, the Issuance Partner deploys WADE as part of activatePool().

  // ─── 6. Issuance Partner deploys WADE + activates pool ─────────────────────
  console.log("\n6. Issuance Partner deploys WADE and activates MIT-001...");

  // Deploy a placeholder WADE (will be linked properly in ActivationHelper)
  const WADE = await ethers.getContractFactory("WADE");
  const wade = await WADE.deploy(
    await usdc.getAddress(),
    ethers.ZeroAddress,          // mitToken — set post activation
    treasury.address,
    poolAddress,
    deployer.address
  );
  await wade.waitForDeployment();
  const wadeAddress = await wade.getAddress();
  console.log("   WADE deployed:", wadeAddress);

  // Deploy PledgeVault
  const PledgeVault = await ethers.getContractFactory("PledgeVault");
  const pledgeVault = await PledgeVault.deploy(poolAddress, bank.address, deployer.address);
  await pledgeVault.waitForDeployment();
  const pledgeVaultAddress = await pledgeVault.getAddress();
  console.log("   PledgeVault deployed:", pledgeVaultAddress);

  // Grant pool contract MINTER_ROLE on DeedNFT
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await deedNFT.connect(deployer).grantRole(MINTER_ROLE, poolAddress);

  // Activate
  const activateTx = await pool.connect(issuancePartner).activatePool(
    deedNFTAddress,
    pledgeVaultAddress,
    wadeAddress,
    DEED_METADATA_URI
  );
  const activateReceipt = await activateTx.wait();
  console.log("   Pool activated! Tx:", activateTx.hash);

  // Retrieve MITToken address from event
  const activatedEvent = activateReceipt.logs.find(
    log => log.topics[0] === ethers.id("PoolActivated(address,address,uint256,uint256)")
  );
  const mitTokenAddress = await pool.mitToken();
  console.log("   MIT Token deployed:", mitTokenAddress);
  console.log("   Deed-NFT token ID:", (await pool.deedTokenId()).toString());

  // ─── 7. Investors buy MITs ────────────────────────────────────────────────
  console.log("\n7. Investors purchasing MITs...");

  const MITToken = await ethers.getContractFactory("MITToken");
  const mitToken = MITToken.attach(mitTokenAddress);

  // Bank approves pool to move their MITs
  await mitToken.connect(bank).approve(poolAddress, PRINCIPAL);

  // Investor A: whitelist + buy 400,000 MIT
  await pool.connect(deployer).whitelistInvestor(investorA.address);
  await usdc.connect(investorA).approve(poolAddress, INVESTOR_A_AMOUNT);
  const buyATx = await pool.connect(investorA).buyMIT(INVESTOR_A_AMOUNT);
  await buyATx.wait();
  console.log("   Investor A bought 400,000 MIT-001 ✓  Tx:", buyATx.hash);

  // Investor B: whitelist + buy 600,000 MIT
  await pool.connect(deployer).whitelistInvestor(investorB.address);
  await usdc.connect(investorB).approve(poolAddress, INVESTOR_B_AMOUNT);
  const buyBTx = await pool.connect(investorB).buyMIT(INVESTOR_B_AMOUNT);
  await buyBTx.wait();
  console.log("   Investor B bought 600,000 MIT-001 ✓  Tx:", buyBTx.hash);

  // ─── 8. Bank repays Period 1 ─────────────────────────────────────────────
  console.log("\n8. Bank A submits Period 1 repayment...");
  const schedule = await pool.getSchedule();
  const period1 = schedule[0];
  console.log("   Period 1 total due:", ethers.formatUnits(period1.totalPayment, 6), "USDC");

  // Bank approves pool for repayment amount
  await usdc.connect(bank).approve(poolAddress, period1.totalPayment);
  const repayTx = await pool.connect(bank).repay();
  await repayTx.wait();
  console.log("   Period 1 repaid ✓  Tx:", repayTx.hash);
  console.log("   Remaining principal:", ethers.formatUnits(await pool.outstandingPrincipal(), 6), "USDC");
  console.log("   Current LTV:", ((await pool.currentLtvBps()) / 100n).toString() + "%");

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║            DEPLOYMENT COMPLETE ✓                  ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const deployment = {
    network: "fuji",
    timestamp: new Date().toISOString(),
    contracts: {
      MockUSDC:     await usdc.getAddress(),
      DeedNFT:      deedNFTAddress,
      PoolFactory:  factoryAddress,
      "MIT-001": {
        PoolContract: poolAddress,
        PledgeVault:  pledgeVaultAddress,
        MITToken:     mitTokenAddress,
        WADE:         wadeAddress,
      }
    },
    wallets: {
      deployer:         deployer.address,
      bank:             bank.address,
      issuancePartner:  issuancePartner.address,
      investorA:        investorA.address,
      investorB:        investorB.address,
      treasury:         treasury.address,
    }
  };

  // Write deployment addresses to file
  const outputPath = path.join(__dirname, "../deployments", `fuji-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment addresses saved to:", outputPath);

  // Also write to latest.json for frontend to pick up
  fs.writeFileSync(
    path.join(__dirname, "../deployments/latest.json"),
    JSON.stringify(deployment, null, 2)
  );

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
