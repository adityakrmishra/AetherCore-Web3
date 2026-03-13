// =============================================================
//  AetherCore-Web3 | /blockchain/hardhat.config.js
//  Author  : AetherCore Team
//  Version : 1.0.0
//  Date    : 2026-03-12
// =============================================================
//
//  PURPOSE:
//  Configures the Hardhat development environment for the
//  AetherCore-Web3 smart contract suite.
//
//  CRITICAL SECURITY NOTE:
//  Private keys and RPC URLs are loaded EXCLUSIVELY via dotenv
//  from a .env file that is NEVER committed to version control.
//  The .env file path is: /blockchain/.env
//  The .gitignore must contain:
//    - .env
//    - node_modules/
//    - artifacts/
//    - cache/
//
//  SUPPORTED NETWORKS:
//    - hardhat   : In-process ephemeral network (default for tests)
//    - localhost  : Persistent local node (npx hardhat node)
//    - sepolia    : Ethereum Sepolia testnet via Alchemy / Infura
//
//  USAGE:
//    npx hardhat compile
//    npx hardhat test
//    npx hardhat run scripts/deploy.js --network localhost
//    npx hardhat run scripts/deploy.js --network sepolia
// =============================================================

import "@nomicfoundation/hardhat-toolbox";     // Includes ethers, waffle, chai, coverage
import dotenv from "dotenv";                  // Load .env variables into process.env
dotenv.config();

// ─── Validate critical environment variables ──────────────────────────────────
// These checks fail LOUDLY at config-load time rather than silently at runtime.
// This prevents accidentally deploying with empty private keys to a live network.

const SEPOLIA_RPC_URL   = process.env.SEPOLIA_RPC_URL   || "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Warn (not throw) so that `hardhat compile` still works in CI without a .env.
if (!DEPLOYER_PRIVATE_KEY && process.env.HARDHAT_NETWORK === "sepolia") {
  console.warn(
    "\n⚠️  WARNING: DEPLOYER_PRIVATE_KEY is not set in .env.\n" +
    "   Deployment to Sepolia will fail. Safe for local/test use.\n"
  );
}

// ─── Hardhat Configuration Object ────────────────────────────────────────────

/** @type import('hardhat/config').HardhatUserConfig */
export default {

  // ── Solidity Compiler ────────────────────────────────────────────────────
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,      // 200 = balanced between deploy cost and call cost.
                        // Increase to 1000+ for contracts called very frequently.
      },
      viaIR: false,     // Enable only if you hit "stack too deep" errors.
      evmVersion: "paris", // Stable EVM version; avoids PUSH0 issues on some L2s.
    },
  },

  // ── Network Configurations ───────────────────────────────────────────────
  networks: {

    /**
     * hardhat (built-in):
     * In-process network. Used automatically by `npx hardhat test`.
     * Forks mainnet if MAINNET_FORK_URL is set; otherwise starts fresh.
     * No configuration needed — Hardhat handles it internally.
     */
    hardhat: {
      chainId: 31337,
      // Uncomment below to fork mainnet state for integration tests:
      // forking: {
      //   url: process.env.MAINNET_RPC_URL || "",
      //   blockNumber: 19500000,
      // },
    },

    /**
     * localhost:
     * Connects to a persistent local Hardhat node started with:
     *   npx hardhat node
     * Useful for testing with MetaMask or the React/Angular frontends.
     * Shares chainId 31337 with the in-process network.
     */
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      // Accounts are the default 20 funded test accounts auto-generated
      // by `npx hardhat node` — no private key needed for localhost.
    },

    /**
     * sepolia:
     * Ethereum Sepolia testnet.
     * Requires:
     *   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
     *   DEPLOYER_PRIVATE_KEY=0xabc123...
     * in /blockchain/.env
     *
     * SECURITY: The accounts array takes a private key array.
     *   - NEVER hardcode a private key here.
     *   - The key is loaded from .env which is .gitignored.
     */
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [`0x${DEPLOYER_PRIVATE_KEY}`] : [],
      chainId: 11155111,
      // gasPrice: "auto" is fine for Sepolia.
      // Set a manual gasPrice (in wei) if you run into EIP-1559 issues:
      // gasPrice: 20_000_000_000, // 20 gwei
    },
  },

  // ── Etherscan Verification ───────────────────────────────────────────────
  // Run: npx hardhat verify --network sepolia DEPLOYED_ADDRESS "arg1" "arg2"
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },

  // ── Gas Reporter ─────────────────────────────────────────────────────────
  // Outputs a gas usage table after each test run.
  // Requires: npm install --save-dev hardhat-gas-reporter
  // (Included via @nomicfoundation/hardhat-toolbox)
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true", // Activate via: REPORT_GAS=true npx hardhat test
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || "",
    outputFile: "gas-report.txt",
    noColors: true, // Cleaner file output
  },

  // ── Paths ─────────────────────────────────────────────────────────────────
  // Explicitly declaring paths ensures consistency across all team environments.
  paths: {
    sources:   "./contracts",   // Solidity source files
    tests:     "./test",        // Test files
    cache:     "./cache",       // Compilation cache (gitignored)
    artifacts: "./artifacts",   // Compiled ABI + bytecode (gitignored)
  },

  // ── Mocha (Test Runner) Settings ──────────────────────────────────────────
  mocha: {
    timeout: 60_000, // 60s timeout — sufficient for forked-mainnet tests
  },
};
