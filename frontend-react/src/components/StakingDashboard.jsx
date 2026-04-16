/**
 * =============================================================
 * AetherCore-Web3 | src/components/StakingDashboard.jsx
 * Self-contained Web3 portal — owns provider, signer, and
 * all contract interactions directly. No context dependency.
 * =============================================================
 *
 * ADDRESSES: loaded from Vite environment variables (.env)
 * VITE_LOCAL_TOKEN_ADDRESS  — AntiGravityToken (localhost)
 * VITE_LOCAL_CORE_ADDRESS   — CoreProtocol      (localhost)
 *
 * ABIS: imported from /src/abi/ (copied from Hardhat artifacts)
 * AntiGravityToken.json
 * CoreProtocol.json
 *
 * STAKING FLOW (two-step):
 * 1. tokenContract.approve(coreAddress, amount)
 * 2. coreContract.stake(amount)
 * Both steps require a separate MetaMask confirmation.
 * =============================================================
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';

// ── ABI imports ────────────────────────────────────────────────────────────────
import AntiGravityTokenABI from '../abi/AntiGravityToken.json';
import CoreProtocolABI     from '../abi/CoreProtocol.json';

// ── Contract addresses from .env (PRODUCTION FIX) ──────────────────────────────
const TOKEN_ADDRESS = import.meta.env.VITE_LOCAL_TOKEN_ADDRESS || '';
const CORE_ADDRESS  = import.meta.env.VITE_LOCAL_CORE_ADDRESS  || '';
const ADMIN_URL     = import.meta.env.VITE_ADMIN_DASHBOARD_URL || 'http://localhost:4200';

// ── Backend API base URL ───────────────────────────────────────────────────────
// Reads from Vite env var if set, otherwise falls back to the Docker default.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

// ── Tier configuration ────────────────────────────────────────────────────────
const TIERS = {
  0: { label: 'Untiered',               threshold: '0',       badgeClass: 'text-slate-400 bg-slate-800 border-slate-700' },
  1: { label: 'Tier I — Ignition',      threshold: '1,000',   badgeClass: 'text-sky-300 bg-sky-950/60 border-sky-700/50' },
  2: { label: 'Tier II — Ascent',       threshold: '5,000',   badgeClass: 'text-violet-300 bg-violet-950/60 border-violet-700/50' },
  3: { label: 'Tier III — Orbital',     threshold: '25,000',  badgeClass: 'text-pink-300 bg-pink-950/60 border-pink-700/50' },
  4: { label: 'Tier IV — Anti-Gravity', threshold: '100,000', badgeClass: 'text-amber-300 bg-amber-950/60 border-amber-700/50' },
};

// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function StakingDashboard() {

  // ── Wallet / provider state ────────────────────────────────────────────────
  const [address,        setAddress]       = useState('');
  const [provider,       setProvider]      = useState(null);
  const [signer,         setSigner]        = useState(null);
  const [chainId,        setChainId]       = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // ── Contract instances ─────────────────────────────────────────────────────
  const [tokenRead,  setTokenRead]  = useState(null);
  const [tokenWrite, setTokenWrite] = useState(null);
  const [coreRead,   setCoreRead]   = useState(null);
  const [coreWrite,  setCoreWrite]  = useState(null);

  // ── On-chain data ──────────────────────────────────────────────────────────
  const [aethBalance,   setAethBalance]   = useState('0');
  const [stakedBalance, setStakedBalance] = useState('0');
  const [activeTier,    setActiveTier]    = useState(0);
  const [isRegistered,  setIsRegistered]  = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // ── Transaction state ──────────────────────────────────────────────────────
  const [stakeAmount,   setStakeAmount]   = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [txStep,        setTxStep]        = useState(null); // 'approving'|'staking'|'unstaking'|'registering'
  const [txHash,        setTxHash]        = useState(null);
  const [txError,       setTxError]       = useState(null);

  const isConnected = !!address;
  const isBusy      = txStep !== null;
  const tierInfo    = TIERS[activeTier] ?? TIERS[0];

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  // ════════════════════════════════════════════════════════════════════════════
  //  CONNECT WALLET
  //  Directly calls window.ethereum so the MetaMask popup fires immediately.
  // ════════════════════════════════════════════════════════════════════════════

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Please install it from metamask.io');
      return;
    }

    setIsConnecting(true);
    setTxError(null);
    console.log('[AetherCore] Requesting wallet accounts...');

    try {
      // Step 1: Request account access — triggers the MetaMask popup
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      console.log('[AetherCore] Accounts granted:', accounts);

      // Step 2: Wrap the injected provider with ethers.js (v6 API)
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const ethSigner       = await browserProvider.getSigner();
      const network         = await browserProvider.getNetwork();
      const walletAddress   = await ethSigner.getAddress();

      console.log('[AetherCore] Provider ready. Network:', network.name, '| ChainId:', Number(network.chainId));
      console.log('[AetherCore] Signer address:', walletAddress);

      // Step 3: Save provider / signer state
      setProvider(browserProvider);
      setSigner(ethSigner);
      setAddress(walletAddress);
      setChainId(Number(network.chainId));

      // Step 4: Instantiate contract instances
      const tRead  = new ethers.Contract(TOKEN_ADDRESS, AntiGravityTokenABI.abi, browserProvider);
      const tWrite = new ethers.Contract(TOKEN_ADDRESS, AntiGravityTokenABI.abi, ethSigner);
      const cRead  = new ethers.Contract(CORE_ADDRESS,  CoreProtocolABI.abi,     browserProvider);
      const cWrite = new ethers.Contract(CORE_ADDRESS,  CoreProtocolABI.abi,     ethSigner);

      setTokenRead(tRead);
      setTokenWrite(tWrite);
      setCoreRead(cRead);
      setCoreWrite(cWrite);

      console.log('[AetherCore] Contracts initialised. Token:', TOKEN_ADDRESS, '| Core:', CORE_ADDRESS);

      // Step 5: Register the wallet in the PHP off-chain database.
      // This is a "soft" registration that creates the pilot row — the
      // on-chain registerPilot() tx is a separate action the user triggers.
      await registerWithBackend(walletAddress);

    } catch (err) {
      if (err.code === 4001) {
        console.warn('[AetherCore] User rejected the connection request.');
        setTxError('Connection rejected. Please accept the MetaMask prompt.');
      } else {
        console.error('[AetherCore] connectWallet error:', err);
        setTxError(err.message || 'Failed to connect wallet.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  REGISTER WITH PHP BACKEND
  //  POSTs the wallet address to POST /api/register immediately after the
  //  user connects MetaMask. Idempotent — safe to call on every connect.
  // ════════════════════════════════════════════════════════════════════════════

  const registerWithBackend = async (walletAddress) => {
    const endpoint = `${API_BASE}/api/register`;
    console.log('[AetherCore] Registering wallet with backend:', endpoint);

    try {
      const response = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ wallet_address: walletAddress }),
      });

      const data = await response.json();
      console.log(`[AetherCore] Backend registration response (HTTP ${response.status}):`, data);

      if (!response.ok) {
        // Non-fatal — log the issue but don't block the UI
        console.warn('[AetherCore] Backend registration returned an error:', data);
      }
    } catch (err) {
      // Network error (e.g. Docker backend not running) — non-fatal
      console.error('[AetherCore] Could not reach PHP backend at', endpoint, ':', err.message);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  FETCH ON-CHAIN DATA
  // ════════════════════════════════════════════════════════════════════════════

  const fetchOnChainData = useCallback(async (isMounted = { current: true }) => {
    if (!address || !coreRead || !tokenRead) return;
    setIsLoadingData(true);
    console.log('[AetherCore] Fetching on-chain data for:', address);
    try {
      // Fetch AETH token balance — wraps in a safe try/catch for RPC timeouts
      let balance = 0n;
      try {
        balance = await tokenRead.balanceOf(address);
      } catch (e) {
        console.warn('[AetherCore] Could not fetch token balance. RPC might be unstable:', e);
      }
      
      if (!isMounted.current) return;
      setAethBalance(ethers.formatEther(balance));

      // getPilotProfile reverts / returns 0x if pilot is not registered on-chain.
      // Wrap in its own try/catch so an unregistered wallet doesn't crash the app.
      try {
        const profile    = await coreRead.getPilotProfile(address);
        const registered = profile.isRegistered ?? false;
        const tier       = registered ? Number(profile.activeTier) : 0;
        const staked     = registered ? ethers.formatEther(profile.totalStaked) : '0';

        if (!isMounted.current) return;
        setIsRegistered(registered);
        setActiveTier(tier);
        setStakedBalance(staked);
        console.log('[AetherCore] Profile:', { registered, tier, staked });
      } catch (profileErr) {
        // BAD_DATA (0x returned) or CALL_EXCEPTION — pilot not on-chain yet.
        console.log('[AetherCore] Pilot not registered on-chain yet. Showing registration screen.');
        if (!isMounted.current) return;
        setIsRegistered(false);
        setActiveTier(0);
        setStakedBalance('0');
      }
    } catch (err) {
      console.error('[AetherCore] fetchOnChainData fatal error:', err);
    } finally {
      if (isMounted.current) setIsLoadingData(false);
    }
  }, [address, coreRead, tokenRead]);

  useEffect(() => {
    const isMounted = { current: true };
    fetchOnChainData(isMounted);
    return () => {
      isMounted.current = false;
    };
  }, [fetchOnChainData]);

  // Listen for MetaMask account / chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = () => {
      console.log('[AetherCore] Accounts changed — reloading.');
      window.location.reload();
    };
    const onChainChanged = () => {
      console.log('[AetherCore] Chain changed — reloading.');
      window.location.reload();
    };
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged',    onChainChanged);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener('chainChanged',    onChainChanged);
    };
  }, []);

  // ════════════════════════════════════════════════════════════════════════════
  //  CONTRACT HANDLERS
  // ════════════════════════════════════════════════════════════════════════════

  const resetTx = () => { setTxError(null); setTxHash(null); };

  const handleRegister = async () => {
    if (!coreWrite) return;
    resetTx();
    setTxStep('registering');
    console.log('[AetherCore] Registering pilot...');
    try {
      const tx = await coreWrite.registerPilot();
      setTxHash(tx.hash);
      console.log('[AetherCore] Register tx sent:', tx.hash);
      await tx.wait();
      console.log('[AetherCore] Register tx confirmed.');
      await fetchOnChainData();
    } catch (err) {
      console.error('[AetherCore] handleRegister error:', err);
      setTxError(parseError(err));
    } finally {
      setTxStep(null);
    }
  };

  const handleStake = async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
      setTxError('Enter a valid AETH amount to stake.'); return;
    }
    if (!coreWrite || !tokenWrite) return;
    resetTx();

    const amountWei = ethers.parseEther(stakeAmount);
    console.log('[AetherCore] Staking', stakeAmount, 'AETH (', amountWei.toString(), 'wei)');

    try {
      // Step 1: Approve
      setTxStep('approving');
      console.log('[AetherCore] Approving CoreProtocol to spend', stakeAmount, 'AETH...');
      const approveTx = await tokenWrite.approve(CORE_ADDRESS, amountWei);
      setTxHash(approveTx.hash);
      console.log('[AetherCore] Approve tx sent:', approveTx.hash);
      await approveTx.wait();
      console.log('[AetherCore] Approve confirmed. Proceeding to stake...');

      // Step 2: Stake
      setTxStep('staking');
      const stakeTx = await coreWrite.stake(amountWei);
      setTxHash(stakeTx.hash);
      console.log('[AetherCore] Stake tx sent:', stakeTx.hash);
      await stakeTx.wait();
      console.log('[AetherCore] Stake confirmed.');

      setStakeAmount('');
      await fetchOnChainData();
    } catch (err) {
      console.error('[AetherCore] handleStake error:', err);
      setTxError(parseError(err));
    } finally {
      setTxStep(null);
    }
  };

  const handleUnstake = async () => {
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) {
      setTxError('Enter a valid AETH amount to unstake.'); return;
    }
    if (!coreWrite) return;
    resetTx();
    setTxStep('unstaking');
    console.log('[AetherCore] Unstaking', unstakeAmount, 'AETH...');
    try {
      const amountWei = ethers.parseEther(unstakeAmount);
      const tx = await coreWrite.unstake(amountWei);
      setTxHash(tx.hash);
      console.log('[AetherCore] Unstake tx sent:', tx.hash);
      await tx.wait();
      console.log('[AetherCore] Unstake confirmed.');
      setUnstakeAmount('');
      await fetchOnChainData();
    } catch (err) {
      console.error('[AetherCore] handleUnstake error:', err);
      setTxError(parseError(err));
    } finally {
      setTxStep(null);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Not connected
  // ════════════════════════════════════════════════════════════════════════════
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        {/* Ambient glow */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-md w-full glass-card p-10 space-y-8">
          {/* Logo */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl
                            bg-gradient-to-br from-violet-600/30 to-indigo-600/20
                            border border-violet-500/30 mx-auto">
              <span className="text-2xl font-bold text-gradient">AE</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">
                AetherCore <span className="text-gradient">Portal</span>
              </h1>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                Connect your wallet to access the Anti-Gravity Staking protocol.
              </p>
            </div>
          </div>

          {/* Error feedback */}
          {txError && (
            <div className="bg-rose-950/30 border border-rose-700/40 rounded-xl p-3">
              <p className="text-rose-300 text-sm">{txError}</p>
            </div>
          )}

          {/* Connect button — directly calls window.ethereum */}
          <button
            id="btn-connect-wallet"
            onClick={connectWallet}
            disabled={isConnecting}
            className="btn-primary w-full text-base py-4 glow-violet"
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>

          <p className="text-slate-600 text-xs text-center">
            Requires MetaMask browser extension
          </p>

          {/* Dev-mode address inspector */}
          {import.meta.env.DEV && (
            <div className="border-t border-slate-800 pt-4 space-y-1">
              <p className="text-slate-600 text-xs font-mono">
                TOKEN: {TOKEN_ADDRESS || '— not set in .env'}
              </p>
              <p className="text-slate-600 text-xs font-mono">
                CORE:  {CORE_ADDRESS  || '— not set in .env'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Wallet connected, pilot not registered
  // ════════════════════════════════════════════════════════════════════════════
  if (!isRegistered && !isLoadingData) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full glass-card p-10 space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">Initialize Protocol</h2>
            <p className="text-slate-400 text-sm font-mono">{shortAddress}</p>
            <p className="text-slate-400 text-sm">
              Register your wallet on-chain to enable staking.
            </p>
          </div>

          <TxFeedback isBusy={isBusy} txStep={txStep} txError={txError} txHash={txHash} />

          <button
            id="btn-register-pilot"
            onClick={handleRegister}
            disabled={isBusy}
            className="btn-primary w-full"
          >
            {isBusy ? 'Processing...' : 'Initialize Protocol'}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Main Dashboard
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Ambient glow blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute -top-60 -left-60 w-[500px] h-[500px] bg-violet-600/[0.06] rounded-full blur-3xl" />
        <div className="absolute top-1/2 -right-60 w-[400px] h-[400px] bg-indigo-600/[0.06] rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-[350px] h-[350px] bg-pink-600/[0.04] rounded-full blur-3xl" />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600
                            flex items-center justify-center font-bold text-xs shadow-lg shadow-violet-900/40">
              AE
            </div>
            <span className="font-bold text-lg tracking-tight">AetherCore</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            {activeTier > 0 && (
              <span className={`tier-badge ${tierInfo.badgeClass}`}>
                {tierInfo.label}
              </span>
            )}
            
            {/* Admin Dashboard Cross-Navigation */}
            <a href={ADMIN_URL} target="_blank" rel="noopener noreferrer" 
               className="text-xs font-semibold text-violet-400 hover:text-violet-300 border border-violet-500/30 bg-violet-900/20 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5">
               <span>🛠</span> Admin
            </a>

            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5
                            rounded-full border border-slate-700/50">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-slow shadow-sm shadow-green-400/50" />
              <span className="font-mono text-slate-300 text-xs">{shortAddress}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <main className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="AETH Balance"     value={fmt(aethBalance)}   unit="AETH"                              accent="violet" />
          <StatCard label="Currently Staked" value={fmt(stakedBalance)} unit="AETH"                              accent="indigo" />
          <StatCard label="Active Tier"      value={tierInfo.label}     unit={`Min. ${tierInfo.threshold} AETH`} accent="amber"  />
        </div>

        {/* Transaction feedback */}
        <TxFeedback isBusy={isBusy} txStep={txStep} txError={txError} txHash={txHash} />

        {/* Staking actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Stake */}
          <div className="glass-card p-6 space-y-4">
            <div>
              <h3 className="text-white font-bold text-lg">Stake AETH</h3>
              <p className="text-slate-400 text-sm mt-1">
                Two-step: approve token spend, then stake. Each step requires wallet confirmation.
              </p>
            </div>

            {(txStep === 'approving' || txStep === 'staking') && (
              <div className="flex items-center gap-3 text-xs">
                <ProgressStep label="Approve" active={txStep === 'approving'} done={txStep === 'staking'} />
                <div className="flex-1 h-px bg-slate-700" />
                <ProgressStep label="Stake"   active={txStep === 'staking'}   done={false} />
              </div>
            )}

            <div className="flex gap-2">
              <input
                id="input-stake-amount"
                type="number" min="0" placeholder="Amount in AETH"
                value={stakeAmount}
                onChange={e => setStakeAmount(e.target.value)}
                disabled={isBusy}
                className="input-dark flex-1"
              />
              <button
                id="btn-approve-stake"
                onClick={handleStake}
                disabled={isBusy || !stakeAmount}
                className="btn-primary whitespace-nowrap"
              >
                {isBusy && (txStep === 'approving' || txStep === 'staking')
                  ? 'Processing...'
                  : 'Approve + Stake'}
              </button>
            </div>
          </div>

          {/* Unstake */}
          <div className="glass-card p-6 space-y-4">
            <div>
              <h3 className="text-white font-bold text-lg">Unstake AETH</h3>
              <p className="text-slate-400 text-sm mt-1">
                Withdraw staked AETH at any time. Your tier will adjust accordingly.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                id="input-unstake-amount"
                type="number" min="0" placeholder="Amount in AETH"
                value={unstakeAmount}
                onChange={e => setUnstakeAmount(e.target.value)}
                disabled={isBusy}
                className="input-dark flex-1"
              />
              <button
                id="btn-unstake"
                onClick={handleUnstake}
                disabled={isBusy || !unstakeAmount}
                className="btn-danger whitespace-nowrap"
              >
                {txStep === 'unstaking' ? 'Processing...' : 'Unstake'}
              </button>
            </div>

            <p className="text-slate-600 text-xs">
              Currently staked:{' '}
              <span className="font-mono text-slate-400">{fmt(stakedBalance)} AETH</span>
            </p>
          </div>
        </div>

        {/* Tier progression map */}
        <div className="glass-card p-6">
          <h3 className="text-white font-bold text-lg mb-5">Tier Thresholds</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(t => {
              const cfg     = TIERS[t];
              const reached = activeTier >= t;
              return (
                <div key={t}
                  className={`rounded-xl p-4 border transition-all duration-300
                    ${reached
                      ? 'bg-slate-800/80 border-slate-600/60 shadow-lg'
                      : 'border-slate-800 bg-slate-900/40'}`}>
                  <p className={`text-xs font-semibold mb-1 truncate
                    ${reached ? cfg.badgeClass.split(' ')[0] : 'text-slate-600'}`}>
                    {cfg.label}
                  </p>
                  <p className={`font-mono text-sm font-bold ${reached ? 'text-white' : 'text-slate-700'}`}>
                    {cfg.threshold}
                    <span className={`text-xs font-normal ml-1 ${reached ? 'text-slate-400' : 'text-slate-700'}`}>
                      AETH
                    </span>
                  </p>
                  {reached && (
                    <p className="text-green-400 text-xs mt-1 font-medium">Active</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, unit, accent }) {
  const accentMap = {
    violet: 'from-violet-600/20 to-transparent border-violet-700/30',
    indigo: 'from-indigo-600/20 to-transparent border-indigo-700/30',
    amber:  'from-amber-600/20  to-transparent border-amber-700/30',
  };
  return (
    <div className={`stat-card bg-gradient-to-br ${accentMap[accent]}`}>
      <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="text-white text-2xl font-bold truncate mt-0.5">{value}</p>
      <p className="text-slate-600 text-xs mt-0.5">{unit}</p>
    </div>
  );
}

function ProgressStep({ label, active, done }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs transition-all
        ${done    ? 'bg-green-500 border-green-500 text-white'
          : active ? 'bg-violet-600 border-violet-600 text-white animate-pulse'
          :          'bg-slate-800 border-slate-700 text-slate-600'}`}>
        {done ? 'x' : ''}
      </div>
      <span className={`text-xs font-medium
        ${active ? 'text-violet-300' : done ? 'text-green-400' : 'text-slate-600'}`}>
        {label}
      </span>
    </div>
  );
}

function TxFeedback({ isBusy, txStep, txError, txHash }) {
  const STEP_LABELS = {
    approving:   'Step 1 of 2 — Approving AETH spend...',
    staking:     'Step 2 of 2 — Staking AETH...',
    unstaking:   'Unstaking AETH...',
    registering: 'Registering on-chain...',
  };

  if (!isBusy && !txError && !txHash) return null;

  return (
    <div className="space-y-2">
      {isBusy && (
        <div className="glass-card border-violet-700/30 bg-violet-950/20 p4 flex items-center gap-3 p-4">
          <div className="w-4 h-4 rounded-full border-2 border-violet-400 border-t-transparent animate-spin shrink-0" />
          <div className="min-w-0">
            <p className="text-violet-300 font-medium text-sm">{STEP_LABELS[txStep]}</p>
            {txHash && (
              <a href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank" rel="noreferrer"
                className="font-mono text-violet-400/60 text-xs hover:text-violet-300 transition-colors truncate block">
                {txHash.slice(0, 24)}... (Etherscan)
              </a>
            )}
          </div>
        </div>
      )}

      {txError && !isBusy && (
        <div className="glass-card border-rose-700/30 bg-rose-950/20 p-4">
          <p className="text-rose-300 font-medium text-sm">Transaction Failed</p>
          <p className="text-rose-400/70 text-xs mt-0.5">{txError}</p>
        </div>
      )}

      {txHash && !isBusy && !txError && (
        <div className="glass-card border-green-700/30 bg-green-950/20 p-4 flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-green-300 font-medium text-sm">Transaction Confirmed</p>
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-green-400/60 text-xs hover:text-green-300 transition-colors">
              View on Etherscan
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmt(raw) {
  const n = parseFloat(raw ?? '0');
  return isNaN(n) ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function parseError(err) {
  if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
    return 'Transaction cancelled — you rejected the wallet prompt.';
  }
  return err.reason ?? err.shortMessage ?? err.message ?? 'An unknown error occurred.';
}