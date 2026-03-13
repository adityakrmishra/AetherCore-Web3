// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  AetherCore-Web3 | AntiGravityToken.sol
//  Author  : AetherCore Team
//  Version : 1.0.0
//  Date    : 2026-03-12
// ============================================================
//
//  ARCHITECTURE NOTE:
//  This is the native ERC-20 token of the AetherCore protocol.
//  It is the ONLY token accepted by CoreProtocol.sol for staking.
//
//  Deployment Order (CRITICAL):
//    1. Deploy AntiGravityToken.sol  → capture deployed address
//    2. Pass that address as `_aetherTokenAddress` to the
//       CoreProtocol.sol constructor.
//
//  Integration Points:
//    - CoreProtocol.sol  → calls safeTransferFrom / safeTransfer
//    - React Frontend    → reads balanceOf, allowance, decimals
//    - Angular Dashboard → calls mintTokens() via admin wallet
//    - PHP Backend       → listens to Transfer/Approval events
//                          to track balances off-chain in MySQL
// ============================================================

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AntiGravityToken
 * @author AetherCore Team
 * @notice The native utility and governance token of the AetherCore-Web3 protocol.
 *         Symbol: AETH | Decimals: 18 (ERC20 default).
 *
 * @dev Inherits:
 *      - `ERC20`         — standard fungible token implementation.
 *      - `ERC20Burnable` — exposes `burn()` and `burnFrom()`, allowing
 *                          deflationary mechanics and future protocol burns.
 *      - `Ownable`       — restricts privileged minting to the owner (admin
 *                          wallet / Gnosis Safe), callable from the Angular
 *                          Admin Dashboard.
 *
 *      Token Parameters:
 *        Name   : Anti-Gravity Token
 *        Symbol : AETH
 *        Supply : 10,000,000 AETH minted to deployer at construction.
 *                 Additional mints gated by `onlyOwner`.
 *
 *      Security:
 *      - No uncapped mint: `mintTokens` enforces a hard cap via `MAX_SUPPLY`.
 *      - `ERC20Burnable` burns reduce `totalSupply`, making the cap enforceable.
 *      - Standard OpenZeppelin integer overflow protection (Solidity ^0.8.20).
 */
