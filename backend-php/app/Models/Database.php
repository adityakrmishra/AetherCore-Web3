<?php

/**
 * =============================================================
 *  AetherCore-Web3 | /backend-php/app/Models/Database.php
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  Provides a secure, singleton PDO database connection for the
 *  entire PHP backend. Implements the Singleton pattern so that
 *  only ONE database connection is opened per request lifecycle,
 *  preventing connection pool exhaustion under load.
 *
 *  SECURITY DESIGN:
 *  - Credentials are loaded EXCLUSIVELY from environment variables
 *    (populated by your .env file via the bootstrap entry point).
 *  - PDO::ATTR_EMULATE_PREPARES = false forces the MySQL driver to
 *    use TRUE server-side prepared statements, which is the strongest
 *    defense against SQL injection.
 *  - PDO::ERRMODE_EXCEPTION ensures all query errors throw catchable
 *    PDOException objects rather than silently failing.
 *  - The raw DSN is never exposed in any response body or logs.
 *
 *  USAGE:
 *    $db  = Database::getInstance();
 *    $pdo = $db->getConnection();
 *    $stmt = $pdo->prepare("SELECT * FROM pilot_profiles WHERE wallet_address = :wallet");
 *    $stmt->execute([':wallet' => $wallet]);
 * =============================================================
 */

declare(strict_types=1);

namespace App\Models;

use PDO;
use PDOException;
use RuntimeException;

/**
 * @class Database
 * @description Singleton PDO connection manager for the AetherCore MySQL database.
 */
class Database
{
    // ── Singleton Instance ─────────────────────────────────────────────────────

    /** @var Database|null The single instance of this class. */
    private static ?Database $instance = null;

    /** @var PDO|null The underlying PDO connection object. */
    private ?PDO $connection = null;

    // ── Private Constructor (enforces Singleton) ───────────────────────────────

    /**
     * Private constructor — cannot be instantiated directly.
     * Use Database::getInstance() instead.
     */
    private function __construct()
    {
        $this->connect();
    }

    /** Prevent cloning of the singleton. */
    private function __clone() {}

    /** Prevent unserialization of the singleton. */
    public function __wakeup()
    {
        throw new RuntimeException('Cannot unserialize a singleton.');
    }

    // ── Singleton Accessor ─────────────────────────────────────────────────────

    /**
     * Returns the single shared instance of the Database class.
     * Creates it on first call; subsequent calls return the cached instance.
     *
     * @return Database The singleton instance.
     */
    public static function getInstance(): Database
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    // ── Connection Logic ───────────────────────────────────────────────────────

    /**
     * Establishes the PDO connection using environment variables.
     * Called once by the private constructor.
     *
     * Environment variables required (set in /backend-php/.env):
     *   DB_HOST     — MySQL host (e.g., "127.0.0.1" or "db" in Docker)
     *   DB_PORT     — MySQL port (default: 3306)
     *   DB_NAME     — Database name (e.g., "aethercore_db")
     *   DB_USER     — MySQL username
     *   DB_PASSWORD — MySQL password
     *
     * @throws RuntimeException If any required environment variable is missing.
     * @throws PDOException     If the database connection fails.
     */
    private function connect(): void
    {
        // ── Load & validate required environment variables ──────────────────
        $host     = $this->requireEnv('DB_HOST');
        $port     = $this->requireEnv('DB_PORT');
        $dbName   = $this->requireEnv('DB_NAME');
        $user     = $this->requireEnv('DB_USER');
        $password = $this->requireEnv('DB_PASSWORD');

        // ── Build DSN ───────────────────────────────────────────────────────
        // charset=utf8mb4 ensures correct Unicode handling at the protocol level.
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $host,
            $port,
            $dbName
        );

        // ── PDO Options ─────────────────────────────────────────────────────
        $options = [
            // Throw PDOException on ALL errors (never silent failures)
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,

            // Return results as associative arrays by default
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,

            // CRITICAL SECURITY: Disable emulated prepares.
            // Forces MySQL to use TRUE server-side prepared statements,
            // which is the strongest protection against SQL injection.
            PDO::ATTR_EMULATE_PREPARES   => false,

            // Persistent connections (connection pooling across requests).
            // Set to false in high-concurrency environments to avoid
            // stale connection issues; use a pool manager (e.g., ProxySQL).
            PDO::ATTR_PERSISTENT         => false,
        ];

        try {
            $this->connection = new PDO($dsn, $user, $password, $options);
        } catch (PDOException $e) {
            // Log the technical error internally but NEVER expose the DSN
            // or credentials in the message thrown outward.
            error_log('[AetherCore DB] Connection failed: ' . $e->getMessage());

            // Throw a sanitized exception — no credentials in the message
            throw new RuntimeException(
                'Database connection could not be established. Check server logs.',
                (int) $e->getCode()
            );
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Returns the active PDO connection object.
     * Use this to prepare and execute statements throughout the application.
     *
     * @return PDO The active database connection.
     * @throws RuntimeException If the connection was never established.
     */
    public function getConnection(): PDO
    {
        if ($this->connection === null) {
            throw new RuntimeException('Database connection is not available.');
        }
        return $this->connection;
    }

    /**
     * Convenience shortcut: returns the PDO connection directly from
     * the singleton without needing to call getInstance() first.
     *
     * Usage: $pdo = Database::connection();
     *
     * @return PDO
     */
    public static function connection(): PDO
    {
        return self::getInstance()->getConnection();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Retrieves a required environment variable, throwing if it is missing or empty.
     *
     * @param  string $name The environment variable name.
     * @return string       The value of the environment variable.
     * @throws RuntimeException If the variable is not set or is an empty string.
     */
    private function requireEnv(string $name): string
    {
        $value = getenv($name);
        if ($value === false || $value === '') {
            throw new RuntimeException(
                "[AetherCore DB] Required environment variable '{$name}' is not set. " .
                "Check your /backend-php/.env file."
            );
        }
        return $value;
    }
}
