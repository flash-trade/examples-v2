// ─────────────────────────────────────────────────────────────────────────────
// client.ts — the entire Flash V2 REST surface, typed and thin (35 REST
// methods here; the 36th API path is the owner WebSocket → owner-stream.ts).
// THE HARD PART: this API has three different error styles. Every call below
// funnels through one request() that normalizes them into FlashV2Error, and
// `err`-in-a-200 is thrown for you. Transactions come back PARTIALLY SIGNED
// (base64) — the server pre-filled its signer slots and chose the blockhash;
// you add ONLY your signature (sign.ts) and submit to the chain noted per method.
// GOTCHAS.md → "Three error channels" · "Two-chain mental model"
// ─────────────────────────────────────────────────────────────────────────────

import { resolveNetwork, type NetworkConfig } from "./network.ts";
import { FlashV2Error, assertNoErr } from "./errors.ts";
import type {
  AddCollateralRequest, AddCollateralResponse,
  BasketSnapshot,
  CancelLimitOrderRequest, CancelTriggerOrderRequest,
  ClosePositionRequest, ClosePositionResponse,
  DelegateBasketRequest, DepositDirectRequest,
  EditLimitOrderRequest, EditTriggerOrderRequest,
  ExecuteWithdrawalRequest,
  HealthResponse,
  InitBasketRequest, InitDepositLedgerRequest,
  OpenPositionRequest, OpenPositionResponse,
  PlaceTpSlRequest, PlaceTriggerOrderRequest,
  PreviewExitFeeRequest, PreviewExitFeeResponse,
  PreviewLimitOrderFeesRequest, PreviewLimitOrderFeesResponse,
  PreviewMarginRequest, PreviewMarginResponse,
  PreviewTpSlRequest, PreviewTpSlResponse,
  PriceInfo,
  RawAccount,
  RemoveCollateralRequest, RemoveCollateralResponse,
  RequestWithdrawalRequest,
  ReversePositionRequest, ReversePositionResponse,
  TokenInfo,
  TxOnlyResponse,
} from "./types.ts";

/** `{ transactionBase64 }` returned by the setup/withdrawal builders. */
export interface BuiltTransaction { transactionBase64: string }

/**
 * Typed client for the hosted Flash V2 (MagicBlock) API.
 *
 * @example Read a live price — no wallet, no auth:
 * ```ts
 * const flash = new FlashV2Client();              // mainnet
 * const sol = await flash.price("SOL");
 * console.log(sol.priceUi);                       // 65.09...
 * ```
 *
 * @example Quote a trade (no owner = preview-only, no tx is built):
 * ```ts
 * const quote = await flash.openPosition({
 *   inputTokenSymbol: "USDC", outputTokenSymbol: "SOL",
 *   inputAmountUi: "11", leverage: 5, tradeType: "LONG",
 * });
 * console.log(quote.newEntryPrice, quote.entryFee, quote.newLiquidationPrice);
 * ```
 */
export class FlashV2Client {
  readonly network: NetworkConfig;