contract AntiGravityToken is ERC20, ERC20Burnable, Ownable {

    // ================================================================
    //  SECTION 1: CONSTANTS
    // ================================================================

    /**
     * @notice The hard cap on total token supply.
     * @dev Set to 100,000,000 AETH (100 million). The initial mint of
     *      10,000,000 AETH leaves 90,000,000 AETH available for future
     *      mints (rewards pools, ecosystem grants, etc.) via `mintTokens`.
     *      Burns via `ERC20Burnable` reduce `totalSupply`, reclaiming
     *      headroom below this cap — intentional to support deflationary
     *      protocol mechanics.
     */
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    /**
     * @notice The initial token supply minted to the deployer.
     * @dev 10,000,000 AETH in base units (18 decimals).
     *      Distributed from the deployer wallet to:
     *        - Liquidity pools
     *        - Team / investor vesting contracts
     *        - Public sale contract
     *      ... per the protocol's tokenomics roadmap.
     */
    uint256 public constant INITIAL_SUPPLY = 10_000_000 * 10 ** 18;

    // ================================================================
    //  SECTION 2: EVENTS
    // ================================================================
    //
    //  INTEGRATION NOTE FOR PHP BACKEND:
    //  The standard ERC-20 `Transfer` event (from OpenZeppelin ERC20)
    //  covers all mint, burn, and transfer activity. Listen for:
    //    - Transfer(address(0), to, amount) → a mint occurred
    //    - Transfer(from, address(0), amount) → a burn occurred
    //    - Transfer(from, to, amount)         → a normal transfer
    //  The additional `TokensMinted` event below provides richer
    //  context for admin-triggered mints logged in the Angular dashboard.
    // ================================================================

    /**
     * @notice Emitted when the owner mints new tokens via `mintTokens()`.
     * @dev Supplements the standard ERC-20 `Transfer(address(0), to, amount)`
     *      event with explicit admin-mint metadata for the PHP backend and
     *      Angular dashboard audit log.
     *
     * @param to        Destination address that received the minted tokens.
     * @param amount    Amount minted in token base units (1e18).
     * @param newSupply Total supply after this mint.
     * @param timestamp Unix timestamp of the mint action.
     */
    event TokensMinted(
        address indexed to,
        uint256 amount,
        uint256 newSupply,
        uint256 timestamp
    );

    // ================================================================
    //  SECTION 3: CUSTOM ERRORS
    // ================================================================

    /**
     * @dev Thrown when a mint would push `totalSupply` above `MAX_SUPPLY`.
     * @param requested  The amount requested to mint.
     * @param available  The remaining mintable headroom under the cap.
     */
    error ExceedsMaxSupply(uint256 requested, uint256 available);

    /// @dev Thrown when `mintTokens` is called with a zero amount or to zero address.
    error InvalidMintParams();

    // ================================================================
    //  SECTION 4: CONSTRUCTOR
    // ================================================================

    /**
     * @notice Deploys the AntiGravityToken, setting the name, symbol, owner,
     *         and minting the initial supply to the deployer address.
     *
     * @dev The `ERC20` constructor sets the token name and symbol immutably.
     *      `Ownable` sets `_initialOwner` as the contract owner.
     *      `_mint` is called directly to credit `INITIAL_SUPPLY` to the
     *      deployer without going through the `onlyOwner` mint gate —
     *      this is the genesis mint and is one-time only.
     *
     * @param _initialOwner The address that will be set as the contract owner.
     *                      In production, this should be a Gnosis Safe multisig.
     *                      In local development / testing, this is the deployer EOA.
     *
     * @custom:security-note The deployer (`msg.sender`) receives INITIAL_SUPPLY.
     *         Ownership is separately set to `_initialOwner`. These can be the
     *         same address (typical in development) or different addresses
     *         (e.g., a treasury wallet receives tokens, a multisig owns the contract).
     */
    constructor(address _initialOwner)
        ERC20("Anti-Gravity Token", "AETH")
        Ownable(_initialOwner)
    {
        require(_initialOwner != address(0), "AntiGravityToken: zero owner address");

        // Genesis mint — credited to the deployer (msg.sender).
        // In the deployment script, msg.sender is the deployer EOA / Safe.
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ================================================================
    //  SECTION 5: ADMIN FUNCTIONS
    //  Called by Angular Admin Dashboard via privileged owner wallet.
    // ================================================================

    /**
     * @notice Mints new AETH tokens to a specified address.
     * @dev Strictly guarded by `onlyOwner`. Enforces `MAX_SUPPLY` hard cap:
     *      if `totalSupply() + amount > MAX_SUPPLY`, the transaction reverts
     *      with `ExceedsMaxSupply`.
     *
     *      Primary use cases:
     *        - Funding staking rewards pools in `CoreProtocol.sol`
     *        - Ecosystem grants and partnership allocations
     *        - Future airdrops managed by the Angular dashboard
     *
     *      Integration — Angular Admin Dashboard:
     *        The "Mint Tokens" form in the Angular dashboard:
     *          1. Accepts a `_to` address and `_amount` as inputs.
     *          2. Shows a live "Remaining Mintable" counter reading
     *             `remainingMintableSupply()` before submission.
     *          3. Submits the TX for signing via the admin wallet.
     *          4. PHP backend listens to `TokensMinted` to log the mint
     *             in the `token_mint_log` MySQL table.
     *
     * @param _to     Address to receive the newly minted tokens.
     * @param _amount Amount to mint in token base units (1e18). Must be > 0.
     *
     * @custom:security Only callable by owner (Ownable).
     * @custom:emits TokensMinted
     * @custom:emits Transfer (standard ERC-20, from address(0) to `_to`)
     */
    function mintTokens(address _to, uint256 _amount) external onlyOwner {
        if (_to == address(0) || _amount == 0) revert InvalidMintParams();

        uint256 currentSupply = totalSupply();
        uint256 available     = MAX_SUPPLY - currentSupply;

        if (_amount > available) {
            revert ExceedsMaxSupply(_amount, available);
        }

        _mint(_to, _amount);

        emit TokensMinted(_to, _amount, totalSupply(), block.timestamp);
    }

    // ================================================================
    //  SECTION 6: VIEW FUNCTIONS
    //  Read-only, gas-free. Called by React frontend & Angular dashboard.
    // ================================================================

    /**
     * @notice Returns the remaining number of tokens that can still be minted
     *         before the hard cap (`MAX_SUPPLY`) is reached.
     * @dev Computed as `MAX_SUPPLY - totalSupply()`. Since `ERC20Burnable`
     *      burns reduce `totalSupply`, burns increase this headroom —
     *      enabling controlled re-minting post-burn if desired.
     *
     *      Used by the Angular dashboard's "Mint Tokens" panel to display
     *      a live "Remaining Mintable Supply" counter.
     *
     * @return The number of AETH tokens (in base units) that can still be minted.
     */
    function remainingMintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    /**
     * @notice Returns all key token parameters in a single RPC call.
     * @dev Convenience aggregator for the React frontend's token info widget
     *      and the Angular dashboard's protocol stats panel. Reduces the number
     *      of individual RPC calls needed to populate the UI.
     *
     * @return _name          The token name ("Anti-Gravity Token").
     * @return _symbol        The token symbol ("AETH").
     * @return _decimals      Number of decimals (always 18 for this token).
     * @return _totalSupply   Current circulating supply in base units.
     * @return _maxSupply     The hard cap in base units (100,000,000 AETH).
     * @return _mintableLeft  Remaining mintable supply before the cap is hit.
     */
    function getTokenInfo()
        external
        view
        returns (
            string memory _name,
            string memory _symbol,
            uint8          _decimals,
            uint256        _totalSupply,
            uint256        _maxSupply,
            uint256        _mintableLeft
        )
    {
        return (
            name(),
            symbol(),
            decimals(),
            totalSupply(),
            MAX_SUPPLY,
            MAX_SUPPLY - totalSupply()
        );
    }
}
