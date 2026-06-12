// ─────────────────────────────────────────────────────────────────────────────
// errors.ts — ONE error type for the API's THREE error channels.
// THE HARD PART: trading endpoints return HTTP 200 with an `err` field in the
// body; trigger/limit endpoints return HTTP 400 with a plain-text body; setup/
// withdrawal endpoints return a bare HTTP 500 with an EMPTY body. This module
// normalizes all three so your code handles exactly one shape.
// GOTCHAS.md → "Three error channels"
// ─────────────────────────────────────────────────────────────────────────────

/** Which of the API's three error styles produced this error. */
export type ErrorChannel =
  | "body-err"   // HTTP 200, but the JSON body carried `err: "..."` (trading/previews)
  | "http-400"   // HTTP 400 with a plain-text reason (trigger/limit validation)
  | "http-500"   // HTTP 500 with an empty body (setup/withdrawal — reason is server-side only)
  | "http-other" // anything else (404 raw lookups, 429/503 WS limits, network failures)
  ;

/** Normalized Flash V2 API error. `channel` tells you which style the API used. */
export class FlashV2Error extends Error {
  readonly channel: ErrorChannel;
  readonly status: number | undefined;
  readonly endpoint: string;

  constructor(opts: { channel: ErrorChannel; endpoint: string; message: string; status?: number }) {
    super(`[${opts.channel}] ${opts.endpoint}: ${opts.message}`);
    this.name = "FlashV2Error";
    this.channel = opts.channel;
    this.endpoint = opts.endpoint;
    this.status = opts.status;
  }
}

/**
 * Throw if a 200-OK trading/preview response actually failed.
 * The single most-missed check on this API: `err` arrives with HTTP 200.
 * @example
 * const quote = await client.openPosition(req); // client calls assertNoErr for you
 */
export function assertNoErr<T extends { err?: string | null }>(endpoint: string, body: T): T {
  if (body.err) {
    throw new FlashV2Error({ channel: "body-err", endpoint, message: body.err, status: 200 });
  }
  return body;
}