  constructor(config?: Partial<NetworkConfig>) {
    this.network = { ...resolveNetwork(), ...config };
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.network.apiBase}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new FlashV2Error({ channel: "http-other", endpoint: path, message: `network failure: ${(e as Error).message}` });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 400) {
        // Trigger/limit validation errors arrive as HTTP 400 with a plain-text reason.
        throw new FlashV2Error({ channel: "http-400", endpoint: path, message: text || "bad request", status: 400 });
      }
      if (res.status === 500) {
        // Setup/withdrawal failures arrive as a bare 500 with an EMPTY body —
        // the reason only exists in server logs. Check your inputs (mint vs
        // symbol, pool match, ordering) and see GOTCHAS.md.
        throw new FlashV2Error({
          channel: "http-500", endpoint: path, status: 500,
          message: text || "empty 500 — server logs only; verify inputs (tokenMint? lifecycle order?)",
        });
      }
      throw new FlashV2Error({ channel: "http-other", endpoint: path, message: text || res.statusText, status: res.status });
    }

    const json = (await res.json()) as T;
    // Trading + preview endpoints report failure as `err` inside a 200 body.
    return assertNoErr(path, json as T & { err?: string | null });
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Service health + live pool-config provenance (env/version/source). */
  health(): Promise<HealthResponse> { return this.request("GET", "/health"); }

  /** Token metadata for the active pool — symbols, MINTS (for deposits), decimals. */
  tokens(): Promise<TokenInfo[]> { return this.request("GET", "/tokens"); }

  /** All live oracle prices for the active pool, keyed by symbol. */
  prices(): Promise<Record<string, PriceInfo>> { return this.request("GET", "/prices"); }

  /** One symbol's live price (case-insensitive). 404 if not in the active pool. */
  price(symbol: string): Promise<PriceInfo> { return this.request("GET", `/prices/${encodeURIComponent(symbol)}`); }

  /** Aggregated pool stats (TVL, utilization, LP price). Cached ~5s server-side. */
  poolData(): Promise<unknown> { return this.request("GET", "/pool-data"); }

  /** Pool stats for one pool pubkey. */
  poolDataByPool(poolPubkey: string): Promise<unknown> { return this.request("GET", `/pool-data/${poolPubkey}`); }

  /**
   * THE read model: everything about one owner in one call — basket PDA, raw
   * basket bytes, and pre-enriched position/order metrics (PnL, leverage, liq).
   * For live updates use {@link subscribeOwner} (WebSocket) instead of polling.
   */
  owner(owner: string): Promise<BasketSnapshot> { return this.request("GET", `/owner/${owner}`); }

  /** Raw Anchor-decoded accounts (debugging / deep dives). */
  rawPools(): Promise<RawAccount[]> { return this.request("GET", "/raw/pools"); }
  rawPool(pubkey: string): Promise<RawAccount> { return this.request("GET", `/raw/pools/${pubkey}`); }
  rawCustodies(): Promise<RawAccount[]> { return this.request("GET", "/raw/custodies"); }
  rawCustody(pubkey: string): Promise<RawAccount> { return this.request("GET", `/raw/custodies/${pubkey}`); }
  rawMarkets(): Promise<RawAccount[]> { return this.request("GET", "/raw/markets"); }
  rawMarket(pubkey: string): Promise<RawAccount> { return this.request("GET", `/raw/markets/${pubkey}`); }
  /** NOTE: takes the BASKET PDA (from owner().basketPubkey), not the owner. */
  rawBasket(basketPubkey: string): Promise<RawAccount> { return this.request("GET", `/raw/baskets/${basketPubkey}`); }

  // ── account setup (sign + submit to the BASE chain) ──────────────────────────

  /** Step 1 (one-time): create your Basket PDA. → submit to network.baseRpc */
  initBasket(req: InitBasketRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/init-basket", req);
  }
  /** Step 2 (one-time): create your deposit ledger. → submit to network.baseRpc */
  initDepositLedger(req: InitDepositLedgerRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/init-deposit-ledger", req);
  }
  /** Step 3 (one-time): delegate the basket to the MagicBlock validator.
   *  → submit to network.baseRpc */
  delegateBasket(req: DelegateBasketRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/delegate-basket", req);
  }
  /** Step 4: fund your ledger. NOTE: tokenMint is a MINT ADDRESS (see tokens()).
   *  → submit to network.baseRpc */
  depositDirect(req: DepositDirectRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/deposit-direct", req);
  }

  // ── trading (sign + submit to the ER: network.erRpc) ─────────────────────────

  /**
   * Open/increase a position (MARKET or LIMIT, optional bundled TP/SL).
   * Omit `owner` for a pure quote. Response includes the full preview
   * (entry, fees, liquidation, hourly borrow %) alongside transactionBase64.
   * ⚠ The API does NOT validate limit/TP/SL prices against the oracle —
   * validate client-side with guards.validateTriggerPrice or the tx fails
   * on-chain with InvalidLimitPrice (6057). → submit to network.erRpc
   */
  openPosition(req: OpenPositionRequest): Promise<OpenPositionResponse> {
    return this.request("POST", "/transaction-builder/open-position", req);
  }

  /** Close. ⚠ inputUsdUi ≥ 97% of position size = FULL close on-chain
   *  (different instruction; guards.isFullClose tells you which you'll get).
   *  → submit to network.erRpc */
  closePosition(req: ClosePositionRequest): Promise<ClosePositionResponse> {
    return this.request("POST", "/transaction-builder/close-position", req);
  }

  /** Flip LONG↔SHORT atomically (2% haircut on proceeds). → network.erRpc */
  reversePosition(req: ReversePositionRequest): Promise<ReversePositionResponse> {
    return this.request("POST", "/transaction-builder/reverse-position", req);
  }

  /** Add margin (lowers leverage + liq risk). → network.erRpc */
  addCollateral(req: AddCollateralRequest): Promise<AddCollateralResponse> {
    return this.request("POST", "/transaction-builder/add-collateral", req);
  }

  /** Remove margin (raises leverage; bounded by maxWithdrawableUsd). → network.erRpc */
  removeCollateral(req: RemoveCollateralRequest): Promise<RemoveCollateralResponse> {
    return this.request("POST", "/transaction-builder/remove-collateral", req);
  }

  /** Place one TP or SL (slots 0–4, max 5 per side). → network.erRpc */
  placeTriggerOrder(req: PlaceTriggerOrderRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/place-trigger-order", req);
  }

  /** Place TP and/or SL atomically (≥1 required). → network.erRpc */
  placeTpSl(req: PlaceTpSlRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/place-tp-sl", req);
  }

  /** Edit a trigger slot — BOTH price and size required. → network.erRpc */
  editTriggerOrder(req: EditTriggerOrderRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/edit-trigger-order", req);
  }

  /** Cancel one trigger (orderId 0–4) or ALL for the market (orderId 255). → network.erRpc */
  cancelTriggerOrder(req: CancelTriggerOrderRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/cancel-trigger-order", req);
  }

  /** Cancel a resting limit order; returns its reserved collateral. → network.erRpc */
  cancelLimitOrder(req: CancelLimitOrderRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/cancel-limit-order", req);
  }

  /** Edit a limit order — here 0/omitted means KEEP existing (see GOTCHAS). → network.erRpc */
  editLimitOrder(req: EditLimitOrderRequest): Promise<TxOnlyResponse> {
    return this.request("POST", "/transaction-builder/edit-limit-order", req);
  }

  // ── withdrawal (sign + submit to the BASE chain) ─────────────────────────────

  /** Start the exit: escrow + schedule settlement. → network.baseRpc */
  requestWithdrawal(req: RequestWithdrawalRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/request-withdrawal", req);
  }
  /** Finish (or recover) the exit to your wallet. → network.baseRpc */
  executeWithdrawal(req: ExecuteWithdrawalRequest): Promise<BuiltTransaction> {
    return this.request("POST", "/transaction-builder/execute-withdrawal", req);
  }

  // ── previews (read-only math; no transaction) ───────────────────────────────

  /** Entry price/fee, liquidation, hourly borrow for a prospective limit order. */
  previewLimitOrderFees(req: PreviewLimitOrderFeesRequest): Promise<PreviewLimitOrderFeesResponse> {
    return this.request("POST", "/preview/limit-order-fees", req);
  }
  /** Exit fee + exit price for closing part of YOUR live position. */
  previewExitFee(req: PreviewExitFeeRequest): Promise<PreviewExitFeeResponse> {
    return this.request("POST", "/preview/exit-fee", req);
  }
  /** TP/SL math: price→PnL (forward) or target→price (reverse modes). */
  previewTpSl(req: PreviewTpSlRequest): Promise<PreviewTpSlResponse> {
    return this.request("POST", "/preview/tp-sl", req);
  }
  /** Effect of adding/removing margin on leverage + liquidation. */
  previewMargin(req: PreviewMarginRequest): Promise<PreviewMarginResponse> {
    return this.request("POST", "/preview/margin", req);
  }
}
