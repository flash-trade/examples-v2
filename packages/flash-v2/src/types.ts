// ─────────────────────────────────────────────────────────────────────────────
// types.ts — hand-written types for the V2 API, faithful to the live backend.
// THE HARD PART: V2 reuses V1-shaped response DTOs — some fields are ALWAYS
// null on MagicBlock (swap*), and one is misspelled on purpose (youRecieveUsdUi
// matches the API byte-for-byte; do not "fix" it). All amounts/prices are UI
// DECIMAL STRINGS (e.g. "11.5") unless a field name says otherwise.
// GOTCHAS.md → "V1-shaped responses" · openapi.v2.json is the full reference.
// ─────────────────────────────────────────────────────────────────────────────

/** Position direction. (The API also knows "SWAP" — V2 rejects it.) */
export type TradeType = "LONG" | "SHORT";
/** MARKET executes at oracle price now; LIMIT rests until `limitPrice`. */
export type OrderType = "MARKET" | "LIMIT";
/** Collateral adjustment direction for preview/margin. */
export type MarginAction = "ADD" | "REMOVE";

// ── Requests: trading (ER chain) ─────────────────────────────────────────────

/**
 * Open (or increase) a position — MARKET, or LIMIT with optional bundled TP/SL.
 * Omit `owner` → preview-only (quote, no transactionBase64). Include it → tx too.
 * `signer`+`sessionToken` switch fee-payer/signing to a session key (see GOTCHAS).
 */
export interface OpenPositionRequest {
  inputTokenSymbol: string;          // collateral, e.g. "USDC"
  outputTokenSymbol: string;         // market, e.g. "SOL"
  inputAmountUi: string;             // collateral amount (UI units)
  leverage: number;                  // 5.0 = 5x
  tradeType: TradeType;
  orderType?: OrderType;             // default MARKET
  limitPrice?: string;               // REQUIRED when orderType=LIMIT
  takeProfit?: string;               // optional bundled TP trigger price
  stopLoss?: string;                 // optional bundled SL trigger price
  owner?: string;                    // omit = preview-only
  slippagePercentage?: string;       // default "0.5"
  signer?: string;                   // session signer pubkey (optional)
  sessionToken?: string;             // session token account (optional)
}

/** Close fully or partially. ≥97% of size (or 0) = FULL close on-chain. */
export interface ClosePositionRequest {
  marketSymbol: string;
  side: TradeType;
  inputUsdUi: string;                // USD notional to close ("0" = full)
  withdrawTokenSymbol: string;       // settlement token, e.g. "USDC"
  owner: string;                     // REQUIRED (unlike open)
  slippagePercentage?: string;
  signer?: string;
  sessionToken?: string;
}

/** Flip LONG↔SHORT atomically. Proceeds take a 2% haircut before reopening. */
export interface ReversePositionRequest {
  marketSymbol: string;
  side: TradeType;                   // CURRENT side; new position is opposite
  leverage: number;                  // leverage for the NEW side
  owner: string;
  slippagePercentage?: string;
  signer?: string;
  sessionToken?: string;
}

export interface AddCollateralRequest {
  marketSymbol: string;
  side: TradeType;
  depositAmountUi: string;           // in deposit token units
  depositTokenSymbol: string;
  owner: string;
  slippagePercentage?: string;
  signer?: string;
  sessionToken?: string;
}

export interface RemoveCollateralRequest {
  marketSymbol: string;
  side: TradeType;
  withdrawAmountUsdUi: string;       // USD; must be > 0 and < current collateral
  withdrawTokenSymbol: string;
  owner: string;
  slippagePercentage?: string;
  signer?: string;
  sessionToken?: string;
}

