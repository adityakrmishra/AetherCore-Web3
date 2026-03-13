<?php

/**
 * =============================================================
 *  AetherCore-Web3 | /backend-php/app/Routes/api.php
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  RESTful API router for all off-chain read operations.
 *  This file is the entry point for all HTTP API requests.
 *  It serves pilot profile data and leaderboard data to
 *  the React and Angular frontends.
 *
 *  AVAILABLE ENDPOINTS:
 *  ┌────────────────────────────────────────────────────────────┐
 *  │ GET  /api/pilot/{wallet}         → Single pilot profile   │
 *  │ GET  /api/leaderboard            → Top stakers (paginated)│
 *  │ GET  /api/stats                  → Protocol-wide stats    │
 *  │ GET  /api/pilot/{wallet}/history → Staking event log      │
 *  │ POST /api/register               → Register a new pilot   │
 *  └────────────────────────────────────────────────────────────┘
 *
 *  SECURITY:
 *  - All queries use PDO prepared statements (no SQL injection risk).
 *  - Wallet addresses are validated against a strict regex before
 *    being passed to any query.
 *  - CORS headers explicitly whitelist our known frontend origins.
 *  - No authentication required for read endpoints (public data
 *    mirrors the public blockchain). Write operations go through
 *    webhook_listener.php with signature verification.
 *
 *  WEB SERVER SETUP (Apache):
 *  Place this file at your document root and add a .htaccess:
 *    RewriteEngine On
 *    RewriteCond %{REQUEST_FILENAME} !-f
 *    RewriteRule ^ api.php [QSA,L]
 *
 *  WEB SERVER SETUP (Nginx):
 *    location /api/ {
 *        try_files $uri $uri/ /api.php?$query_string;
 *    }
 * =============================================================
 */

declare(strict_types=1);

// ── Bootstrap ──────────────────────────────────────────────────────────────────
// Load Composer autoloader and environment variables from .env
require_once __DIR__ . '/../../vendor/autoload.php';

use App\Models\Database;

// Load .env file (using vlucas/phpdotenv or similar)
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../../');
$dotenv->load();

// ── CORS Configuration ─────────────────────────────────────────────────────────
// Explicitly whitelisting known frontend origins prevents unauthorized
// cross-origin requests. Update this list when deploying to production domains.

$allowedOrigins = [
    'http://localhost:3000',    // React frontend (Create React App / Vite default)
    'http://localhost:5173',    // React frontend (Vite alternative port)
    'http://localhost:4200',    // Angular admin dashboard (ng serve default)
    'https://app.aethercore.io',   // Production React deployment
    'https://admin.aethercore.io', // Production Angular deployment
];

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (in_array($requestOrigin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: {$requestOrigin}");
} else {
    // For requests with no Origin (e.g., direct curl), allow without ACAO header.
    // This is safe because browsers always send Origin for cross-origin requests.
}

header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400'); // Cache preflight for 24 hours
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

// Handle CORS preflight requests (OPTIONS method)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); // No Content
    exit;
}

// ── Request Routing ─────────────────────────────────────────────────────────────

// Parse the request URI path, stripping query string and base prefix.
$requestUri  = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$requestUri  = rtrim($requestUri, '/');
$method      = $_SERVER['REQUEST_METHOD'];

// Only GET and POST requests are accepted on this router.
if (!in_array($method, ['GET', 'POST'], true)) {
    sendJson(['error' => 'Method not allowed.'], 405);
}

