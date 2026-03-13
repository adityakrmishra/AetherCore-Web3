/**
 * =============================================================
 *  AetherCore-Web3 | /frontend-react/src/App.jsx
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  Root application component. Wraps the entire component tree
 *  with Web3Provider (blockchain connectivity) and sets up
 *  React Router for navigation between portal pages.
 *
 *  ROUTING:
 *    /           → StakingDashboard (primary user portal)
 *    *           → 404 redirect back to /
 * =============================================================
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Web3Provider } from './contexts/Web3Context';
import StakingDashboard from './components/StakingDashboard';

/**
 * @component App
 * @description Application root. All pages must be children of Web3Provider
 *              to access blockchain state via useWeb3().
 */
export default function App() {
  return (
    /*
     * Web3Provider must wrap the Router so that any route component
     * can call useWeb3() without "context is null" errors.
     */
    <Web3Provider>
      <BrowserRouter>
        <Routes>
          {/* Primary staking portal */}
          <Route path="/" element={<StakingDashboard />} />

          {/* Catch-all: redirect unknown routes to dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Web3Provider>
  );
}