/** Place ONE trigger order (TP or SL) on an existing position. Slots 0–4. */
export interface PlaceTriggerOrderRequest {
  marketSymbol: string;
  side: TradeType;
  triggerPriceUi: string;
  sizeAmountUi: string;              // TARGET-token size to close when it fires
  isStopLoss: boolean;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

/** Place TP and/or SL in one atomic tx. At least one of the two is required. */
export interface PlaceTpSlRequest {
  marketSymbol: string;
  side: TradeType;
  takeProfitUi?: string;
  stopLossUi?: string;
  sizeAmountUi: string;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

/** Edit a trigger slot. BOTH price and size are required (no "keep existing"). */
export interface EditTriggerOrderRequest {
  marketSymbol: string;
  side: TradeType;
  orderId: number;                   // slot 0–4
  isStopLoss: boolean;
  triggerPriceUi: string;
  sizeAmountUi: string;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

/** Cancel one trigger slot — or pass orderId 255 to cancel ALL for the market. */
export interface CancelTriggerOrderRequest {
  marketSymbol: string;
  side: TradeType;
  orderId: number;                   // 0–4, or 255 = cancel all
  isStopLoss: boolean;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

/** Cancel a resting limit order (slot 0–4). Frees its reserved collateral. */
export interface CancelLimitOrderRequest {
  marketSymbol: string;
  side: TradeType;
  orderId: number;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

/** Edit a limit order. Here 0/omitted per field means KEEP EXISTING (opposite
 *  semantics to edit-trigger — see GOTCHAS.md). */
export interface EditLimitOrderRequest {
  marketSymbol: string;
  side: TradeType;
  orderId: number;
  limitPriceUi?: string;
  sizeAmountUi?: string;
  takeProfitUi?: string;
  stopLossUi?: string;
  owner: string;
  signer?: string;
  sessionToken?: string;
}

// ── Requests: account setup + withdrawal (BASE chain) ────────────────────────

/** One-time: create the owner's Basket PDA (holds ALL positions + orders). */
export interface InitBasketRequest { owner: string }
/** One-time: create the owner's deposit ledger (collateral inbox). */
export interface InitDepositLedgerRequest { owner: string }

/** Hand the basket to the MagicBlock validator so it can run on the ER.
 *  commitFrequency/validator are protocol-fixed server-side — not configurable. */
export interface DelegateBasketRequest {
  payer: string;                     // pays fees + signs
  owner: string;                     // whose basket gets delegated
}

/** Move tokens into the platform vault. NOTE: takes a MINT pubkey, not a symbol. */
export interface DepositDirectRequest {
  owner: string;
  tokenMint: string;                 // mint address (get it from client.tokens())
  amount: string;                    // UI units
}

export interface RequestWithdrawalRequest {
  owner: string;
  tokenMint: string;
  amount: string;
  includeCustodySettlement?: boolean; // default true
}

export interface ExecuteWithdrawalRequest {
  owner: string;
  tokenMint: string;
  includeCustodySettlement?: boolean; // default true
}

// ── Requests: previews (read-only math, no tx) ───────────────────────────────

export interface PreviewLimitOrderFeesRequest {
  marketSymbol: string;
  inputAmountUi: string;             // collateral
  outputAmountUi: string;            // size
  side: TradeType;
  limitPrice?: string;               // omit = quote at live price
}

export interface PreviewExitFeeRequest {
  marketSymbol: string;
  side: TradeType;
  closeAmountUsdUi: string;
  owner: string;                     // reads your live position
}

/** forward: trigger price → PnL. reverse_pnl / reverse_roi: target → trigger price. */
export interface PreviewTpSlRequest {
  mode: "forward" | "reverse_pnl" | "reverse_roi";
  marketSymbol: string;
  side: TradeType;
  owner?: string;                    // present = use live position; absent = inline:
  entryPriceUi?: string;
  sizeUsdUi?: string;
  collateralUsdUi?: string;
  triggerPriceUi?: string;           // forward
  targetPnlUsdUi?: string;           // reverse_pnl
  targetRoiPercent?: number;         // reverse_roi
}

export interface PreviewMarginRequest {
  marketSymbol: string;
  side: TradeType;
  marginDeltaUsdUi: string;
  action: MarginAction;
  owner: string;
}

// ── Responses ────────────────────────────────────────────────────────────────

/** TP/SL quote embedded in open-position responses. */
export interface TriggerQuote {
  exitPriceUi: string;
  profitUsdUi: string;
  lossUsdUi: string;
  exitFeeUsdUi: string;
  receiveUsdUi: string;
  pnlPercentage: string;
}

/**
 * open-position returns a full quote alongside the (optional) transaction.
 * `old*` fields appear only when increasing an existing position (blended).
 * `swap*` fields are ALWAYS null on V2 (no swaps on the ER).
 */
export interface OpenPositionResponse {
  oldLeverage?: string | null;
  newLeverage: string;
  oldEntryPrice?: string | null;
  newEntryPrice: string;
  oldLiquidationPrice?: string | null;
  newLiquidationPrice: string;
  entryFee: string;
  entryFeeBeforeDiscount: string;
  openPositionFeePercent: string;
  availableLiquidity: string;
  youPayUsdUi: string;
  /** API field is genuinely misspelled — matches the backend, do not rename. */
  youRecieveUsdUi: string;
  marginFeePercentage: string;       // HOURLY borrow rate (Flash charges borrow, not funding)
  outputAmount: string;              // native units
  outputAmountUi: string;
  transactionBase64?: string | null; // present only when `owner` was provided
  swapInPriceUi?: string | null;     // always null on V2
  swapOutPriceUi?: string | null;    // always null on V2
  swapFeeUsdUi?: string | null;      // always null on V2
  takeProfitQuote?: TriggerQuote | null;
  stopLossQuote?: TriggerQuote | null;
  err?: string | null;
}

export interface ClosePositionResponse {
  receiveTokenSymbol: string;
  receiveTokenAmountUi: string;
  receiveTokenAmountUsdUi: string;
  markPrice: string;
  entryPrice: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;       // "0" on a full close
  existingSize: string;
  newSize: string;
  existingCollateral: string;
  newCollateral: string;
  existingLeverage: string;
  newLeverage: string;
  settledPnl: string;                // signed ("-" prefix on losses)
  fees: string;
  feesBeforeDiscount: string;
  lockAndUnsettledFeeUsd?: string | null; // present only on PARTIAL closes
  transactionBase64?: string | null;
  err?: string | null;
}

export interface AddCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  depositUsdValue: string;
  maxAddableUsd: string;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface RemoveCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  receiveAmountUi: string;
  receiveAmountUsdUi: string;
  maxWithdrawableUsd: string;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface ReversePositionResponse {
  closeReceiveUsd: string;
  closeFees: string;
  closeSettledPnl: string;
  newSide: string;                   // "Long" | "Short"
  newLeverage: string;
  newEntryPrice: string;
  newLiquidationPrice: string;
  newSizeUsd: string;
  newSizeAmountUi: string;
  newCollateralUsd: string;          // AFTER the 2% haircut
  openEntryFee: string;
  transactionBase64?: string | null;
  err?: string | null;
}

/** Trigger + limit management endpoints return just the unsigned tx. */
export interface TxOnlyResponse {
  transactionBase64: string;
}

export interface PreviewLimitOrderFeesResponse {
  entryPriceUi: string;
  entryFeeUsdUi: string;
  liquidationPriceUi: string;
  borrowRateUi: string;
  err?: string | null;
}

export interface PreviewExitFeeResponse {
  exitFeeUsdUi: string;
  exitFeeAmountUi: string;
  exitPriceUi: string;
  err?: string | null;
}

export interface PreviewTpSlResponse {
  pnlUsdUi?: string | null;          // forward mode
  pnlPercentage?: string | null;     // forward mode
  triggerPriceUi?: string | null;    // reverse modes
  err?: string | null;
}

export interface PreviewMarginResponse {
  newLeverageUi: string;
  newLiquidationPriceUi: string;
  maxAmountUsdUi: string;
  existingCollateralUsdUi?: string | null;
  newCollateralUsdUi?: string | null;
  existingLeverageUi?: string | null;
  existingLiquidationPriceUi?: string | null;
  deltaUsdUi?: string | null;
  err?: string | null;
}

// ── Reads: owner snapshot, prices, tokens, health ────────────────────────────

export interface OraclePriceRaw {
  price: string;
  exponent: number;
  confidence: string;                // always "0" on V2 (Pyth Lazer spot)
  timestamp: string;
}

/** Live, enriched metrics for one position (keyed by market pubkey). */
export interface PositionMetrics {
  marketSymbol: string;
  collateralSymbol: string;
  sideUi: string;                    // "Long" | "Short"
  entryPriceUi: string;
  sizeAmountUi: string;
  sizeAmountUiKmb?: string | null;
  sizeUsdUi: string;
  collateralAmountUi: string;
  collateralAmountUiKmb?: string | null;
  collateralUsdUi: string;
  pnlWithFeeUsdUi: string;           // signed
  pnlPercentageWithFee: string;      // signed
  pnlWithoutFeeUsdUi: string;
  pnlPercentageWithoutFee: string;
  liquidationPriceUi: string;
  leverageUi: string;                // may be the string "Infinity"
  // ↓ RAW NATIVE strings (6-decimal USD) — divide by 1e6 for UI dollars.
  //   Exception to the "everything is UI" rule; the *Ui fields above are UI.
  profitUsd: string;                 // raw 6-dec USD
  lossUsd: string;                   // raw 6-dec USD
  exitFeeUsd: string;                // raw 6-dec USD
  borrowFeeUsd: string;              // raw 6-dec USD — cumulative borrow paid
  totalFeeUsd: string;               // raw 6-dec USD
  leverage: string;                  // raw BPS (u128 string)
  marginUsd: string;                 // raw 6-dec USD
  liquidationPrice: OraclePriceRaw;
  exitPrice: OraclePriceRaw;
}

export interface TriggerOrderMetrics {
  orderId: number;
  type: "TP" | "SL";
  triggerPriceUi: string;
  sizeAmountUi: string;
  sizeUsdUi?: string | null;
}

export interface LimitOrderMetrics {
  orderId: number;
  limitPriceUi: string;
  sizeAmountUi: string;
  sizeUsdUi?: string | null;
  takeProfitUi?: string | null;
  stopLossUi?: string | null;
  reserveAmountUi?: string | null;
}

export interface OrderMetrics {
  marketSymbol: string;
  sideUi: string;
  limitOrders: LimitOrderMetrics[];
  takeProfitOrders: TriggerOrderMetrics[];
  stopLossOrders: TriggerOrderMetrics[];
}

/**
 * Everything about one owner, in one shot — the V2 read model.
 * `basketData` is the raw account (base64); positions/orders are pre-enriched
 * for you in positionMetrics/orderMetrics (keyed by MARKET PUBKEY).
 */
export interface BasketSnapshot {
  owner: string;
  basketPubkey?: string | null;
  basketData?: string | null;
  positionMetrics: Record<string, PositionMetrics>;
  orderMetrics: Record<string, OrderMetrics>;
}

/** Live WS frames from /v2/owner/{owner}/ws — see subscribeOwner(). */
export type OwnerWsMessage =
  | { type: "basket"; data: BasketSnapshot }
  | { type: "metrics"; data: Record<string, PositionMetrics> };

export interface TokenInfo {
  symbol: string;
  mintKey: string;
  decimals: number;
  isStable: boolean;
  isVirtual: boolean;
  lazerId?: number | null;
  pythTicker?: string | null;
  isToken2022: boolean;
}

export interface PriceInfo {
  price: number;
  exponent: number;
  confidence: number;
  priceUi: number;
  timestampUs: number;
  marketSession: string;             // "regular" | "preMarket" | "postMarket" | "overNight" | "closed"
}

export interface HealthResponse {
  status: string;
  program: string;                   // "magicblock"
  accounts: Record<string, number>;  // pools/custodies/markets/baskets/deposit_ledgers
  config: {
    source: string;                  // "cdn" | "bundled"
    env: string;                     // "dev" | "prod" (independent of cluster!)
    version?: string | null;
    branch?: string | null;
    publishedAt?: string | null;
    loadedAtUnix?: number | null;
    pools?: number;
    markets?: number;
    tokens?: number;
  };
}

/** Raw Anchor-decoded account wrapper for the /v2/raw/* endpoints. */
export interface RawAccount<T = unknown> {
  pubkey: string;
  account: T;
}
