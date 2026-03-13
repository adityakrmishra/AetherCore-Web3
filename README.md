<h1 align="center">AetherCore-Web3</h1>

<p align="center">A full-stack, decentralized Anti-Gravity Staking protocol featuring a React user portal, Angular admin dashboard, and PHP/MySQL backend synced with Ethereum smart contracts.</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/Build-Passing-brightgreen.svg" alt="Build Status">
  <img src="https://img.shields.io/badge/Version-1.0.0-lightgrey.svg" alt="Version">
  <img src="https://img.shields.io/badge/Solidity-%5E0.8.0-363636.svg" alt="Solidity">
  <img src="https://img.shields.io/badge/React-18.2-61DAFB.svg" alt="React">
  <img src="https://img.shields.io/badge/Angular-17.3-DD0031.svg" alt="Angular">
  <img src="https://img.shields.io/badge/PHP-8.2-777BB4.svg" alt="PHP">
</p>

---

## Table of Contents
1. [About The Project](#about-the-project)
2. [Key Features](#key-features)
3. [Architecture & Tech Stack](#architecture--tech-stack)
4. [Getting Started & Installation](#getting-started--installation)
5. [Usage](#usage)
6. [Contributing, Support & License](#contributing-support--license)

---

## About The Project

AetherCore-Web3 is a comprehensive, local development Minimum Viable Product (MVP) for a decentralized finance (DeFi) staking ecosystem. The primary objective of this project is to create a seamless bridge between modern Web3 smart contracts and traditional Web2 backend infrastructure. 

The protocol allows users to connect their MetaMask wallets, register their accounts on-chain, and stake the native AntiGravityToken (AETH) to achieve varying tier statuses (Ignition, Ascent, Orbital, and Anti-Gravity). The project solves the complex challenge of state synchronization by utilizing a PHP backend and MySQL database to mirror on-chain events, providing an Angular-powered administrative dashboard alongside the React-based user portal.

---

## Key Features

* **Two-Step Staking Protocol:** Implements secure ERC20 token staking using a standard "Approve and Stake" flow directly through MetaMask.
* **Dynamic Tier System:** Automatically calculates user tiers based on staked AETH amounts, upgrading or downgrading users in real-time as they stake or unstake funds.
* **Hybrid Web3/Web2 Architecture:** Features a custom PHP webhook system that listens to Ethereum blockchain events and synchronizes pilot profiles with a relational MySQL database.
* **ethers.js v6 Integration:** Utilizes the latest ethers.js BrowserProvider and Signer APIs for robust wallet connection, chain validation, and contract interactions.
* **Dual Frontend Interfaces:** Includes an interactive React user portal for pilots and a structured Angular dashboard for protocol administrators.
* **Local Testing Infrastructure:** Fully configured to run a deterministic local Hardhat node, enabling rapid iteration and testing without requiring real Ethereum testnet funds.

---

## Architecture & Tech Stack

**Smart Contracts (Blockchain)**
* Solidity (v0.8.x)
* Hardhat Local Environment
* OpenZeppelin (ERC20, ReentrancyGuard, Ownable)

**Frontend (User Portal)**
* React.js (Vite)
* Tailwind CSS
* ethers.js (v6)

**Frontend (Admin Dashboard)**
* Angular (v17.3.17)
* TypeScript

**Backend & Infrastructure**
* PHP (v8.2)
* MySQL Database
* Docker & Docker Compose

---

## Getting Started & Installation

Follow these steps to set up the complete AetherCore-Web3 ecosystem on your local machine.

### Prerequisites
* Node.js (v18+)
* Docker Desktop
* MetaMask Browser Extension

### Step 1: Clone the Repository

    git clone https://github.com/adityakrmishra/AetherCore-Web3.git
    cd AetherCore-Web3

### Step 2: Boot up the Backend Infrastructure
Use Docker to spin up the PHP API and MySQL database.

    docker compose up -d --build

### Step 3: Start the Local Blockchain
Open a new terminal session, navigate to the blockchain directory, install dependencies, and start the Hardhat node. Keep this terminal running.

    cd blockchain
    npm install
    npx hardhat node

### Step 4: Deploy Smart Contracts
Open a new terminal session, navigate to the blockchain directory, and deploy the CoreProtocol and AntiGravityToken contracts.

    cd blockchain
    npx hardhat run scripts/deploy.js --network localhost

### Step 5: Launch the React User Portal
Open a final terminal session, navigate to the React frontend directory, install dependencies, and start the Vite development server.

    cd frontend-react
    npm install
    npm run dev

---

## Usage

### Connecting MetaMask
1. Open MetaMask and ensure "Show test networks" is enabled in the network settings.
2. Select the "Localhost 8545" network. Ensure the Chain ID is set to 31337.
3. Import the Hardhat Deployer Account (Account 0) into MetaMask using the private key provided in the Hardhat terminal to access the minted 10,000,000 AETH supply.

### Interacting with the Portal
1. Navigate to `http://localhost:5173` (or the port provided by Vite) in your browser.
2. Click **Connect Wallet** to link MetaMask to the application.
3. Click **Initialize Protocol** and confirm the transaction in MetaMask to register your pilot profile on-chain.
4. Once registered, enter a value (e.g., 5000) into the **Stake AETH** input field and click **Approve + Stake**.
5. Confirm the two sequential MetaMask prompts (one for token approval, one for the staking transaction).
6. Observe the UI update in real-time as your active tier promotes to "Tier II - Ascent".

---

## Contributing, Support & License

### Contributing Guidelines
Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

1. Fork the Project.
2. Create your Feature Branch:
    `git checkout -b feature/AmazingFeature`
3. Commit your Changes:
    `git commit -m 'Add some AmazingFeature'`
4. Push to the Branch:
    `git push origin feature/AmazingFeature`
5. Open a Pull Request.

### License
Distributed under the MIT License. See the `LICENSE` file for more information.