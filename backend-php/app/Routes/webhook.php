<?php
/**
 * AetherCore Webhook Listener (The Bridge)
 * Catches blockchain events and updates the MySQL database.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../vendor/autoload.php';
use App\Models\Database;

// Load env variables
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../../');
$dotenv->load();

// 1. Catch the incoming JSON payload from the blockchain/node
$rawPayload = file_get_contents('php://input');
$data = json_decode($rawPayload, true);

if (!$data || !isset($data['wallet_address'], $data['amount_staked'], $data['new_tier'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid payload']);
    exit;
}

$wallet = strtolower(trim($data['wallet_address']));
$amountStaked = (float) $data['amount_staked'];
$newTier = (int) $data['new_tier'];

try {
    $pdo = Database::connection();

    // 2. Update the pilot's profile (Using unique placeholders :amount1 and :amount2)
    $stmt = $pdo->prepare("
        INSERT INTO pilot_profiles 
            (wallet_address, total_staked, active_tier, is_registered, total_lifetime_staked, last_action_at, created_at, updated_at)
        VALUES 
            (:wallet, :amount1, :tier, 1, :amount2, NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE 
            total_staked = total_staked + VALUES(total_staked),
            total_lifetime_staked = total_lifetime_staked + VALUES(total_lifetime_staked),
            active_tier = VALUES(active_tier),
            last_action_at = NOW(),
            updated_at = NOW()
    ");

    $stmt->execute([
        ':wallet'  => $wallet,
        ':amount1' => $amountStaked,
        ':tier'    => $newTier,
        ':amount2' => $amountStaked
    ]);

    http_response_code(200);
    echo json_encode(['status' => 'success', 'message' => 'Database synced with blockchain.']);

} catch (\Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
}