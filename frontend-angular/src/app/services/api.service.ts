/**
 * =============================================================
 *  AetherCore-Web3 | /frontend-angular/src/app/services/api.service.ts
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  Angular service that wraps all HTTP calls to the PHP backend
 *  (`/backend-php/app/Routes/api.php`). Provides typed, Observable-
 *  based methods for fetching off-chain analytics that power the
 *  Angular Admin Dashboard's data views.
 *
 *  ENDPOINTS CONSUMED:
 *  ┌───────────────────────────────────────────────────────────┐
 *  │ GET /api/leaderboard?page=&limit=&tier=  → Pilot list     │
 *  │ GET /api/pilot/{wallet}                  → Single pilot   │
 *  │ GET /api/pilot/{wallet}/history          → Event log      │
 *  │ GET /api/stats                           → Protocol stats │
 *  └───────────────────────────────────────────────────────────┘
 *
 *  REQUIRES:
 *  HttpClientModule imported in app.module.ts.
 *
 *  ENVIRONMENT:
 *  API base URL configured via `environment.ts` / `environment.prod.ts`.
 *  Set `apiBaseUrl` in the Angular environment files:
 *    development: 'http://localhost:8080'   (Docker php-backend port)
 *    production:  'https://api.aethercore.io'
 * =============================================================
 */

import { Injectable }     from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable }     from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { throwError }     from 'rxjs';
import { environment }    from '../../environments/environment';

// ── API Response Types ─────────────────────────────────────────────────────────

/** Mirrors the `pilot_profiles` MySQL table row */
export interface PilotProfile {
  wallet_address:         string;
  total_staked:           string;   // Stored as string — uint256 precision
  active_tier:            number;   // 0–4
  tier_label:             string;
  last_action_at:         number;   // Unix timestamp
  is_registered:          boolean;
  total_lifetime_staked:  string;
  created_at:             string;
  updated_at:             string;
}

/** Mirrors the `staking_events` MySQL table row */
export interface StakingEvent {
  event_type:    'STAKED' | 'UNSTAKED' | 'EMERGENCY_WITHDRAWAL';
  amount:        string;
  total_staked:  string;
  new_tier:      number;
  tx_hash:       string;
  block_number:  number;
  created_at:    string;
}

/** Protocol-wide aggregate statistics */
export interface ProtocolApiStats {
  total_pilots:      string;
  total_staked:      string;
  max_single_stake:  string;
  avg_stake:         string;
  tier_1_count:      string;
  tier_2_count:      string;
  tier_3_count:      string;
  tier_4_count:      string;
}

/** Generic paginated API response wrapper */
export interface PaginatedResponse<T> {
  data:       T[];
  pagination: {
    page:        number;
    limit:       number;
    total:       number;
    total_pages: number;
  };
}

/** Single-item API response wrapper */
export interface SingleResponse<T> {
  data: T;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ApiService {

  /** Base URL of the PHP API. Pulled from Angular environment config. */
  private readonly baseUrl: string = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  // ── Leaderboard ──────────────────────────────────────────────────────────────

  /**
   * Fetches the paginated pilot leaderboard sorted by staked amount.
   * Powers the main leaderboard table in the admin dashboard.
   *
   * @param page  Page number (1-indexed). Default: 1.
   * @param limit Results per page. Maximum: 100. Default: 25.
   * @param tier  Optional tier filter (0–4). Pass undefined to show all.
   * @returns     Observable of paginated PilotProfile array.
   */
  getLeaderboard(
    page  = 1,
    limit = 25,
    tier?: number
  ): Observable<PaginatedResponse<PilotProfile>> {
    let params = new HttpParams()
      .set('page',  page.toString())
      .set('limit', limit.toString());

    if (tier !== undefined && tier >= 0 && tier <= 4) {
      params = params.set('tier', tier.toString());
    }

    return this.http
      .get<PaginatedResponse<PilotProfile>>(`${this.baseUrl}/api/leaderboard`, { params })
      .pipe(catchError(this.handleError));
  }

  // ── Single Pilot Profile ─────────────────────────────────────────────────────

  /**
   * Fetches the off-chain profile for a single pilot by wallet address.
   * Used in the admin panel's "Pilot Lookup" feature.
   *
   * @param wallet  Ethereum wallet address (0x-prefixed, case-insensitive).
   * @returns       Observable of the pilot's PilotProfile.
   */
  getPilotProfile(wallet: string): Observable<PilotProfile> {
    return this.http
      .get<SingleResponse<PilotProfile>>(`${this.baseUrl}/api/pilot/${wallet.toLowerCase()}`)
      .pipe(
        map(res => res.data),
        catchError(this.handleError)
      );
  }

  // ── Pilot Staking History ─────────────────────────────────────────────────────

  /**
   * Fetches the paginated staking event history for a single pilot.
   * Powers the "Event History" expanded row in the admin table.
   *
   * @param wallet Ethereum wallet address.
   * @param page   Page number. Default: 1.
   * @param limit  Events per page. Default: 20.
   * @returns      Observable of paginated StakingEvent array.
   */
  getPilotHistory(
    wallet: string,
    page  = 1,
    limit = 20
  ): Observable<PaginatedResponse<StakingEvent>> {
    const params = new HttpParams()
      .set('page',  page.toString())
      .set('limit', limit.toString());

    return this.http
      .get<PaginatedResponse<StakingEvent>>(
        `${this.baseUrl}/api/pilot/${wallet.toLowerCase()}/history`,
        { params }
      )
      .pipe(catchError(this.handleError));
  }

  // ── Protocol Stats ────────────────────────────────────────────────────────────

  /**
   * Fetches aggregate protocol statistics.
   * Powers the KPI stats cards at the top of the admin dashboard.
   *
   * @returns Observable of ProtocolApiStats object.
   */
  getProtocolStats(): Observable<ProtocolApiStats> {
    return this.http
      .get<SingleResponse<ProtocolApiStats>>(`${this.baseUrl}/api/stats`)
      .pipe(
        map(res => res.data),
        catchError(this.handleError)
      );
  }

  // ── Error Handler ──────────────────────────────────────────────────────────────

  /**
   * Centralized HTTP error handler.
   * Logs the error and re-throws an Observable error with a user-friendly message.
   *
   * @param error The HTTP error response.
   */
  private handleError(error: any): Observable<never> {
    let message = 'An unknown API error occurred.';

    if (error.status === 0) {
      message = 'Cannot reach the AetherCore API. Is the PHP backend running?';
    } else if (error.status === 404) {
      message = error.error?.error ?? 'Resource not found.';
    } else if (error.status === 400) {
      message = error.error?.error ?? 'Bad request.';
    } else if (error.status >= 500) {
      message = 'Server error. Check the PHP backend logs.';
    }

    console.error('[ApiService]', error);
    return throwError(() => new Error(message));
  }
}
