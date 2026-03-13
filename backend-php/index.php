<?php
/**
 * AetherCore-Web3 | /backend-php/index.php
 * 
 * Web root entry point served by Apache at http://localhost:8080/
 * Clears the 403 Forbidden error and provides a health-check endpoint.
 *
 * API ROUTING:
 *   All /api/* requests are forwarded here by .htaccess via mod_rewrite,
 *   then dispatched to app/Routes/api.php.
 *
 *   Direct URL             → Handler
 *   ─────────────────────────────────────────────────
 *   GET /                  → JSON health check (this file)
 *   GET /api/pilot/{addr}  → app/Routes/api.php
 *   GET /api/leaderboard   → app/Routes/api.php
 *   GET /api/stats         → app/Routes/api.php
 *   POST /webhook          → webhook_listener.php
 */

declare(strict_types=1);

// ── CORS headers ──────────────────────────────────────────────────────────────
// Must be set HERE in the router (index.php) — this is the first script Apache
// executes. For preflight OPTIONS requests the browser never reaches api.php,
// so CORS headers set only inside api.php are invisible to the browser.
$allowedOrigins = [
    'http://localhost:3000',  // React (CRA / Vite port 3000)
    'http://localhost:5173',  // React (Vite default port)
    'http://localhost:4200',  // Angular
];
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($requestOrigin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: {$requestOrigin}");
} else {
    header('Access-Control-Allow-Origin: *'); // fallback for curl / direct access
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=utf-8');

// Handle CORS preflight — must exit here before ANY routing logic runs.
// The browser sends OPTIONS first to check permissions; if it doesn't get
// a 204 with the right Allow-Headers, it blocks the real POST request.
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Route dispatcher ──────────────────────────────────────────────────────────
$requestUri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$requestUri  = rtrim($requestUri, '/') ?: '/';

// Forward /api/* to the API router
if (str_starts_with($requestUri, '/api')) {
    require_once __DIR__ . '/app/Routes/api.php';
    exit;
}

// Forward /webhook to the webhook listener
if ($requestUri === '/webhook') {
    require_once __DIR__ . '/webhook_listener.php';
    exit;
}

// ── Root health check ─────────────────────────────────────────────────────────
// Visited at http://localhost:8080/ — confirms Apache + PHP are running.
$dbStatus = 'unchecked';

try {
    // Quick ping to confirm the MySQL container is reachable
    $host   = $_ENV['DB_HOST']     ?? getenv('DB_HOST')     ?? 'db';
    $port   = $_ENV['DB_PORT']     ?? getenv('DB_PORT')     ?? '3306';
    $dbName = $_ENV['DB_NAME']     ?? getenv('DB_NAME')     ?? 'aethercore_db';
    $user   = $_ENV['DB_USER']     ?? getenv('DB_USER')     ?? 'aethercore_user';
    $pass   = $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?? '';

    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$dbName};charset=utf8mb4",
        $user,
        $pass,
        [PDO::ATTR_TIMEOUT => 3]
    );
    $dbStatus = 'connected';
} catch (PDOException $e) {
    // Non-fatal — DB may still be initialising on first boot
    $dbStatus = 'unavailable (' . $e->getMessage() . ')';
}

http_response_code(200);
echo json_encode([
    'status'    => 'online',
    'service'   => 'AetherCore API',
    'version'   => '1.0.0',
    'timestamp' => date('c'),
    'database'  => $dbStatus,
    'endpoints' => [
        'GET  /api/pilot/{wallet}'         => 'Fetch pilot profile',
        'GET  /api/leaderboard'            => 'Top stakers',
        'GET  /api/stats'                  => 'Protocol statistics',
        'GET  /api/pilot/{wallet}/history' => 'Staking event history',
        'POST /webhook'                    => 'On-chain event listener',
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