// ── Simple pattern-based router ────────────────────────────────────────────────
// Route: POST /api/register
if ($requestUri === '/api/register' && $method === 'POST') {
    handleRegisterPilot();

// Route: GET /api/pilot/{wallet}
} elseif (preg_match('#^/api/pilot/([^/]+)$#', $requestUri, $m) && $method === 'GET') {
    handleGetPilotProfile($m[1]);

// Route: GET /api/pilot/{wallet}/history
} elseif (preg_match('#^/api/pilot/([^/]+)/history$#', $requestUri, $m) && $method === 'GET') {
    handleGetPilotHistory($m[1]);

// Route: GET /api/leaderboard
} elseif ($requestUri === '/api/leaderboard' && $method === 'GET') {
    handleGetLeaderboard();

// Route: GET /api/stats
} elseif ($requestUri === '/api/stats' && $method === 'GET') {
    handleGetStats();

} else {
    sendJson(['error' => 'Endpoint not found.'], 404);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTE HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/register
 *
 * Registers a new pilot in the off-chain database.
 * Called by the React frontend immediately after the user connects
 * their MetaMask wallet. This is an off-chain "soft" registration —
 * the actual on-chain registration is triggered separately via
 * CoreProtocol.registerPilot().
 *
 * Request body (JSON):
 *   { "wallet_address": "0x..." }
 *
 * Response 200 (already registered):
 *   { "status": "exists", "message": "Pilot already registered." }
 *
 * Response 201 (newly created):
 *   { "status": "created", "wallet_address": "0x...", "message": "Pilot registered." }
 *
 * Response 400:
 *   { "error": "Invalid wallet address format." }
 */
function handleRegisterPilot(): void
{
    // Read and decode the raw JSON request body
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true);

    if (!is_array($body) || empty($body['wallet_address'])) {
        sendJson(['error' => 'Missing required field: wallet_address'], 400);
    }

    // Validate and normalise the wallet address
    $wallet = validateWalletAddress((string) $body['wallet_address']);

    $pdo = Database::connection();

    // Check whether this pilot already exists in the off-chain DB
    $checkStmt = $pdo->prepare(
        'SELECT wallet_address FROM pilot_profiles WHERE wallet_address = :wallet LIMIT 1'
    );
    $checkStmt->execute([':wallet' => $wallet]);
    $existing = $checkStmt->fetch();

    if ($existing) {
        // Idempotent — safe to call multiple times
        sendJson([
            'status'         => 'exists',
            'wallet_address' => $wallet,
            'message'        => 'Pilot already registered.',
        ], 200);
    }

    // Insert new pilot row with zero balances (on-chain state syncs via webhook)
    $insertStmt = $pdo->prepare(
        'INSERT INTO pilot_profiles
             (wallet_address, total_staked, active_tier, is_registered,
              total_lifetime_staked, last_action_at, created_at, updated_at)
         VALUES
             (:wallet, 0, 0, 0, 0, NOW(), NOW(), NOW())'
    );
    $insertStmt->execute([':wallet' => $wallet]);

    sendJson([
        'status'         => 'created',
        'wallet_address' => $wallet,
        'message'        => 'Pilot registered successfully.',
    ], 201);
}

/**
 * GET /api/pilot/{wallet}
 *
 * Returns the full off-chain profile for a single pilot.
 * Used by the React frontend to populate the user dashboard.
 *
 * Response 200:
 *   { "data": { "wallet_address": "0x...", "total_staked": "...", ... } }
 * Response 404:
 *   { "error": "Pilot not found." }
 *
 * @param string $wallet Raw wallet address from the URL segment.
 */
function handleGetPilotProfile(string $wallet): void
{
    $wallet = validateWalletAddress($wallet);

    $pdo  = Database::connection();
    $stmt = $pdo->prepare(
        "SELECT
            wallet_address,
            CAST(total_staked AS CHAR)          AS total_staked,
            active_tier,
            last_action_at,
            is_registered,
            CAST(total_lifetime_staked AS CHAR)  AS total_lifetime_staked,
            created_at,
            updated_at
         FROM pilot_profiles
         WHERE wallet_address = :wallet
         LIMIT 1"
    );
    $stmt->execute([':wallet' => $wallet]);
    $pilot = $stmt->fetch();

    if (!$pilot) {
        sendJson(['error' => 'Pilot not found.'], 404);
    }

    $pilot['tier_label'] = tierLabel((int) $pilot['active_tier']);
    sendJson(['data' => $pilot]);
}

/**
 * GET /api/pilot/{wallet}/history
 *
 * Returns the paginated staking event history for a single pilot.
 * Powers the "Activity Log" in the React user dashboard.
 *
 * Query params:
 *   ?page=1&limit=20
 *
 * @param string $wallet Raw wallet address from the URL segment.
 */
function handleGetPilotHistory(string $wallet): void
{
    $wallet = validateWalletAddress($wallet);

    // Pagination params — cast and bound for safety
    $page  = max(1, (int) ($_GET['page']  ?? 1));
    $limit = min(100, max(1, (int) ($_GET['limit'] ?? 20)));
    $offset = ($page - 1) * $limit;

    $pdo = Database::connection();

    // Total count query (for pagination metadata)
    $countStmt = $pdo->prepare(
        "SELECT COUNT(*) FROM staking_events WHERE wallet_address = :wallet"
    );
    $countStmt->execute([':wallet' => $wallet]);
    $total = (int) $countStmt->fetchColumn();

    // Data query — LIMIT and OFFSET are integers; safe to interpolate
    $dataStmt = $pdo->prepare(
        "SELECT
            event_type,
            CAST(amount AS CHAR)       AS amount,
            CAST(total_staked AS CHAR) AS total_staked,
            new_tier,
            tx_hash,
            block_number,
            created_at
         FROM staking_events
         WHERE wallet_address = :wallet
         ORDER BY block_number DESC
         LIMIT :limit OFFSET :offset"
    );
    $dataStmt->bindValue(':wallet', $wallet,  \PDO::PARAM_STR);
    $dataStmt->bindValue(':limit',  $limit,   \PDO::PARAM_INT);
    $dataStmt->bindValue(':offset', $offset,  \PDO::PARAM_INT);
    $dataStmt->execute();
    $events = $dataStmt->fetchAll();

    sendJson([
        'data'       => $events,
        'pagination' => [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int) ceil($total / $limit),
        ],
    ]);
}

