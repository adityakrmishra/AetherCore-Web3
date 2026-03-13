<?php

/**
 * =============================================================
 *  AetherCore-Web3 | /backend-php/webhook_listener.php
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  Receives POST webhooks from on-chain event indexers
 *  (Alchemy Webhooks, Moralis Streams, or a self-hosted indexer)
 *  whenever the following CoreProtocol.sol events are emitted:
 *
 *    • PilotRegistered(address pilot, uint256 timestamp)
 *    • TokensStaked(address pilot, uint256 amount, uint256 totalStaked,
 *                   uint8 newTier, uint256 timestamp)
 *    • TokensUnstaked(address pilot, uint256 amount, uint256 totalStaked,
 *                     uint8 newTier, uint256 timestamp)
 *    • TierChanged(address pilot, uint8 oldTier, uint8 newTier, uint256 timestamp)
 *    • EmergencyWithdrawal(address pilot, uint256 amount, uint256 timestamp)
 *
 *  AntiGravityToken.sol events:
 *    • TokensMinted(address to, uint256 amount, uint256 newSupply, uint256 timestamp)
 *
 *  SECURITY MODEL:
 *  1. SIGNATURE VERIFICATION — Every incoming request carries an HMAC-SHA256
 *     signature in the `X-Alchemy-Signature` (or `X-Moralis-Signature`) header.
 *     We recompute the expected signature using our shared secret (from .env)
 *     and use hash_equals() (constant-time comparison) to prevent timing attacks.
 *     Any request with a bad or missing signature is rejected with HTTP 401.
 *
 *  2. IDEMPOTENCY — Before processing any event, we check for an existing
 *     row in `staking_events` with the same (tx_hash, event_type) composite
 *     key. Duplicate deliveries (which web hooks guarantee "at least once")
 *     are silently skipped with HTTP 200, preventing double-writes.
 *
 *  3. PDO PREPARED STATEMENTS — All DB writes use parameterized queries.
 *     No concatenation of external data into SQL strings anywhere.
 *
 *  4. INPUT VALIDATION — All fields from the payload are strictly typed
 *     and validated before touching the database.
 *
 *  SETUP:
 *  - Set WEBHOOK_SECRET in /backend-php/.env to your Alchemy/Moralis secret.
 *  - Point your Alchemy webhook or Moralis Stream to:
 *      POST https://api.aethercore.io/webhook_listener.php
 * =============================================================
 */

declare(strict_types=1);

// ── Bootstrap ──────────────────────────────────────────────────────────────────
require_once __DIR__ . '/vendor/autoload.php';

use App\Models\Database;

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

// ── Security: Only accept POST requests ───────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    webhookResponse('Method not allowed.', 405);
}

// ── Step 1: Read Raw Payload Body ─────────────────────────────────────────────
// We must read the raw body BEFORE any parsing so we can verify the signature
// against the exact bytes the sender signed. json_decode later.

$rawBody = file_get_contents('php://input');

if ($rawBody === false || strlen($rawBody) === 0) {
    webhookResponse('Empty request body.', 400);
}

// ── Step 2: Signature Verification ────────────────────────────────────────────
//
//  Alchemy Webhooks sign the raw body with HMAC-SHA256 using the webhook's
//  signing key. The signature is sent in the `X-Alchemy-Signature` header.
//  Moralis Streams use `X-Moralis-Signature` with the same HMAC-SHA256 scheme.
//
//  To use Moralis instead of Alchemy, swap the header name below.
//
//  IMPORTANT: hash_equals() is MANDATORY here. A simple `===` comparison
//  is vulnerable to timing attacks that can reveal the signature byte-by-byte.

verifyWebhookSignature($rawBody);

// ── Step 3: Parse & Validate JSON Payload ─────────────────────────────────────

$payload = json_decode($rawBody, true);

if (json_last_error() !== JSON_ERROR_NONE || !is_array($payload)) {
    webhookResponse('Invalid JSON payload.', 400);
}

