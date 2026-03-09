require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const PRIVATE_KEY_DEPLOYER      = process.env.PRIVATE_KEY_DEPLOYER      || "0x" + "0".repeat(64);
const PRIVATE_KEY_BANK          = process.env.PRIVATE_KEY_BANK          || "0x" + "0".repeat(64);
const PRIVATE_KEY_ISSUANCE      = process.env.PRIVATE_KEY_ISSUANCE      || "0x" + "0".repeat(64);
const PRIVATE_KEY_INVESTOR_A    = process.env.PRIVATE_KEY_INVESTOR_A    || "0x" + "0".repeat(64);
const PRIVATE_KEY_INVESTOR_B    = process.env.PRIVATE_KEY_INVESTOR_B    || "0x" + "0".repeat(64);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
       evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    // ─── Local dev ─────────────────────────────────────────────────────────
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },

    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // ─── Avalanche Fuji Testnet ─────────────────────────────────────────────
    fuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: [
        PRIVATE_KEY_DEPLOYER,
        PRIVATE_KEY_BANK,
        PRIVATE_KEY_ISSUANCE,
        PRIVATE_KEY_INVESTOR_A,
        PRIVATE_KEY_INVESTOR_B,
      ],
      gasPrice: 25_000_000_000, // 25 gwei
    },

    // ─── Avalanche Mainnet (future) ─────────────────────────────────────────
    avalanche: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: [PRIVATE_KEY_DEPLOYER],
      gasPrice: 25_000_000_000,
    },
  },

  // Snowtrace verification (Avalanche's Etherscan)
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY || "",
      avalanche:            process.env.SNOWTRACE_API_KEY || "",
    },
    customChains: [
      {
        network: "avalancheFujiTestnet",
        chainId: 43113,
        urls: {
          apiURL:    "https://api-testnet.snowtrace.io/api",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
    ],
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};
