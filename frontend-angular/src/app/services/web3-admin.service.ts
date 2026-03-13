/**
 * =============================================================
 * AetherCore-Web3 | /frontend-angular/src/app/services/web3-admin.service.ts
 * Author  : AetherCore Team
 * Version : 1.0.0
 * =============================================================
 */

import { Injectable, signal } from '@angular/core';
import { ethers } from 'ethers';

// ── FIX: Tell TypeScript that MetaMask exists on the window object ──
declare global {
  interface Window {
    ethereum: any;
  }
}

import CoreProtocolArtifact from '../../assets/abi/CoreProtocol.json';
/** Supported chain IDs for the admin panel */
const SUPPORTED_CHAINS: Record<number, string> = {
  11155111: 'Sepolia',
  31337: 'Localhost',
};

/** CoreProtocol addresses per chain */
const CORE_ADDRESSES: Record<number, string> = {
  11155111: (import.meta as any).env?.['VITE_SEPOLIA_CORE_ADDRESS'] ?? '',
  31337: (import.meta as any).env?.['VITE_LOCAL_CORE_ADDRESS'] ?? '',
};

export enum AntiGravityTier { NONE, TIER_1, TIER_2, TIER_3, TIER_4 }

export interface ProtocolStats {
  totalStaked: string;
  totalPilots: number;
  isPaused: boolean;
}

@Injectable({ providedIn: 'root' })
export class Web3AdminService {

  readonly adminAddress = signal<string | null>(null);
  readonly chainId = signal<number | null>(null);
  readonly isBusy = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);
  readonly lastTxHash = signal<string | null>(null);

  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.Signer | null = null;
  private coreRead: ethers.Contract | null = null;
  private coreWrite: ethers.Contract | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.ethereum) {
      this.initProvider();
      this.registerWalletListeners();
    }
  }

  async connectAdminWallet(): Promise<void> {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed.');
    }
    this.lastError.set(null);
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await this.initProvider();
    } catch (err: any) {
      const msg = err.code === 4001
        ? 'Admin wallet connection rejected.'
        : (err.message ?? 'Unknown error during wallet connection.');
      this.lastError.set(msg);
      throw new Error(msg);
    }
  }

  async pauseProtocol(): Promise<ethers.TransactionReceipt> {
    return this.executeOwnerTx('pauseProtocol', []);
  }

  async unpauseProtocol(): Promise<ethers.TransactionReceipt> {
    return this.executeOwnerTx('unpauseProtocol', []);
  }

  async setTierThreshold(tier: AntiGravityTier, amountInAeth: string): Promise<ethers.TransactionReceipt> {
    if (tier < 1 || tier > 4) throw new Error('Invalid tier. Must be 1–4.');
    const amountWei = ethers.parseEther(amountInAeth);
    return this.executeOwnerTx('setTierThreshold', [tier, amountWei]);
  }

  async getProtocolStats(): Promise<ProtocolStats> {
    if (!this.coreRead) throw new Error('Contract not initialized.');
    const [totalStakedRaw, totalPilotsRaw, isPaused]: [bigint, bigint, boolean] =
      await this.coreRead['getProtocolStats']();
    return {
      totalStaked: ethers.formatEther(totalStakedRaw),
      totalPilots: Number(totalPilotsRaw),
      isPaused,
    };
  }

  get isConnected(): boolean {
    return !!this.adminAddress() && !!this.chainId();
  }

  get isCorrectNetwork(): boolean {
    const id = this.chainId();
    return id !== null && id in SUPPORTED_CHAINS;
  }

  get networkName(): string {
    return SUPPORTED_CHAINS[this.chainId() ?? 0] ?? 'Unknown';
  }

  private async initProvider(): Promise<void> {
    if (!window.ethereum) return;

    this.provider = new ethers.BrowserProvider(window.ethereum);

    const network = await this.provider.getNetwork();
    const cId = Number(network.chainId);
    this.chainId.set(cId);

    const accounts = await this.provider.listAccounts();

    if (accounts.length > 0) {
      this.signer = await this.provider.getSigner();
      this.adminAddress.set(await this.signer.getAddress());
    }

    const coreAddress = CORE_ADDRESSES[cId];
    if (coreAddress) {
      this.coreRead = new ethers.Contract(coreAddress, CoreProtocolArtifact.abi, this.provider);
      this.coreWrite = this.signer
        ? new ethers.Contract(coreAddress, CoreProtocolArtifact.abi, this.signer)
        : null;
    }
  }

  private async executeOwnerTx(fnName: string, args: unknown[]): Promise<ethers.TransactionReceipt> {
    if (!this.coreWrite) {
      throw new Error('Admin wallet not connected.');
    }
    this.isBusy.set(true);
    this.lastError.set(null);
    this.lastTxHash.set(null);

    try {
      const tx: ethers.TransactionResponse = await this.coreWrite[fnName](...args);
      this.lastTxHash.set(tx.hash);
      const receipt = await tx.wait();
      if (!receipt) throw new Error('Transaction receipt is null.');
      return receipt;
    } catch (err: any) {
      const msg = this.parseError(err);
      this.lastError.set(msg);
      throw new Error(msg);
    } finally {
      this.isBusy.set(false);
    }
  }

  private registerWalletListeners(): void {
    window.ethereum?.on('accountsChanged', () => window.location.reload());
    window.ethereum?.on('chainChanged', () => window.location.reload());
  }

  private parseError(err: any): string {
    if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
      return 'Transaction rejected by admin wallet.';
    }
    return err.reason ?? err.shortMessage ?? err.message ?? 'Unknown error.';
  }
}