// =============================================================
//  AetherCore-Web3 | /blockchain/scripts/deploy.js
//  Author  : AetherCore Team
//  Version : 1.0.0
//  Date    : 2026-03-12
// =============================================================
//
//  PURPOSE:
//  Deploys the full AetherCore-Web3 smart contract suite in
//  strict dependency order:
//    1. AntiGravityToken.sol  (ERC-20 token)
//    2. CoreProtocol.sol      (staking contract — receives token address)
//
//  This script is environment-aware. It reads the target network
//  from Hardhat CLI and adapts accordingly (local vs. Sepolia).
//
//  USAGE:
//    # Local persistent node (run `npx hardhat node` first):
//    npx hardhat run scripts/deploy.js --network localhost
//
//    # Sepolia testnet (requires .env with keys):
//    npx hardhat run scripts/deploy.js --network sepolia
//
//  OUTPUT:
//  On success, this script writes all deployed contract addresses
//  to deployments/<network>.json so the PHP backend, React frontend,
//  and Angular dashboard can import them at runtime without
//  hardcoding addresses anywhere.
//
//  POST-DEPLOY (Sepolia only):
//  Verify contracts on Etherscan:
//    npx hardhat verify --network sepolia <TOKEN_ADDRESS> "<DEPLOYER_ADDRESS>"
//    npx hardhat verify --network sepolia <CORE_ADDRESS> "<TOKEN_ADDRESS>" "<DEPLOYER_ADDRESS>"
// =============================================================

import pkg             from "hardhat";         // hardhat is CJS — import as default, then destructure
const { ethers, network } = pkg;
import fs                  from "fs";
import path                from "path";
import { fileURLToPath }   from "url";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Delay helper — used between deployments on live testnets to allow
 * the provider time to index the previous transaction before the next one.
 * Not needed on localhost (instant mining), but harmless to include.
 *
 * @param {number} ms - Milliseconds to wait.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Directory where deployed addresses are persisted as JSON files.
 * Path: /blockchain/deployments/<networkName>.json
 * This file is READ by:
 *   - /backend-php         → to set contract addresses in env/config
 *   - /frontend-react      → imported in Web3Context.jsx
 *   - /frontend-angular    → imported in environment.ts
 */
// ESM does not expose __dirname. Reconstruct it from import.meta.url:
//   import.meta.url  → file:///absolute/path/to/blockchain/scripts/deploy.js
//   fileURLToPath()  → /absolute/path/to/blockchain/scripts/deploy.js
//   path.dirname()   → /absolute/path/to/blockchain/scripts
//   path.join("..")  → /absolute/path/to/blockchain/deployments
const __filename      = fileURLToPath(import.meta.url);
const __dirname       = path.dirname(__filename);
const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

// ─── Main Deployment Function ─────────────────────────────────────────────────

/**
 * @notice Main entry point for the deployment script.
 * @dev Hardhat calls this function when the script is executed via the CLI.
 *      All deployment logic is encapsulated here to keep the top-level
 *      clean and enable easy unit testing of sub-functions.
 */
