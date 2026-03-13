// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  AetherCore-Web3 | CoreProtocol.sol
//  Author  : AetherCore Team
//  Version : 1.0.0
//  Date    : 2026-03-12
// ============================================================
//
//  ARCHITECTURE NOTE:
//  This contract is the on-chain backbone of the AetherCore
//  protocol. It manages the "Anti-Gravity Staking" system
//  where users (referred to as "Pilots") stake the native
//  AetherCore token to unlock protocol tiers.
//
//  Off-chain Integration:
//    - The PHP backend listens to all emitted events via a
//      Web3.php / ethers.js WebSocket subscriber and mirrors
//      the state into a MySQL database for fast querying.
//    - The React frontend reads user state via view functions
//      and the PHP API.
//    - The Angular admin dashboard calls owner-only functions
//      through a privileged Admin Wallet connection.
// ============================================================

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CoreProtocol
 * @author AetherCore Team
 * @notice This is the primary staking contract for the AetherCore-Web3 protocol.
 *         Users stake AetherCore tokens to earn an "Anti-Gravity Tier", which
 *         unlocks increasing levels of protocol benefits and governance rights.
 * @dev Inherits OpenZeppelin's Ownable (admin control), ReentrancyGuard (prevents
 *      reentrancy attacks on state-changing value transfers), and Pausable
 *      (emergency circuit breaker). Uses SafeERC20 for safe token transfers.
 *
 *      Security Model:
 *      - `nonReentrant` is applied to ALL functions that transfer tokens.
 *      - `whenNotPaused` is applied to user-facing state-changing functions.
 *      - Owner functions are the sole exception to pause (for emergency recovery).
 *      - No native ETH is held; only ERC-20 tokens are managed.
 */
