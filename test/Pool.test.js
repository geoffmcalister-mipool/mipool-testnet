const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

/**
 * MiPool Protocol — Test Suite
 *
 * Covers the full pool lifecycle:
 *   1. Factory deploys pool
 *   2. Issuance Partner activates (Deed-NFT + MIT minted)
 *   3. Investors buy MITs
 *   4. Bank repays Period 1 → WADE distributes
 *   5. Bank repays all 12 periods → pool closes, Deed-NFT released
 */

describe("MiPool Protocol", function () {
  // ─── Fixture ──────────────────────────────────────────────────────────────
  async function deployFixture() {
    const [deployer, bank, issuancePartner, investorA, investorB, treasury] =
      await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy(deployer.address);

    // Fund wallets
    await usdc.faucet(bank.address,       ethers.parseUnits("2000000", 6));
    await usdc.faucet(investorA.address,  ethers.parseUnits("1000000", 6));
    await usdc.faucet(investorB.address,  ethers.parseUnits("1000000", 6));

    // Deploy DeedNFT
    const DeedNFT = await ethers.getContractFactory("DeedNFT");
    const deedNFT = await DeedNFT.deploy(deployer.address);

    // Deploy PoolFactory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const factory = await PoolFactory.deploy(
      await usdc.getAddress(),
      issuancePartner.address
    );
    await factory.whitelistBank(bank.address);

    return { usdc, deedNFT, factory, deployer, bank, issuancePartner, investorA, investorB, treasury };
  }

  // ─── Helper: Create + Activate pool ──────────────────────────────────────
  async function createAndActivatePool(fixture) {
    const { usdc, deedNFT, factory, deployer, bank, issuancePartner, treasury } = fixture;

    const PRINCIPAL        = ethers.parseUnits("1000000", 6);
    const COLLATERAL       = ethers.parseUnits("1500000", 6);
    const INTEREST_BPS     = 500;
    const TERM             = 12;
    const FEE_BPS          = 20;
    const DOCUMENT_CIDS    = ["ipfs://QmFacility", "ipfs://QmSecurity", "ipfs://QmDLD", "ipfs://QmLoanTape"];

    // 1. Bank creates pool
    const tx = await factory.connect(bank).createPool(
      "MIT-001", PRINCIPAL, INTEREST_BPS, TERM, COLLATERAL, FEE_BPS, DOCUMENT_CIDS
    );
    await tx.wait();

    const pools = await factory.getAllPools();
    const PoolContract = await ethers.getContractFactory("PoolContract");
    const pool = PoolContract.attach(pools[0]);

    // 2. Deploy WADE + PledgeVault
    const WADE = await ethers.getContractFactory("WADE");
    const wade = await WADE.deploy(
      await usdc.getAddress(), ethers.ZeroAddress, treasury.address, await pool.getAddress(), deployer.address
    );

    const PledgeVault = await ethers.getContractFactory("PledgeVault");
    const pledgeVault = await PledgeVault.deploy(await pool.getAddress(), bank.address, deployer.address);

    // Grant DeedNFT minter to pool
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await deedNFT.connect(deployer).grantRole(MINTER_ROLE, await pool.getAddress());

    // 3. Issuance Partner activates
    await pool.connect(issuancePartner).activatePool(
      await deedNFT.getAddress(), await pledgeVault.getAddress(), await wade.getAddress(),
      "ipfs://QmDeedMeta"
    );

    const MITToken = await ethers.getContractFactory("MITToken");
    const mitToken = MITToken.attach(await pool.mitToken());

    return { pool, wade, pledgeVault, mitToken, PRINCIPAL };
  }

  // ─── Tests ────────────────────────────────────────────────────────────────

  describe("PoolFactory", function () {
    it("Should deploy factory with correct config", async function () {
      const { factory, issuancePartner } = await loadFixture(deployFixture);
      expect(await factory.issuancePartner()).to.equal(issuancePartner.address);
      expect(await factory.totalPools()).to.equal(0);
    });

    it("Should allow whitelisted bank to create a pool", async function () {
      const fixture = await loadFixture(deployFixture);
      const { factory, bank } = fixture;

      await expect(
        factory.connect(bank).createPool(
          "MIT-001",
          ethers.parseUnits("1000000", 6),
          500, 12,
          ethers.parseUnits("1500000", 6),
          20,
          ["ipfs://QmDoc"]
        )
      ).to.emit(factory, "PoolCreated");

      expect(await factory.totalPools()).to.equal(1);
    });

    it("Should reject non-whitelisted bank", async function () {
      const { factory, investorA } = await loadFixture(deployFixture);
      await expect(
        factory.connect(investorA).createPool(
          "MIT-BAD", ethers.parseUnits("100000", 6), 500, 12,
          ethers.parseUnits("150000", 6), 20, []
        )
      ).to.be.reverted;
    });
  });

  describe("Pool Creation", function () {
    it("Should create pool in PENDING_ACTIVATION state", async function () {
      const fixture = await loadFixture(deployFixture);
      const { factory, bank } = fixture;

      await factory.connect(bank).createPool(
        "MIT-001", ethers.parseUnits("1000000", 6), 500, 12,
        ethers.parseUnits("1500000", 6), 20, []
      );

      const PoolContract = await ethers.getContractFactory("PoolContract");
      const pool = PoolContract.attach((await factory.getAllPools())[0]);

      expect(await pool.status()).to.equal(0); // PENDING_ACTIVATION
      expect(await pool.outstandingPrincipal()).to.equal(ethers.parseUnits("1000000", 6));
    });

    it("Should build amortisation schedule with 12 periods", async function () {
      const fixture = await loadFixture(deployFixture);
      const { factory, bank } = fixture;

      await factory.connect(bank).createPool(
        "MIT-001", ethers.parseUnits("1000000", 6), 500, 12,
        ethers.parseUnits("1500000", 6), 20, []
      );

      const PoolContract = await ethers.getContractFactory("PoolContract");
      const pool = PoolContract.attach((await factory.getAllPools())[0]);
      const schedule = await pool.getSchedule();

      expect(schedule.length).to.equal(12);
      
      // Verify principal sums to roughly the full amount
      const totalPrincipal = schedule.reduce((acc, p) => acc + p.principal, 0n);
      expect(totalPrincipal).to.be.closeTo(
        ethers.parseUnits("1000000", 6),
        ethers.parseUnits("10", 6) // within 10 USDC rounding
      );
    });
  });

  describe("Pool Activation", function () {
    it("Should activate pool and mint MIT tokens to bank", async function () {
      const fixture = await loadFixture(deployFixture);
      const { bank } = fixture;
      const { pool, mitToken, PRINCIPAL } = await createAndActivatePool(fixture);

      expect(await pool.status()).to.equal(1); // ACTIVE
      expect(await mitToken.totalSupply()).to.equal(PRINCIPAL);
      expect(await mitToken.balanceOf(bank.address)).to.equal(PRINCIPAL);
    });

    it("Should deposit Deed-NFT into PledgeVault", async function () {
      const fixture = await loadFixture(deployFixture);
      const { pledgeVault } = await createAndActivatePool(fixture);
      expect(await pledgeVault.isDeedHeld()).to.equal(true);
    });

    it("Should reject double activation", async function () {
      const fixture = await loadFixture(deployFixture);
      const { deedNFT } = fixture;
      const { pool } = await createAndActivatePool(fixture);

      const WADE = await ethers.getContractFactory("WADE");
      const wade2 = await WADE.deploy(
        await fixture.usdc.getAddress(), ethers.ZeroAddress,
        fixture.treasury.address, await pool.getAddress(), fixture.deployer.address
      );
      const PledgeVault = await ethers.getContractFactory("PledgeVault");
      const vault2 = await PledgeVault.deploy(
        await pool.getAddress(), fixture.bank.address, fixture.deployer.address
      );

      await expect(
        pool.connect(fixture.issuancePartner).activatePool(
          await deedNFT.getAddress(), await vault2.getAddress(),
          await wade2.getAddress(), "ipfs://test"
        )
      ).to.be.revertedWith("PoolContract: not pending activation");
    });
  });

  describe("MIT Purchase (Flow 3)", function () {
    it("Investor A should buy 400,000 MIT-001", async function () {
      const fixture = await loadFixture(deployFixture);
      const { investorA, bank } = fixture;
      const { pool, mitToken } = await createAndActivatePool(fixture);

      const buyAmount = ethers.parseUnits("400000", 6);
      await mitToken.connect(bank).approve(await pool.getAddress(), ethers.parseUnits("1000000", 6));
      await fixture.usdc.connect(investorA).approve(await pool.getAddress(), buyAmount);

      await pool.connect(investorA).buyMIT(buyAmount);

      expect(await mitToken.balanceOf(investorA.address)).to.equal(buyAmount);
    });

    it("Should reject purchase exceeding bank MIT balance", async function () {
      const fixture = await loadFixture(deployFixture);
      const { investorA, bank } = fixture;
      const { pool, mitToken } = await createAndActivatePool(fixture);

      const tooMuch = ethers.parseUnits("1100000", 6); // more than 1M pool
      await mitToken.connect(bank).approve(await pool.getAddress(), tooMuch);
      await fixture.usdc.connect(investorA).approve(await pool.getAddress(), tooMuch);

      await expect(pool.connect(investorA).buyMIT(tooMuch))
        .to.be.revertedWith("PoolContract: insufficient MIT available");
    });
  });

  describe("Repayment (Flow 4)", function () {
    it("Should process Period 1 repayment and reduce outstanding principal", async function () {
      const fixture = await loadFixture(deployFixture);
      const { bank, investorA, investorB } = fixture;
      const { pool, mitToken, PRINCIPAL } = await createAndActivatePool(fixture);

      // Investors buy all MITs
      const poolAddress = await pool.getAddress();
      await mitToken.connect(bank).approve(poolAddress, PRINCIPAL);
      await fixture.usdc.connect(investorA).approve(poolAddress, ethers.parseUnits("400000", 6));
      await fixture.usdc.connect(investorB).approve(poolAddress, ethers.parseUnits("600000", 6));
      await pool.connect(investorA).buyMIT(ethers.parseUnits("400000", 6));
      await pool.connect(investorB).buyMIT(ethers.parseUnits("600000", 6));

      // Bank repays Period 1
      const schedule = await pool.getSchedule();
      const period1 = schedule[0];
      await fixture.usdc.connect(bank).approve(poolAddress, period1.totalPayment);
      
      const principalBefore = await pool.outstandingPrincipal();
      await pool.connect(bank).repay();
      const principalAfter = await pool.outstandingPrincipal();

      expect(principalBefore - principalAfter).to.equal(period1.principal);
      expect(await pool.currentPeriod()).to.equal(1);
    });

    it("Should reject repayment by non-bank", async function () {
      const fixture = await loadFixture(deployFixture);
      const { investorA } = fixture;
      const { pool } = await createAndActivatePool(fixture);

      await expect(pool.connect(investorA).repay())
        .to.be.reverted;
    });
  });

  describe("Pool Closure", function () {
    it("Should close pool and release Deed-NFT after 12 repayments", async function () {
      const fixture = await loadFixture(deployFixture);
      const { bank, investorA, investorB } = fixture;
      const { pool, mitToken, pledgeVault, PRINCIPAL } = await createAndActivatePool(fixture);

      const poolAddress = await pool.getAddress();

      // Full subscription
      await mitToken.connect(bank).approve(poolAddress, PRINCIPAL);
      await fixture.usdc.connect(investorA).approve(poolAddress, ethers.parseUnits("400000", 6));
      await fixture.usdc.connect(investorB).approve(poolAddress, ethers.parseUnits("600000", 6));
      await pool.connect(investorA).buyMIT(ethers.parseUnits("400000", 6));
      await pool.connect(investorB).buyMIT(ethers.parseUnits("600000", 6));

      // Make all 12 repayments
      const schedule = await pool.getSchedule();
      for (let i = 0; i < 12; i++) {
        const payment = schedule[i].totalPayment;
        await fixture.usdc.connect(bank).approve(poolAddress, payment);
        await pool.connect(bank).repay();
      }

      // Pool should be REPAID
      expect(await pool.status()).to.equal(2); // REPAID
      expect(await pool.outstandingPrincipal()).to.equal(0);

      // Deed-NFT should be released from vault
      expect(await pledgeVault.isDeedHeld()).to.equal(false);
      expect(await pledgeVault.nftReleased()).to.equal(true);
    });
  });

  describe("MIT Token Whitelist", function () {
    it("Should reject transfer to non-whitelisted address", async function () {
      const fixture = await loadFixture(deployFixture);
      const { bank, investorA } = fixture;
      const { pool, mitToken, PRINCIPAL } = await createAndActivatePool(fixture);

      await mitToken.connect(bank).approve(await pool.getAddress(), PRINCIPAL);
      await fixture.usdc.connect(investorA).approve(await pool.getAddress(), ethers.parseUnits("100000", 6));
      await pool.connect(investorA).buyMIT(ethers.parseUnits("100000", 6));

      // Random non-whitelisted address
      const [,,,,,,randomUser] = await ethers.getSigners();

      await expect(
        mitToken.connect(investorA).transfer(randomUser.address, ethers.parseUnits("1000", 6))
      ).to.be.revertedWith("MITToken: recipient not whitelisted");
    });
  });
});