async function main() {
  // ── 1. Pre-flight Checks ──────────────────────────────────────────────────

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(  "║       AetherCore-Web3 — Deployment Script           ║");
  console.log(  "╚══════════════════════════════════════════════════════╝\n");

  // Retrieve the deployer account (first signer from hardhat.config.js accounts)
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  // Fetch deployer's balance for safety check
  const balance = await ethers.provider.getBalance(deployerAddress);
  const balanceInEth = ethers.formatEther(balance);

  console.log(`📡 Network        : ${network.name} (chainId: ${network.config.chainId ?? "N/A"})`);
  console.log(`👤 Deployer       : ${deployerAddress}`);
  console.log(`💰 Balance        : ${balanceInEth} ETH`);
  console.log("─".repeat(56));

  // Guard: refuse to deploy if the deployer has no funds (prevents wasted gas errors)
  if (parseFloat(balanceInEth) < 0.01 && network.name !== "hardhat") {
    throw new Error(
      `❌ Deployer balance too low (${balanceInEth} ETH). ` +
      `Please fund ${deployerAddress} before deploying to ${network.name}.`
    );
  }

  // ── 2. Deploy AntiGravityToken ────────────────────────────────────────────
  //
  //  MUST be deployed FIRST because its address is a required constructor
  //  argument for CoreProtocol.
  //
  //  Constructor args:
  //    _initialOwner → deployerAddress (the multisig / EOA running this script)

  console.log("\n🚀 Step 1/2 — Deploying AntiGravityToken...\n");

  const AntiGravityTokenFactory = await ethers.getContractFactory("AntiGravityToken");

  const antiGravityToken = await AntiGravityTokenFactory.deploy(
    deployerAddress // _initialOwner
  );

  // Wait for the deployment transaction to be mined (1 confirmation on live nets)
  await antiGravityToken.waitForDeployment();

  const tokenAddress = await antiGravityToken.getAddress();

  // Verify the initial supply was credited correctly (sanity check)
  const initialSupply = await antiGravityToken.totalSupply();
  const initialSupplyFormatted = ethers.formatEther(initialSupply);

  console.log(`   ✅ AntiGravityToken deployed!`);
  console.log(`   📍 Address       : ${tokenAddress}`);
  console.log(`   🪙 Initial Supply: ${initialSupplyFormatted} AETH`);
  console.log(`   👑 Owner         : ${deployerAddress}`);

  // Brief pause on live networks to let the RPC provider index the deployment
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\n   ⏳ Waiting 5s for network confirmation...\n");
    await delay(5000);
  }

  // ── 3. Deploy CoreProtocol ────────────────────────────────────────────────
  //
  //  Deployed SECOND so it can receive the AntiGravityToken address.
  //
  //  Constructor args:
  //    _aetherTokenAddress → tokenAddress (from Step 1)
  //    _initialOwner       → deployerAddress

  console.log("\n🚀 Step 2/2 — Deploying CoreProtocol...\n");

  const CoreProtocolFactory = await ethers.getContractFactory("CoreProtocol");

  const coreProtocol = await CoreProtocolFactory.deploy(
    tokenAddress,   // _aetherTokenAddress ← links the two contracts
    deployerAddress // _initialOwner
  );

  await coreProtocol.waitForDeployment();

  const coreAddress = await coreProtocol.getAddress();

  console.log(`   ✅ CoreProtocol deployed!`);
  console.log(`   📍 Address       : ${coreAddress}`);
  console.log(`   🔗 Token Linked  : ${tokenAddress}`);
  console.log(`   👑 Owner         : ${deployerAddress}`);

  // ── 4. Optional: Seed CoreProtocol with an Initial Rewards Pool ───────────
  //
  //  Transfers 500,000 AETH from the deployer to CoreProtocol.
  //  This seeds the contract with tokens for future reward distributions.
  //  Comment out if you want to fund the contract separately.
  //
  //  NOTE: In production, use a dedicated RewardsDistributor contract
  //  instead of funding CoreProtocol directly.

  const REWARDS_SEED_AMOUNT = ethers.parseEther("500000"); // 500,000 AETH

  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("\n💧 Seeding CoreProtocol with 500,000 AETH (local only)...");
    const seedTx = await antiGravityToken.transfer(coreAddress, REWARDS_SEED_AMOUNT);
    await seedTx.wait();
    console.log(`   ✅ Seed transfer complete. Tx: ${seedTx.hash}`);
  }

  // ── 5. Persist Deployed Addresses ────────────────────────────────────────
  //
  //  Writes a JSON file to /blockchain/deployments/<network>.json.
  //  All other project layers (frontend-react, frontend-angular, backend-php)
  //  import this file to resolve contract addresses at runtime.
  //  This avoids any hardcoded addresses in application code.

  const deploymentData = {
    network:            network.name,
    chainId:            network.config.chainId ?? null,
    deployedAt:         new Date().toISOString(),
    deployer:           deployerAddress,
    contracts: {
      AntiGravityToken: {
        address:  tokenAddress,
        args:     [deployerAddress],
      },
      CoreProtocol: {
        address:  coreAddress,
        args:     [tokenAddress, deployerAddress],
      },
    },
  };

  // Ensure the deployments directory exists
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const outputPath = path.join(DEPLOYMENTS_DIR, `${network.name}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));

  // ── 6. Final Summary ──────────────────────────────────────────────────────

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(  "║                 Deployment Complete ✅               ║");
  console.log(  "╚══════════════════════════════════════════════════════╝");
  console.log(`\n📄 Addresses saved to: deployments/${network.name}.json\n`);
  console.log("┌─────────────────────┬────────────────────────────────────────────┐");
  console.log("│ Contract            │ Address                                    │");
  console.log("├─────────────────────┼────────────────────────────────────────────┤");
  console.log(`│ AntiGravityToken    │ ${tokenAddress} │`);
  console.log(`│ CoreProtocol        │ ${coreAddress} │`);
  console.log("└─────────────────────┴────────────────────────────────────────────┘\n");

  // ── 7. Etherscan Verification Hint (Sepolia only) ─────────────────────────
  if (network.name === "sepolia") {
    console.log("📋 Next step — Verify contracts on Etherscan:");
    console.log(`   npx hardhat verify --network sepolia ${tokenAddress} "${deployerAddress}"`);
    console.log(`   npx hardhat verify --network sepolia ${coreAddress} "${tokenAddress}" "${deployerAddress}"\n`);
  }
}

// ─── Script Entry Point ────────────────────────────────────────────────────────
// Standard Hardhat pattern: run main() and handle errors gracefully.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:\n", error);
    process.exit(1);
  });