contract CoreProtocol is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ================================================================
    //  SECTION 1: TYPES & ENUMS
    // ================================================================

    /**
     * @notice Represents the staking tier of a Pilot.
     * @dev Tiers are computed dynamically from `_tierThresholds` mapping.
     *      NONE      → Not yet registered or staked below Tier-1 threshold.
     *      TIER_1    → Entry level. Basic protocol access.
     *      TIER_2    → Intermediate. Enhanced yield and governance weight.
     *      TIER_3    → Advanced. Priority features and governance multiplier.
     *      TIER_4    → Elite. Full protocol access and highest multiplier.
     */
    enum AntiGravityTier {
        NONE,
        TIER_1,
        TIER_2,
        TIER_3,
        TIER_4
    }

    // ================================================================
    //  SECTION 2: STRUCTS
    // ================================================================

    /**
     * @notice On-chain profile for every registered protocol participant.
     * @dev Stored in `_pilots` mapping keyed by wallet address.
     *      This struct is the single source of truth for on-chain pilot state.
     *      The PHP backend mirrors this in the `pilots` MySQL table, kept in
     *      sync via event indexing.
     *
     * @param wallet                The registered wallet address of the pilot.
     * @param totalStaked           Total amount of AetherCore tokens currently staked.
     * @param activeTier            The current Anti-Gravity Tier of the pilot.
     * @param lastActionAt          Unix timestamp of the pilot's most recent action.
     * @param isRegistered          Flag to distinguish registered pilots from zero-state.
     * @param totalLifetimeStaked   Cumulative amount ever staked (for analytics/rewards).
     */
    struct PilotProfile {
        address wallet;
        uint256 totalStaked;
        AntiGravityTier activeTier;
        uint256 lastActionAt;
        bool isRegistered;
        uint256 totalLifetimeStaked;
    }

    // ================================================================
    //  SECTION 3: STATE VARIABLES
    // ================================================================

    /// @notice The ERC-20 token accepted for staking (AetherCore Token).
    IERC20 public immutable aetherToken;

    /// @notice Total tokens staked across ALL pilots in the protocol.
    uint256 public totalProtocolStaked;

    /// @notice Total number of registered pilots.
    uint256 public totalPilotCount;

    /**
     * @notice Minimum token amounts required to reach each tier.
     * @dev Keyed by AntiGravityTier enum (cast to uint8).
     *      Tier 0 (NONE) always maps to 0.
     *      Set by owner via `setTierThreshold()`.
     *
     *      Default thresholds:
     *        TIER_1 →   1,000 AETH
     *        TIER_2 →   5,000 AETH
     *        TIER_3 →  25,000 AETH
     *        TIER_4 → 100,000 AETH
     */
    mapping(uint8 => uint256) private _tierThresholds;

    /// @dev Core pilot registry. Maps wallet address → PilotProfile.
    mapping(address => PilotProfile) private _pilots;

    // ================================================================
    //  SECTION 4: EVENTS
    // ================================================================
    //
    //  INTEGRATION NOTE FOR PHP BACKEND:
    //  Subscribe to these events using a WebSocket provider (e.g., Alchemy,
    //  Infura, or a self-hosted node). On each event, insert/update the
    //  corresponding row in the MySQL `pilots` table.
    //  All uint256 amounts are in the token's base unit (18 decimals).
    // ================================================================

    /**
     * @notice Emitted when a new wallet registers as a protocol Pilot.
     * @param pilot     Address of the newly registered pilot.
     * @param timestamp Unix timestamp of registration.
     */
    event PilotRegistered(
        address indexed pilot,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a pilot successfully stakes tokens.
     * @param pilot         Address of the staking pilot.
     * @param amount        Number of tokens staked in this transaction.
     * @param totalStaked   Pilot's new cumulative staked balance.
     * @param newTier       The tier achieved after this stake action.
     * @param timestamp     Unix timestamp of the stake action.
     */
    event TokensStaked(
        address indexed pilot,
        uint256 amount,
        uint256 totalStaked,
        AntiGravityTier indexed newTier,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a pilot successfully unstakes tokens.
     * @param pilot         Address of the unstaking pilot.
     * @param amount        Number of tokens returned to the pilot.
     * @param totalStaked   Pilot's remaining staked balance after unstake.
     * @param newTier       The tier after unstaking (may be downgraded).
     * @param timestamp     Unix timestamp of the unstake action.
     */
    event TokensUnstaked(
        address indexed pilot,
        uint256 amount,
        uint256 totalStaked,
        AntiGravityTier indexed newTier,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a pilot's Anti-Gravity Tier changes.
     * @dev Fires on BOTH upgrades and downgrades.
     *      Angular dashboard can use this to show a real-time tier history log.
     * @param pilot     Address of the pilot.
     * @param oldTier   The tier before the change.
     * @param newTier   The tier after the change.
     * @param timestamp Unix timestamp of the tier change.
     */
    event TierChanged(
        address indexed pilot,
        AntiGravityTier oldTier,
        AntiGravityTier newTier,
        uint256 timestamp
    );

    /**
     * @notice Emitted when the owner updates a tier's minimum stake threshold.
     * @param tier          The AntiGravityTier whose threshold was updated.
     * @param oldThreshold  Previous minimum token amount for this tier.
     * @param newThreshold  New minimum token amount for this tier.
     */
    event TierThresholdUpdated(
        AntiGravityTier indexed tier,
        uint256 oldThreshold,
        uint256 newThreshold
    );

    /**
     * @notice Emitted when the owner performs an emergency token recovery.
     * @param token   Address of the ERC-20 token recovered.
     * @param to      Destination address for the recovered tokens.
     * @param amount  Amount of tokens recovered.
     */
    event EmergencyTokenRecovered(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    /**
     * @notice Emitted when a pilot triggers an emergency self-withdrawal.
     * @dev Only callable when the contract is paused. Bypasses normal checks.
     * @param pilot     Address of the pilot who withdrew.
     * @param amount    Amount returned to the pilot.
     * @param timestamp Unix timestamp of the emergency withdrawal.
     */
    event EmergencyWithdrawal(
        address indexed pilot,
        uint256 amount,
        uint256 timestamp
    );

    // ================================================================
    //  SECTION 5: CUSTOM ERRORS
    // ================================================================
    //
    //  Using custom errors (Solidity >=0.8.4) instead of revert strings
    //  reduces gas cost significantly and improves debuggability.
    // ================================================================

    /// @dev Thrown when a non-registered pilot attempts a privileged action.
    error PilotNotRegistered(address caller);

    /// @dev Thrown when a pilot tries to register twice.
    error PilotAlreadyRegistered(address caller);

    /// @dev Thrown when a stake or unstake amount is zero or invalid.
    error InvalidAmount(uint256 provided);

    /// @dev Thrown when unstake amount exceeds the pilot's staked balance.
    error InsufficientStakedBalance(uint256 requested, uint256 available);

    /// @dev Thrown when an invalid tier index is supplied to `setTierThreshold`.
    error InvalidTier(uint8 tier);

    /// @dev Thrown when attempting to recover the staking token (breaks accounting).
    error CannotRecoverStakingToken();

    // ================================================================
    //  SECTION 6: CONSTRUCTOR
    // ================================================================

    /**
     * @notice Deploys the CoreProtocol contract.
     * @dev Sets the immutable staking token address, the initial owner
     *      (passed to OpenZeppelin Ownable), and configures default
     *      tier thresholds. All values are in token base units (1e18).
     *
     * @param _aetherTokenAddress Address of the deployed AetherCore ERC-20 token.
     * @param _initialOwner       Address that will own this contract (admin wallet).
     *
     * @custom:security-note The `_initialOwner` should be a Gnosis Safe multisig,
     *         not a plain EOA, in production. The Angular admin dashboard connects
     *         to this multisig wallet for all owner-only actions.
     */
    constructor(
        address _aetherTokenAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aetherTokenAddress != address(0), "CoreProtocol: zero token address");
        require(_initialOwner != address(0), "CoreProtocol: zero owner address");

        aetherToken = IERC20(_aetherTokenAddress);

        // --- Set default tier thresholds (in token base units, 18 decimals) ---
        _tierThresholds[uint8(AntiGravityTier.TIER_1)] =   1_000 * 10 ** 18;
        _tierThresholds[uint8(AntiGravityTier.TIER_2)] =   5_000 * 10 ** 18;
        _tierThresholds[uint8(AntiGravityTier.TIER_3)] =  25_000 * 10 ** 18;
        _tierThresholds[uint8(AntiGravityTier.TIER_4)] = 100_000 * 10 ** 18;
    }

    // ================================================================
    //  SECTION 7: MODIFIERS
    // ================================================================

    /**
     * @dev Reverts with `PilotNotRegistered` if `msg.sender` has not called
     *      `registerPilot()` first. Applied to stake/unstake functions.
     */
    modifier onlyRegisteredPilot() {
        if (!_pilots[msg.sender].isRegistered) {
            revert PilotNotRegistered(msg.sender);
        }
        _;
    }

    // ================================================================
    //  SECTION 8: USER-FACING FUNCTIONS
    // ================================================================

    /**
     * @notice Registers the caller as a Protocol Pilot.
     * @dev Must be called before staking. Creates a `PilotProfile` entry
     *      on-chain and emits `PilotRegistered`. Each wallet can only register
     *      once. The PHP backend listens for `PilotRegistered` to INSERT a
     *      new row in the `pilots` MySQL table.
     *
     * @custom:emits PilotRegistered
     */
    function registerPilot() external whenNotPaused {
        if (_pilots[msg.sender].isRegistered) {
            revert PilotAlreadyRegistered(msg.sender);
        }

        _pilots[msg.sender] = PilotProfile({
            wallet: msg.sender,
            totalStaked: 0,
            activeTier: AntiGravityTier.NONE,
            lastActionAt: block.timestamp,
            isRegistered: true,
            totalLifetimeStaked: 0
        });

        unchecked {
            ++totalPilotCount;
        }

        emit PilotRegistered(msg.sender, block.timestamp);
    }

    /**
     * @notice Stakes a specified amount of AetherCore tokens into the protocol.
     * @dev Caller MUST have approved this contract to spend at least `_amount`
     *      tokens via `aetherToken.approve(address(this), _amount)` before calling.
     *
     *      Security:
     *      - Protected by `nonReentrant`: prevents reentrancy during token transfer.
     *      - Protected by `whenNotPaused`: cannot be called during an emergency halt.
     *      - Follows Checks-Effects-Interactions (CEI) pattern: state is updated
     *        BEFORE the external `safeTransferFrom` call.
     *      - Uses `SafeERC20.safeTransferFrom` for non-standard ERC-20 safety.
     *
     *      PHP backend listens for `TokensStaked` to UPDATE the pilot's
     *      `staked_balance` and `active_tier` columns in MySQL.
     *
     * @param _amount The number of tokens (in base units) to stake. Must be > 0.
     *
     * @custom:emits TokensStaked
     * @custom:emits TierChanged (only if the tier changes as a result)
     */
    function stake(uint256 _amount)
        external
        nonReentrant
        whenNotPaused
        onlyRegisteredPilot
    {
        if (_amount == 0) revert InvalidAmount(_amount);

        PilotProfile storage pilot = _pilots[msg.sender];
        AntiGravityTier oldTier = pilot.activeTier;

        // --- EFFECTS: Update state BEFORE external call ---
        pilot.totalStaked          += _amount;
        pilot.totalLifetimeStaked  += _amount;
        pilot.lastActionAt          = block.timestamp;
        totalProtocolStaked        += _amount;

        AntiGravityTier newTier = _computeTier(pilot.totalStaked);
        pilot.activeTier = newTier;

        // --- INTERACTIONS: Token transfer AFTER state update ---
        aetherToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit TokensStaked(msg.sender, _amount, pilot.totalStaked, newTier, block.timestamp);

        if (newTier != oldTier) {
            emit TierChanged(msg.sender, oldTier, newTier, block.timestamp);
        }
    }

    /**
     * @notice Unstakes a specified amount of tokens and returns them to the caller.
     * @dev Security:
     *      - Protected by `nonReentrant`: prevents any reentrancy on the outbound
     *        token transfer.
     *      - Protected by `whenNotPaused`: use `emergencyWithdraw()` if paused.
     *      - Checks balance BEFORE modifying state (CEI pattern).
     *      - Uses `SafeERC20.safeTransfer` for safe outbound transfers.
     *
     *      PHP backend listens for `TokensUnstaked` to UPDATE the pilot's
     *      `staked_balance` and `active_tier` columns in MySQL.
     *
     * @param _amount The number of tokens (in base units) to unstake. Must be > 0.
     *
     * @custom:emits TokensUnstaked
     * @custom:emits TierChanged (only if the tier downgrades as a result)
     */
    function unstake(uint256 _amount)
        external
        nonReentrant
        whenNotPaused
        onlyRegisteredPilot
    {
        if (_amount == 0) revert InvalidAmount(_amount);

        PilotProfile storage pilot = _pilots[msg.sender];

        if (_amount > pilot.totalStaked) {
            revert InsufficientStakedBalance(_amount, pilot.totalStaked);
        }

        AntiGravityTier oldTier = pilot.activeTier;

        // --- EFFECTS ---
        pilot.totalStaked    -= _amount;
        pilot.lastActionAt    = block.timestamp;
        totalProtocolStaked  -= _amount;

        AntiGravityTier newTier = _computeTier(pilot.totalStaked);
        pilot.activeTier = newTier;

        // --- INTERACTIONS ---
        aetherToken.safeTransfer(msg.sender, _amount);

        emit TokensUnstaked(msg.sender, _amount, pilot.totalStaked, newTier, block.timestamp);

        if (newTier != oldTier) {
            emit TierChanged(msg.sender, oldTier, newTier, block.timestamp);
        }
    }

    /**
     * @notice Emergency self-withdrawal — only callable while the contract is PAUSED.
     * @dev This function deliberately bypasses the `whenNotPaused` guard.
     *      It allows pilots to exit the protocol even during an emergency halt,
     *      ensuring user funds are never locked.
     *
     *      `nonReentrant` still guards against reentrancy even while paused.
     *      PHP backend listens for `EmergencyWithdrawal` to flag the pilot's
     *      account for review in the Angular admin dashboard.
     *
     * @custom:emits EmergencyWithdrawal
     */
    function emergencyWithdraw() external nonReentrant onlyRegisteredPilot {
        require(paused(), "CoreProtocol: contract is not paused");

        PilotProfile storage pilot = _pilots[msg.sender];
        uint256 amount = pilot.totalStaked;

        if (amount == 0) revert InvalidAmount(0);

        // --- EFFECTS ---
        pilot.totalStaked     = 0;
        pilot.activeTier      = AntiGravityTier.NONE;
        pilot.lastActionAt    = block.timestamp;
        totalProtocolStaked  -= amount;

        // --- INTERACTIONS ---
        aetherToken.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawal(msg.sender, amount, block.timestamp);
    }

    // ================================================================
    //  SECTION 9: OWNER / ADMIN FUNCTIONS
    //  Called by the Angular Admin Dashboard via a privileged wallet.
    //  All functions here are gated by OpenZeppelin's `onlyOwner`.
    // ================================================================

    /**
     * @notice Pauses all user-facing, state-changing functions.
     * @dev Used in emergencies such as exploit detection or critical upgrades.
     *      The Angular dashboard exposes a "Pause Protocol" button that calls
     *      this via ethers.js connected to the admin/owner wallet.
     *
     * @custom:security Only callable by owner (Ownable).
     */
    function pauseProtocol() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the protocol, restoring full user functionality.
     * @dev Only callable by the contract owner after an emergency is resolved.
     *      The Angular dashboard exposes an "Unpause Protocol" button for this.
     *
     * @custom:security Only callable by owner (Ownable).
     */
    function unpauseProtocol() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Updates the minimum stake threshold for a given Anti-Gravity Tier.
     * @dev Allows dynamic adjustment without redeployment — useful for token
     *      price fluctuations. Does NOT retroactively re-tier existing pilots;
     *      their tiers update on their next stake or unstake action.
     *
     *      PHP backend listens for `TierThresholdUpdated` to cache the new
     *      values for off-chain analytics and eligibility checks.
     *
     * @param _tier         Tier index to update (1–4 only; NONE/0 is immutable).
     * @param _newThreshold New minimum token amount in base units (1e18).
     *
     * @custom:security Only callable by owner (Ownable).
     * @custom:emits TierThresholdUpdated
     */
    function setTierThreshold(uint8 _tier, uint256 _newThreshold)
        external
        onlyOwner
    {
        if (_tier == 0 || _tier > 4) revert InvalidTier(_tier);

        uint256 oldThreshold = _tierThresholds[_tier];
        _tierThresholds[_tier] = _newThreshold;

        emit TierThresholdUpdated(AntiGravityTier(_tier), oldThreshold, _newThreshold);
    }

    /**
     * @notice Recovers ERC-20 tokens accidentally sent to this contract.
     * @dev Safety hatch for tokens OTHER than the primary staking token.
     *      Attempting to recover `aetherToken` will revert to protect accounting
     *      integrity. User funds are accessible via `emergencyWithdraw`.
     *
     * @param _token  Address of the ERC-20 token to recover.
     * @param _to     Destination address for the recovered tokens.
     * @param _amount Amount to recover in base units.
     *
     * @custom:security Only callable by owner (Ownable).
     * @custom:emits EmergencyTokenRecovered
     */
    function recoverERC20(address _token, address _to, uint256 _amount)
        external
        onlyOwner
    {
        if (_token == address(aetherToken)) revert CannotRecoverStakingToken();
        require(_to != address(0), "CoreProtocol: zero destination");

        IERC20(_token).safeTransfer(_to, _amount);

        emit EmergencyTokenRecovered(_token, _to, _amount);
    }

    // ================================================================
    //  SECTION 10: VIEW FUNCTIONS
    //  Read-only and gas-free. Called by React frontend & Angular dashboard.
    // ================================================================

    /**
     * @notice Returns the full on-chain profile of a given pilot.
     * @dev Called by the React frontend to populate the user dashboard, and by
     *      the Angular admin dashboard to inspect any pilot's on-chain state.
     *      Returns a zeroed struct if the address is not registered.
     *
     * @param _pilot The wallet address of the pilot to look up.
     * @return A `PilotProfile` struct containing all on-chain pilot data.
     */
    function getPilotProfile(address _pilot)
        external
        view
        returns (PilotProfile memory)
    {
        return _pilots[_pilot];
    }

    /**
     * @notice Returns the current minimum stake threshold for a given tier.
     * @dev Used by the React frontend to display tier requirements in the UI,
     *      e.g., "You need X more AETH to reach Tier 2".
     *
     * @param _tier The tier to query.
     * @return The minimum token amount (base units) required for that tier.
     */
    function getTierThreshold(AntiGravityTier _tier)
        external
        view
        returns (uint256)
    {
        return _tierThresholds[uint8(_tier)];
    }

    /**
     * @notice Computes what tier a given staked amount would qualify for.
     * @dev Purely computational; does NOT read or modify pilot state.
     *      Useful for the React frontend to show a "Tier Preview" before a
     *      user commits to a stake transaction.
     *
     * @param _stakedAmount Hypothetical staked amount in token base units.
     * @return The `AntiGravityTier` that `_stakedAmount` qualifies for.
     */
    function previewTierForAmount(uint256 _stakedAmount)
        external
        view
        returns (AntiGravityTier)
    {
        return _computeTier(_stakedAmount);
    }

    /**
     * @notice Returns a summary of protocol-level statistics.
     * @dev Called by the Angular admin dashboard's analytics panel to render
     *      global protocol health metrics.
     *
     * @return _totalStaked   Total tokens staked across all pilots.
     * @return _totalPilots   Total number of registered pilots.
     * @return _isPaused      Whether the contract is currently paused.
     */
    function getProtocolStats()
        external
        view
        returns (
            uint256 _totalStaked,
            uint256 _totalPilots,
            bool    _isPaused
        )
    {
        return (totalProtocolStaked, totalPilotCount, paused());
    }

    // ================================================================
    //  SECTION 11: INTERNAL HELPERS
    // ================================================================

    /**
     * @notice Determines the Anti-Gravity Tier for a given staked amount.
     * @dev Evaluates from the highest tier downward for gas efficiency
     *      (avoids unnecessary lower-tier checks for high-value stakers).
     *      Pure function: reads only `_tierThresholds` mapping (storage).
     *
     * @param _amount The staked amount in token base units.
     * @return The appropriate `AntiGravityTier` enum value.
     */
    function _computeTier(uint256 _amount)
        internal
        view
        returns (AntiGravityTier)
    {
        if      (_amount >= _tierThresholds[uint8(AntiGravityTier.TIER_4)]) return AntiGravityTier.TIER_4;
        else if (_amount >= _tierThresholds[uint8(AntiGravityTier.TIER_3)]) return AntiGravityTier.TIER_3;
        else if (_amount >= _tierThresholds[uint8(AntiGravityTier.TIER_2)]) return AntiGravityTier.TIER_2;
        else if (_amount >= _tierThresholds[uint8(AntiGravityTier.TIER_1)]) return AntiGravityTier.TIER_1;
        else                                                                 return AntiGravityTier.NONE;
    }
}