/**
 * GET /api/leaderboard
 *
 * Returns top pilots sorted by current staked balance (descending).
 * Powers the leaderboard in both the React user dashboard and
 * the Angular admin analytics panel.
 *
 * Query params:
 *   ?page=1&limit=25&tier=2   (tier filter is optional)
 */
function handleGetLeaderboard(): void
{
    $page  = max(1, (int) ($_GET['page']  ?? 1));
    $limit = min(100, max(1, (int) ($_GET['limit'] ?? 25)));
    $offset = ($page - 1) * $limit;
    $tierFilter = isset($_GET['tier']) ? (int) $_GET['tier'] : null;

    $pdo = Database::connection();

    // Build WHERE clause dynamically (only if tier filter is provided)
    $where = 'WHERE is_registered = 1';
    $params = [];

    if ($tierFilter !== null && $tierFilter >= 0 && $tierFilter <= 4) {
        $where .= ' AND active_tier = :tier';
        $params[':tier'] = $tierFilter;
    }

    // Count total for pagination
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM pilot_profiles {$where}");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    // Leaderboard data
    $dataStmt = $pdo->prepare(
        "SELECT
            wallet_address,
            CAST(total_staked AS CHAR)          AS total_staked,
            active_tier,
            last_action_at,
            CAST(total_lifetime_staked AS CHAR)  AS total_lifetime_staked
         FROM pilot_profiles
         {$where}
         ORDER BY total_staked DESC
         LIMIT :limit OFFSET :offset"
    );

    foreach ($params as $k => $v) {
        $dataStmt->bindValue($k, $v);
    }
    $dataStmt->bindValue(':limit',  $limit,  \PDO::PARAM_INT);
    $dataStmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
    $dataStmt->execute();
    $pilots = $dataStmt->fetchAll();

    // Attach human-readable tier labels
    foreach ($pilots as &$p) {
        $p['tier_label'] = tierLabel((int) $p['active_tier']);
    }
    unset($p);

    sendJson([
        'data'       => $pilots,
        'pagination' => [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int) ceil($total / $limit),
        ],
    ]);
}

/**
 * GET /api/stats
 *
 * Returns aggregate protocol statistics.
 * Used by the Angular admin dashboard's top-level analytics panel.
 *
 * Response 200:
 *   { "data": { "total_pilots": 1234, "total_staked": "...", ... } }
 */
function handleGetStats(): void
{
    $pdo  = Database::connection();
    $stmt = $pdo->prepare(
        "SELECT
            COUNT(*)                              AS total_pilots,
            CAST(SUM(total_staked) AS CHAR)       AS total_staked,
            CAST(MAX(total_staked) AS CHAR)       AS max_single_stake,
            CAST(AVG(total_staked) AS CHAR)       AS avg_stake,
            SUM(active_tier = 1)                  AS tier_1_count,
            SUM(active_tier = 2)                  AS tier_2_count,
            SUM(active_tier = 3)                  AS tier_3_count,
            SUM(active_tier = 4)                  AS tier_4_count
         FROM pilot_profiles
         WHERE is_registered = 1"
    );
    $stmt->execute();
    $stats = $stmt->fetch();

    sendJson(['data' => $stats]);
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validates an Ethereum wallet address from user input.
 * Accepts only 0x-prefixed, 40-hex-char addresses (case-insensitive).
 * Returns the address lowercased for consistent DB lookups.
 *
 * @param  string $raw Raw input string.
 * @return string      Validated, lowercased address.
 */
function validateWalletAddress(string $raw): string
{
    $address = strtolower(trim($raw));
    if (!preg_match('/^0x[0-9a-f]{40}$/', $address)) {
        sendJson(['error' => 'Invalid wallet address format.'], 400);
    }
    return $address;
}

/**
 * Maps a numeric tier (matching the AntiGravityTier enum) to a human label.
 *
 * @param  int    $tier Numeric tier (0–4).
 * @return string Human-readable tier label.
 */
function tierLabel(int $tier): string
{
    return match ($tier) {
        1 => 'Tier 1 — Ignition',
        2 => 'Tier 2 — Ascent',
        3 => 'Tier 3 — Orbital',
        4 => 'Tier 4 — Anti-Gravity',
        default => 'Untiered',
    };
}

/**
 * Sends a JSON response and immediately exits.
 *
 * @param array $payload    The data to encode as JSON.
 * @param int   $statusCode HTTP status code (default: 200).
 */
function sendJson(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
