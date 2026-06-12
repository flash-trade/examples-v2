// ─────────────────────────────────────────────────────────────────────────────
// app/api/leaders/route.ts — same-origin read-only proxy for the PUBLIC fstats
// V2/ER leaderboard. WHY IT EXISTS: fstats serves leader rankings (win rate,
// PnL) for the MagicBlock ER but does NOT send CORS headers, so a browser can't
// fetch it directly. This route fetches it server-side and hands the JSON back.
// It carries NO keys and reaches NO RPC — it only relays public stats. (Live
// LEADER POSITIONS come straight from flashapi.trade over the owner WS, which
// DOES serve CORS — see lib/copy-engine.ts; this is discovery only.)
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const FSTATS = "https://fstats.io/v2/api/v1";

export async function GET(): Promise<Response> {
  try {
    const [lbRes, openRes] = await Promise.all([
      fetch(`${FSTATS}/leaderboards/pnl`, { cache: "no-store" }),
      fetch(`${FSTATS}/positions/open`, { cache: "no-store" }),
    ]);
    if (!lbRes.ok) throw new Error(`fstats leaderboard ${lbRes.status}`);
    const lb = (await lbRes.json()) as { leaderboard?: unknown[] };
    // positions/open is best-effort — it only enriches rows with "live now" counts
    let openByOwner: Record<string, number> = {};
    if (openRes.ok) {
      const open = (await openRes.json()) as { positions?: Array<{ owner: string }> };
      openByOwner = (open.positions ?? []).reduce<Record<string, number>>((acc, p) => {
        acc[p.owner] = (acc[p.owner] ?? 0) + 1;
        return acc;
      }, {});
    }
    return Response.json(
      { leaders: lb.leaderboard ?? [], openByOwner },
      { headers: { "Cache-Control": "public, max-age=10" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
