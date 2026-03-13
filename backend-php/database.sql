-- =============================================================
--  AetherCore-Web3 | /backend-php/database.sql
--  Author  : AetherCore Team
--  Version : 1.0.0
--  Date    : 2026-03-12
-- =============================================================
--
--  PURPOSE:
--  Defines the complete MySQL schema for the AetherCore-Web3
--  off-chain database. This database mirrors on-chain state
--  (sourced from smart contract events) for fast, queryable
--  access by the PHP API layer.
--
--  HOW DATA FLOWS IN:
--    On-chain Event (Solidity)
--      → Alchemy Webhook / Moralis Stream (POST to webhook_listener.php)
--        → PHP webhook_listener.php validates & parses payload
--          → PDO prepared statement → MySQL (this schema)
--            → PHP api.php serves data → React / Angular UIs
--
--  IMPORT:
--    mysql -u root -p aethercore_db < database.sql
--    (or use a migration tool like Phinx / Flyway)
--
--  CHARACTER SET: utf8mb4 (full Unicode + Emoji support)
--  ENGINE       : InnoDB (transactions, foreign keys, row-level locking)
-- =============================================================

-- ── Database Setup ────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS `aethercore_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `aethercore_db`;

-- ── Table 1: pilot_profiles ───────────────────────────────────────────────────
--
--  Direct mirror of the on-chain `PilotProfile` struct in CoreProtocol.sol.
--  Populated/updated by webhook_listener.php on every TokensStaked,
--  TokensUnstaked, and PilotRegistered event.
--
--  COLUMN NOTES:
--  - wallet_address  : Stored as CHAR(42) — Ethereum addresses are always 42
--                      chars (0x + 40 hex chars). Fixed length = faster indexing.
--  - total_staked    : DECIMAL(36,18) — safely stores uint256 values with full
--                      18-decimal precision without floating-point rounding errors.
--  - active_tier     : TINYINT (0–4) maps to the AntiGravityTier enum.
--  - last_action_at  : Unix timestamp (BIGINT) matches Solidity's block.timestamp.
--  - is_registered   : TINYINT(1) = boolean (MySQL has no native BOOL).
--  - total_lifetime_staked : Cumulative all-time staked amount for analytics.
--  - created_at / updated_at : Server-side audit timestamps.

CREATE TABLE IF NOT EXISTS `pilot_profiles` (
  `id`                    BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `wallet_address`        CHAR(42)            NOT NULL                    COMMENT 'Checksummed Ethereum wallet address (e.g. 0xAbCd...)',
  `total_staked`          DECIMAL(36, 18)     NOT NULL DEFAULT '0.000000000000000000' COMMENT 'Current staked AETH balance in token base units',
  `active_tier`           TINYINT UNSIGNED    NOT NULL DEFAULT 0          COMMENT '0=NONE, 1=TIER_1, 2=TIER_2, 3=TIER_3, 4=TIER_4',
  `last_action_at`        BIGINT UNSIGNED     NOT NULL DEFAULT 0          COMMENT 'Unix timestamp of last on-chain action (from block.timestamp)',
  `is_registered`         TINYINT(1)          NOT NULL DEFAULT 0          COMMENT '1 if pilot has called registerPilot() on-chain',
  `total_lifetime_staked` DECIMAL(36, 18)     NOT NULL DEFAULT '0.000000000000000000' COMMENT 'Cumulative all-time tokens staked (never decremented on unstake)',
  `created_at`            TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Row creation time (server clock)',
  `updated_at`            TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time (server clock)',

  -- Primary key on auto-increment id; unique constraint enforces one row per wallet
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wallet_address` (`wallet_address`),

  -- Index for leaderboard queries (ORDER BY total_staked DESC)
  INDEX `idx_total_staked` (`total_staked` DESC),

  -- Index for tier-based filtering (e.g., "show all Tier 4 pilots")
  INDEX `idx_active_tier`  (`active_tier`)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Off-chain mirror of CoreProtocol.sol PilotProfile structs';


-- ── Table 2: staking_events ───────────────────────────────────────────────────
--
--  Immutable audit log of every TokensStaked / TokensUnstaked event
--  received by the webhook listener. Never modified after insertion —
--  only INSERTs, no UPDATEs. Enables:
--    - Historical staking timelines per pilot
--    - Protocol-level TVL charts over time
--    - Dispute resolution (on-chain tx hash stored for cross-reference)