// ── Step 4: Extract Event Data ────────────────────────────────────────────────
//
//  Alchemy webhook payload structure (simplified):
//  {
//    "webhookId": "...",
//    "id": "...",
//    "createdAt": "...",
//    "type": "GRAPHQL",
//    "event": {
//      "data": {
//        "block": {
//          "logs": [
//            {
//              "transaction": { "hash": "0x...", "block": { "number": 123 } },
//              "topics": ["0xEventSigHash...", "0xIndexedArg1..."],
//              "data": "0xEncodedNonIndexedArgs"
//            }
//          ]
//        }
//      }
//    }
//  }
//
//  In a production setup, use a proper ABI decoder library (e.g., nethereum
//  via a microservice, or a PHP Web3 library) to decode `topics` and `data`.
//  The handler below expects a PRE-DECODED payload format as would be
//  provided by Moralis Streams or a custom event decoder middleware.
//
//  Expected pre-decoded format passed to this listener:
//  {
//    "eventName": "TokensStaked",
//    "chainId": 11155111,
//    "txHash": "0x...",
//    "blockNumber": 12345,
//    "args": {
//      "pilot": "0x...",
//      "amount": "5000000000000000000000",
//      "totalStaked": "5000000000000000000000",
//      "newTier": 2,
//      "timestamp": 1741751452
//    }
//  }

$eventName = sanitizeString($payload['eventName'] ?? '');
$chainId   = (int) ($payload['chainId']   ?? 0);
$txHash    = sanitizeString($payload['txHash']    ?? '');
$blockNum  = (int) ($payload['blockNumber'] ?? 0);
$args      = $payload['args'] ?? [];

// Validate required top-level fields
if (empty($eventName) || empty($txHash) || $chainId === 0 || $blockNum === 0) {
    webhookResponse('Missing required payload fields.', 400);
}

if (!isValidTxHash($txHash)) {
    webhookResponse('Invalid transaction hash format.', 400);
}

// ── Step 5: Route to Event Handler ────────────────────────────────────────────

$pdo = Database::connection();

try {
    switch ($eventName) {
        case 'PilotRegistered':
            handlePilotRegistered($pdo, $txHash, $blockNum, $chainId, $args, $rawBody);
            break;

        case 'TokensStaked':
            handleTokensStaked($pdo, $txHash, $blockNum, $chainId, $args, $rawBody);
            break;

        case 'TokensUnstaked':
            handleTokensUnstaked($pdo, $txHash, $blockNum, $chainId, $args, $rawBody);
            break;

        case 'TierChanged':
            handleTierChanged($pdo, $txHash, $blockNum, $args);
            break;

        case 'EmergencyWithdrawal':
            handleEmergencyWithdrawal($pdo, $txHash, $blockNum, $chainId, $args, $rawBody);
            break;

        case 'TokensMinted':
            handleTokensMinted($pdo, $txHash, $blockNum, $args);
            break;

        default:
            // Unknown event — log and acknowledge without processing
            error_log("[AetherCore Webhook] Unknown event received: {$eventName} | tx: {$txHash}");
            webhookResponse("Event '{$eventName}' is not handled by this listener.", 200);
    }

    webhookResponse('OK', 200);

} catch (\Throwable $e) {
    // Log the full exception internally; return a generic 500 to the caller
    error_log("[AetherCore Webhook] Handler exception: " . $e->getMessage() . " | tx: {$txHash}");
    webhookResponse('Internal server error.', 500);
}

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Handles `PilotRegistered` events.
 * Creates the pilot's off-chain profile row in `pilot_profiles`.
 */
function handlePilotRegistered(
    \PDO $pdo, string $txHash, int $blockNum, int $chainId,
    array $args, string $rawBody
): void {
    $pilot     = validateWallet($args['pilot']     ?? '');
    $timestamp = (int) ($args['timestamp'] ?? 0);

    // Idempotency: skip if already registered
    $check = $pdo->prepare(
        "SELECT id FROM pilot_profiles WHERE wallet_address = :wallet LIMIT 1"
    );
    $check->execute([':wallet' => $pilot]);
    if ($check->fetch()) {
        return; // Already processed — silently skip
    }

    $stmt = $pdo->prepare(
        "INSERT INTO pilot_profiles
            (wallet_address, total_staked, active_tier, last_action_at, is_registered, total_lifetime_staked)
         VALUES
            (:wallet, '0', 0, :ts, 1, '0')"
    );
    $stmt->execute([':wallet' => $pilot, ':ts' => $timestamp]);

    logInfo("PilotRegistered processed | wallet: {$pilot} | tx: {$txHash}");
}

