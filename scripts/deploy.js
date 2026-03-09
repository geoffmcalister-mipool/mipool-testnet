const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const POOL_NAME         = "MIT-001";
const PRINCIPAL         = ethers.parseUnits("1000000", 6);
const INTEREST_RATE_BPS = 500;
const TERM_MONTHS       = 12;
const COLLATERAL_VALUE  = ethers.parseUnits("1500000", 6);
const PROTOCOL_FEE_BPS  = 20;
const INVESTOR_A_AMOUNT = ethers.parseUnits("400000", 6);
const INVESTOR_B_AMOUNT = ethers.parseUnits("600000", 6);
const DEED_METADATA_URI = "ipfs://QmPlaceholderCID/deed-mit001.json";
const DOCUMENT_CIDS = [
  "ipfs://QmPlaceholderCID/facility_agreement.pdf",
  "ipfs://QmPlaceholderCID/security.docx",
  "ipfs://QmPlaceholderCID/dld_registration.pdf",
  "ipfs://QmPlaceholderCID/loan_tape.pdf",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║     MiPool Protocol — Fuji Testnet Deploy        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("Deployer (all roles):", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("AVAX balance:", ethers.formatUnits(balance, 18), "AVAX\n");

  // ── 1. MockUSDC ───────────────────────────────────────────────────────────
  console.log("[1/7] Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy(deployer.address);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("      MockUSDC:", usdcAddress);
  const faucetTx = await usdc.faucet(deployer.address, ethers.parseUnits("5000000", 6));
  await faucetTx.wait();
  console.log("      Minted 5,000,000 MockUSDC to deployer ✓");

  // ── 2. DeedNFT ────────────────────────────────────────────────────────────
  console.log("\n[2/7] Deploying DeedNFT...");
  const DeedNFT = await ethers.getContractFactory("DeedNFT");
  const deedNFT = await DeedNFT.deploy(deployer.address);
  await deedNFT.waitForDeployment();
  const deedNFTAddress = await deedNFT.getAddress();
  console.log("      DeedNFT:", deedNFTAddress);

  // ── 3. PoolFactory ────────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying PoolFactory...");
  const PoolFactory = await ethers.getContractFactory("PoolFactory");
  const factory = await PoolFactory.deploy(usdcAddress, deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("      PoolFactory:", factoryAddress);
  const whitelistTx = await factory.whitelistBank(deployer.address);
  await whitelistTx.wait();
  console.log("      Deployer whitelisted as Bank ✓");

  // ── 4. Create Pool ────────────────────────────────────────────────────────
  console.log("\n[4/7] Creating MIT-001 Pool...");
  const createTx = await factory.createPool(
    POOL_NAME, PRINCIPAL, INTEREST_RATE_BPS, TERM_MONTHS,
    COLLATERAL_VALUE, PROTOCOL_FEE_BPS, DOCUMENT_CIDS
  );
  await createTx.wait();
  const pools = await factory.getAllPools();
  const poolAddress = pools[0];
  console.log("      PoolContract:", poolAddress);
  console.log("      Tx:", createTx.hash);

  const PoolContract = await ethers.getContractFactory("PoolContract");
  const pool = PoolContract.attach(poolAddress);

  // ── 5. WADE ───────────────────────────────────────────────────────────────
  console.log("\n[5/7] Deploying WADE (MockWADE)...");
  const WADE = await ethers.getContractFactory("WADE");
  const wade = await WADE.deploy(
    usdcAddress, ethers.ZeroAddress, deployer.address, poolAddress, deployer.address
  );
  await wade.waitForDeployment();
  const wadeAddress = await wade.getAddress();
  console.log("      WADE:", wadeAddress);

  // ── 6. PledgeVault ────────────────────────────────────────────────────────
  console.log("\n[6/7] Deploying PledgeVault...");
  const PledgeVault = await ethers.getContractFactory("PledgeVault");
  const pledgeVault = await PledgeVault.deploy(poolAddress, deployer.address, deployer.address);
  await pledgeVault.waitForDeployment();
  const pledgeVaultAddress = await pledgeVault.getAddress();
  console.log("      PledgeVault:", pledgeVaultAddress);

  // ── 7. Activate Pool ──────────────────────────────────────────────────────
  console.log("\n[7/7] Activating Pool...");
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const grantTx = await deedNFT.grantRole(MINTER_ROLE, poolAddress);
  await grantTx.wait();
  console.log("      MINTER_ROLE granted to PoolContract ✓");

  const activateTx = await pool.activatePool(
    deedNFTAddress, pledgeVaultAddress, wadeAddress, DEED_METADATA_URI
  );
  await activateTx.wait();
  console.log("      Pool activated ✓  Tx:", activateTx.hash);

  const mitTokenAddress = await pool.mitToken();
  console.log("      MITToken:", mitTokenAddress);

  // ── Investor purchases ────────────────────────────────────────────────────
  console.log("\n── Investor purchases ──");
  const MITToken = await ethers.getContractFactory("MITToken");
  const mitToken = MITToken.attach(mitTokenAddress);

  const approveMITTx = await mitToken.approve(poolAddress, PRINCIPAL);
  await approveMITTx.wait();

  const approveUSDCTx = await usdc.approve(poolAddress, PRINCIPAL);
  await approveUSDCTx.wait();

  const buyATx = await pool.buyMIT(INVESTOR_A_AMOUNT);
  await buyATx.wait();
  console.log("      Bought 400,000 MIT-001 (Investor A) ✓  Tx:", buyATx.hash);

  const buyBTx = await pool.buyMIT(INVESTOR_B_AMOUNT);
  await buyBTx.wait();
  console.log("      Bought 600,000 MIT-001 (Investor B) ✓  Tx:", buyBTx.hash);

  // ── Period 1 repayment ────────────────────────────────────────────────────
  console.log("\n── Period 1 repayment ──");
  const schedule = await pool.getSchedule();
  const period1 = schedule[0];
  console.log("      Period 1 due:", ethers.formatUnits(period1.totalPayment, 6), "USDC");

  const approveRepayTx = await usdc.approve(poolAddress, period1.totalPayment);
  await approveRepayTx.wait();

  const repayTx = await pool.repay();
  await repayTx.wait();
  console.log("      Period 1 repaid ✓  Tx:", repayTx.hash);
  console.log("      Remaining principal:", ethers.formatUnits(await pool.outstandingPrincipal(), 6), "USDC");

  // ── Save deployment addresses ─────────────────────────────────────────────
  const deployment = {
    network: "fuji",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MockUSDC:     usdcAddress,
      DeedNFT:      deedNFTAddress,
      PoolFactory:  factoryAddress,
      PoolContract: poolAddress,
      MITToken:     mitTokenAddress,
      WADE:         wadeAddress,
      PledgeVault:  pledgeVaultAddress,
    }
  };

  fs.mkdirSync(path.join(__dirname, "../deployments"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "../deployments/latest.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║            DEPLOYMENT COMPLETE ✓                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\nMockUSDC:    ", usdcAddress);
  console.log("DeedNFT:     ", deedNFTAddress);
  console.log("PoolFactory: ", factoryAddress);
  console.log("PoolContract:", poolAddress);
  console.log("MITToken:    ", mitTokenAddress);
  console.log("WADE:        ", wadeAddress);
  console.log("PledgeVault: ", pledgeVaultAddress);
  console.log("\nSnowtrace:    https://testnet.snowtrace.io/address/" + poolAddress);
  console.log("\nAddresses saved to deployments/latest.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