CREATE TABLE IF NOT EXISTS `staking_events` (
  `id`              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `event_type`      ENUM('STAKED', 'UNSTAKED', 'EMERGENCY_WITHDRAWAL')
                                        NOT NULL                    COMMENT 'Maps to the Solidity event name',
  `wallet_address`  CHAR(42)            NOT NULL                    COMMENT 'The pilot wallet that triggered the event',
  `amount`          DECIMAL(36, 18)     NOT NULL                    COMMENT 'Token amount in base units for this event',
  `total_staked`    DECIMAL(36, 18)     NOT NULL                    COMMENT 'Pilot total staked AFTER this event (from event param)',
  `new_tier`        TINYINT UNSIGNED    NOT NULL DEFAULT 0          COMMENT 'Pilot tier AFTER this event',
  `tx_hash`         CHAR(66)            NOT NULL                    COMMENT 'Transaction hash of the on-chain event (0x + 64 hex)',
  `block_number`    BIGINT UNSIGNED     NOT NULL                    COMMENT 'Block number where the event was emitted',
  `chain_id`        INT UNSIGNED        NOT NULL                    COMMENT 'EVM chain ID (11155111=Sepolia, 31337=localhost)',
  `raw_payload`     JSON                         DEFAULT NULL       COMMENT 'Full raw webhook payload for debugging/replay',
  `created_at`      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  -- Prevent duplicate processing of the same on-chain event
  UNIQUE KEY `uq_tx_event` (`tx_hash`, `event_type`),

  -- Indexes for common query patterns
  INDEX `idx_wallet`       (`wallet_address`),
  INDEX `idx_event_type`   (`event_type`),
  INDEX `idx_block_number` (`block_number`),
  INDEX `idx_created_at`   (`created_at`)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable audit log of all staking-related on-chain events';


-- ── Table 3: tier_change_log ──────────────────────────────────────────────────
--
--  Records every TierChanged event emitted by CoreProtocol.sol.
--  Powers the Angular admin dashboard's "Tier History" view and
--  the React user dashboard's "Your Tier Journey" timeline.

CREATE TABLE IF NOT EXISTS `tier_change_log` (
  `id`              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `wallet_address`  CHAR(42)            NOT NULL,
  `old_tier`        TINYINT UNSIGNED    NOT NULL COMMENT 'Tier BEFORE the change',
  `new_tier`        TINYINT UNSIGNED    NOT NULL COMMENT 'Tier AFTER the change',
  `tx_hash`         CHAR(66)            NOT NULL COMMENT 'Transaction that triggered the tier change',
  `block_number`    BIGINT UNSIGNED     NOT NULL,
  `changed_at`      BIGINT UNSIGNED     NOT NULL COMMENT 'Unix timestamp from on-chain block.timestamp',
  `created_at`      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tx_tier_change` (`tx_hash`),
  INDEX `idx_wallet`       (`wallet_address`),
  INDEX `idx_new_tier`     (`new_tier`),
  INDEX `idx_changed_at`   (`changed_at`)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of all AntiGravityTier transitions per pilot';


-- ── Table 4: token_mint_log ───────────────────────────────────────────────────
--
--  Records every TokensMinted event emitted by AntiGravityToken.sol.
--  Populated when the Angular admin dashboard calls mintTokens().
--  Used for supply emission tracking and treasury management.

CREATE TABLE IF NOT EXISTS `token_mint_log` (
  `id`              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `to_address`      CHAR(42)            NOT NULL COMMENT 'Recipient of the minted tokens',
  `amount`          DECIMAL(36, 18)     NOT NULL COMMENT 'Amount minted in base units',
  `new_supply`      DECIMAL(36, 18)     NOT NULL COMMENT 'Total supply after this mint',
  `tx_hash`         CHAR(66)            NOT NULL,
  `block_number`    BIGINT UNSIGNED     NOT NULL,
  `minted_at`       BIGINT UNSIGNED     NOT NULL COMMENT 'Unix timestamp from block.timestamp',
  `created_at`      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tx_hash` (`tx_hash`),
  INDEX `idx_to_address`   (`to_address`),
  INDEX `idx_minted_at`    (`minted_at`)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of all AntiGravityToken mint events';


-- ── Stored Procedure: upsert_pilot_profile ────────────────────────────────────
--
--  Atomic UPSERT for pilot_profiles. Called by webhook_listener.php
--  on every TokensStaked / TokensUnstaked event. Using a stored procedure
--  keeps business logic DRY and enables future DB-level auditing.
--
--  Parameters mirror the on-chain event data passed by the webhook.

DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS `upsert_pilot_profile`(
  IN p_wallet_address        CHAR(42),
  IN p_total_staked          DECIMAL(36, 18),
  IN p_active_tier           TINYINT UNSIGNED,
  IN p_last_action_at        BIGINT UNSIGNED,
  IN p_is_registered         TINYINT(1),
  IN p_total_lifetime_staked DECIMAL(36, 18)
)
BEGIN
  INSERT INTO `pilot_profiles`
    (`wallet_address`, `total_staked`, `active_tier`, `last_action_at`, `is_registered`, `total_lifetime_staked`)
  VALUES
    (p_wallet_address, p_total_staked, p_active_tier, p_last_action_at, p_is_registered, p_total_lifetime_staked)
  ON DUPLICATE KEY UPDATE
    `total_staked`          = VALUES(`total_staked`),
    `active_tier`           = VALUES(`active_tier`),
    `last_action_at`        = VALUES(`last_action_at`),
    `is_registered`         = VALUES(`is_registered`),
    `total_lifetime_staked` = VALUES(`total_lifetime_staked`);
END$$

DELIMITER ;


-- ── Seed Data (Development Only) ─────────────────────────────────────────────
--  Comment this block out before running in production.
--
-- INSERT INTO `pilot_profiles`
--   (`wallet_address`, `total_staked`, `active_tier`, `last_action_at`, `is_registered`, `total_lifetime_staked`)
-- VALUES
--   ('0x0000000000000000000000000000000000000001', '5000.000000000000000000', 2, UNIX_TIMESTAMP(), 1, '5000.000000000000000000'),
--   ('0x0000000000000000000000000000000000000002', '100000.000000000000000000', 4, UNIX_TIMESTAMP(), 1, '150000.000000000000000000');