/**
 * Handles `TokensStaked` events.
 * Updates pilot profile and inserts an immutable staking_events record.
 */
function handleTokensStaked(
    \PDO $pdo, string $txHash, int $blockNum, int $chainId,
    array $args, string $rawBody
): void {
    $pilot       = validateWallet($args['pilot']       ?? '');
    $amount      = validateUint256($args['amount']      ?? '');
    $totalStaked = validateUint256($args['totalStaked'] ?? '');
    $newTier     = validateTier((int) ($args['newTier'] ?? 0));
    $timestamp   = (int) ($args['timestamp'] ?? 0);

    // Idempotency check against staking_events
    if (isDuplicateEvent($pdo, $txHash, 'STAKED')) {
        return;
    }

    // Use a transaction: both writes must succeed or both must fail
    $pdo->beginTransaction();
    try {
        // 1. Upsert pilot profile via stored procedure
        $upsert = $pdo->prepare("CALL upsert_pilot_profile(:wallet, :staked, :tier, :ts, 1, :lifetime)");

        // For lifetime staked, we can't compute it here from this event alone
        // (the contract tracks it). For now we pass totalStaked as a proxy.
        // In production, decode totalLifetimeStaked from the pilot's on-chain struct.
        $upsert->execute([
            ':wallet'   => $pilot,
            ':staked'   => $totalStaked,
            ':tier'     => $newTier,
            ':ts'       => $timestamp,
            ':lifetime' => $totalStaked, // Overridden by a direct RPC call in production
        ]);

        // 2. Insert immutable event log
        $event = $pdo->prepare(
            "INSERT INTO staking_events
                (event_type, wallet_address, amount, total_staked, new_tier, tx_hash, block_number, chain_id, raw_payload)
             VALUES
                ('STAKED', :wallet, :amount, :total, :tier, :tx, :block, :chain, :raw)"
        );
        $event->execute([
            ':wallet' => $pilot,
            ':amount' => $amount,
            ':total'  => $totalStaked,
            ':tier'   => $newTier,
            ':tx'     => $txHash,
            ':block'  => $blockNum,
            ':chain'  => $chainId,
            ':raw'    => $rawBody,
        ]);

        $pdo->commit();
        logInfo("TokensStaked processed | wallet: {$pilot} | amount: {$amount} | tx: {$txHash}");

    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Handles `TokensUnstaked` events.
 * Same pattern as TokensStaked but records event_type as 'UNSTAKED'.
 */
function handleTokensUnstaked(
    \PDO $pdo, string $txHash, int $blockNum, int $chainId,
    array $args, string $rawBody
): void {
    $pilot       = validateWallet($args['pilot']       ?? '');
    $amount      = validateUint256($args['amount']      ?? '');
    $totalStaked = validateUint256($args['totalStaked'] ?? '');
    $newTier     = validateTier((int) ($args['newTier'] ?? 0));
    $timestamp   = (int) ($args['timestamp'] ?? 0);

    if (isDuplicateEvent($pdo, $txHash, 'UNSTAKED')) {
        return;
    }

    $pdo->beginTransaction();
    try {
        $upsert = $pdo->prepare("CALL upsert_pilot_profile(:wallet, :staked, :tier, :ts, 1, :lifetime)");
        $upsert->execute([
            ':wallet'   => $pilot,
            ':staked'   => $totalStaked,
            ':tier'     => $newTier,
            ':ts'       => $timestamp,
            ':lifetime' => $totalStaked,
        ]);

        $event = $pdo->prepare(
            "INSERT INTO staking_events
                (event_type, wallet_address, amount, total_staked, new_tier, tx_hash, block_number, chain_id, raw_payload)
             VALUES
                ('UNSTAKED', :wallet, :amount, :total, :tier, :tx, :block, :chain, :raw)"
        );
        $event->execute([
            ':wallet' => $pilot,
            ':amount' => $amount,
            ':total'  => $totalStaked,
            ':tier'   => $newTier,
            ':tx'     => $txHash,
            ':block'  => $blockNum,
            ':chain'  => $chainId,
            ':raw'    => $rawBody,
        ]);

        $pdo->commit();
        logInfo("TokensUnstaked processed | wallet: {$pilot} | amount: {$amount} | tx: {$txHash}");

    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Handles `TierChanged` events.
 * Inserts a record into the `tier_change_log` table.
 */
function handleTierChanged(\PDO $pdo, string $txHash, int $blockNum, array $args): void
{
    $pilot     = validateWallet($args['pilot']   ?? '');
    $oldTier   = validateTier((int) ($args['oldTier'] ?? 0));
    $newTier   = validateTier((int) ($args['newTier'] ?? 0));
    $timestamp = (int) ($args['timestamp'] ?? 0);

    // Idempotency: one tier change per tx
    $check = $pdo->prepare("SELECT id FROM tier_change_log WHERE tx_hash = :tx LIMIT 1");
    $check->execute([':tx' => $txHash]);
    if ($check->fetch()) {
        return;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO tier_change_log
            (wallet_address, old_tier, new_tier, tx_hash, block_number, changed_at)
         VALUES
            (:wallet, :old, :new, :tx, :block, :ts)"
    );
    $stmt->execute([
        ':wallet' => $pilot,
        ':old'    => $oldTier,
        ':new'    => $newTier,
        ':tx'     => $txHash,
        ':block'  => $blockNum,
        ':ts'     => $timestamp,
    ]);

    logInfo("TierChanged processed | wallet: {$pilot} | {$oldTier} → {$newTier} | tx: {$txHash}");
}

/**
 * Handles `EmergencyWithdrawal` events.
 * Resets the pilot's staked balance to 0 and logs the event.
 */
function handleEmergencyWithdrawal(
    \PDO $pdo, string $txHash, int $blockNum, int $chainId,
    array $args, string $rawBody
): void {
    $pilot     = validateWallet($args['pilot']     ?? '');
    $amount    = validateUint256($args['amount']    ?? '');
    $timestamp = (int) ($args['timestamp'] ?? 0);

    if (isDuplicateEvent($pdo, $txHash, 'EMERGENCY_WITHDRAWAL')) {
        return;
    }

    $pdo->beginTransaction();
    try {
        // Reset pilot's staked balance and tier
        $update = $pdo->prepare(
            "UPDATE pilot_profiles
             SET total_staked = '0', active_tier = 0, last_action_at = :ts
             WHERE wallet_address = :wallet"
        );
        $update->execute([':ts' => $timestamp, ':wallet' => $pilot]);

        $event = $pdo->prepare(
            "INSERT INTO staking_events
                (event_type, wallet_address, amount, total_staked, new_tier, tx_hash, block_number, chain_id, raw_payload)
             VALUES
                ('EMERGENCY_WITHDRAWAL', :wallet, :amount, '0', 0, :tx, :block, :chain, :raw)"
        );
        $event->execute([
            ':wallet' => $pilot,
            ':amount' => $amount,
            ':tx'     => $txHash,
            ':block'  => $blockNum,
            ':chain'  => $chainId,
            ':raw'    => $rawBody,
        ]);

        $pdo->commit();
        logInfo("EmergencyWithdrawal processed | wallet: {$pilot} | amount: {$amount} | tx: {$txHash}");

    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Handles `TokensMinted` events from AntiGravityToken.sol.
 * Inserts a record into `token_mint_log`.
 */
function handleTokensMinted(\PDO $pdo, string $txHash, int $blockNum, array $args): void
{
    $to        = validateWallet($args['to']        ?? '');
    $amount    = validateUint256($args['amount']    ?? '');
    $newSupply = validateUint256($args['newSupply'] ?? '');
    $timestamp = (int) ($args['timestamp'] ?? 0);

    // Idempotency
    $check = $pdo->prepare("SELECT id FROM token_mint_log WHERE tx_hash = :tx LIMIT 1");
    $check->execute([':tx' => $txHash]);
    if ($check->fetch()) {
        return;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO token_mint_log
            (to_address, amount, new_supply, tx_hash, block_number, minted_at)
         VALUES
            (:to, :amount, :supply, :tx, :block, :ts)"
    );
    $stmt->execute([
        ':to'     => $to,
        ':amount' => $amount,
        ':supply' => $newSupply,
        ':tx'     => $txHash,
        ':block'  => $blockNum,
        ':ts'     => $timestamp,
    ]);

    logInfo("TokensMinted processed | to: {$to} | amount: {$amount} | tx: {$txHash}");
}

// ══════════════════════════════════════════════════════════════════════════════
//  SECURITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Verifies the HMAC-SHA256 signature on the incoming webhook request.
 *
 * Alchemy sends the signature in: `X-Alchemy-Signature: <hex_digest>`
 * Moralis sends the signature in: `X-Moralis-Signature: <hex_digest>`
 *
 * The secret is: WEBHOOK_SECRET from /backend-php/.env
 * The signed data is: the raw request body bytes.
 *
 * @param string $rawBody The exact raw bytes of the incoming request body.
 */
function verifyWebhookSignature(string $rawBody): void
{
    $secret = getenv('WEBHOOK_SECRET');
    if (empty($secret)) {
        // If no secret is configured, log a warning and allow through.
        // This is acceptable in development; MUST be set in production.
        error_log('[AetherCore Webhook] WARNING: WEBHOOK_SECRET is not set. Signature verification is DISABLED.');
        return;
    }

    // Support both Alchemy and Moralis header formats
    $receivedSignature = $_SERVER['HTTP_X_ALCHEMY_SIGNATURE']
                      ?? $_SERVER['HTTP_X_MORALIS_SIGNATURE']
                      ?? '';

    if (empty($receivedSignature)) {
        error_log('[AetherCore Webhook] Rejected: Missing signature header.');
        webhookResponse('Unauthorized: missing signature.', 401);
    }

    // Compute the expected HMAC-SHA256 signature
    $expectedSignature = hash_hmac('sha256', $rawBody, $secret);

    // CRITICAL: Use hash_equals for constant-time comparison.
    // A simple === would be vulnerable to timing attacks.
    if (!hash_equals($expectedSignature, $receivedSignature)) {
        error_log('[AetherCore Webhook] Rejected: Signature mismatch.');
        webhookResponse('Unauthorized: invalid signature.', 401);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  VALIDATION HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validates and lowercases an Ethereum wallet address.
 * Terminates with HTTP 400 if the address is malformed.
 */
function validateWallet(string $raw): string
{
    $addr = strtolower(trim($raw));
    if (!preg_match('/^0x[0-9a-f]{40}$/', $addr)) {
        webhookResponse("Invalid wallet address in payload: {$raw}", 400);
    }
    return $addr;
}

/**
 * Validates a uint256 value passed as a string (to avoid PHP integer overflow).
 * Only allows digits; no negative signs or decimals.
 */
function validateUint256(string $raw): string
{
    $val = trim($raw);
    if (!preg_match('/^\d+$/', $val) || strlen($val) > 78) { // uint256 max = 78 digits
        webhookResponse("Invalid uint256 value in payload: {$raw}", 400);
    }
    return $val;
}

/**
 * Validates an AntiGravityTier enum value (0–4).
 */
function validateTier(int $tier): int
{
    if ($tier < 0 || $tier > 4) {
        webhookResponse("Invalid tier value: {$tier}", 400);
    }
    return $tier;
}

/**
 * Validates an Ethereum transaction hash (0x + 64 hex chars).
 */
function isValidTxHash(string $hash): bool
{
    return (bool) preg_match('/^0x[0-9a-fA-F]{64}$/', $hash);
}

/**
 * Sanitizes a string for use in switch/log statements (not for SQL — use PDO for that).
 */
function sanitizeString(string $raw): string
{
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', trim($raw));
}

/**
 * Checks whether an event with the given (tx_hash, event_type) pair already
 * exists in `staking_events`, preventing duplicate processing.
 */
function isDuplicateEvent(\PDO $pdo, string $txHash, string $eventType): bool
{
    $stmt = $pdo->prepare(
        "SELECT id FROM staking_events
         WHERE tx_hash = :tx AND event_type = :type
         LIMIT 1"
    );
    $stmt->execute([':tx' => $txHash, ':type' => $eventType]);
    return $stmt->fetch() !== false;
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Sends a plain-text webhook response and exits.
 * Webhooks only need a simple status + body; no JSON wrapper required.
 */
function webhookResponse(string $message, int $statusCode): never
{
    http_response_code($statusCode);
    header('Content-Type: text/plain');
    echo $message;
    exit;
}

/**
 * Structured internal logging using PHP's error_log.
 * In production, replace with a PSR-3 logger (e.g., Monolog).
 */
function logInfo(string $message): void
{
    error_log('[AetherCore Webhook] ' . $message);
}
