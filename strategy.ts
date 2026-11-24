// Pump.fun replay bot for the 6-hour sprint (agent-fun/replay/v2).
//
// The final window is only 6 hours, so the guardrail (>= 20 distinct mints
// with a >= 0.01 SOL round trip) is the binding constraint, not raw PnL.
// The dev window is 24h with 1222 mints: ~51 mints/hour, so a 6h final
// window holds ~300 mints. A shape that trades 21 coins in 24h (the
// sibling entry's V7) would trade ~5 in 6h and fail the guardrail. The
// entry therefore has to be broad: catch coins at a low multiple where
// many qualify (286 mints reach >= 2x in 24h, ~72 in 6h; 145 reach >= 3x,
// ~36 in 6h; only 80 reach >= 5x, ~20 in 6h — right on the edge).
// Breadth is bought with a low entry multiple and sold back with fast,
// mechanical exits: bank a third at +15%, half the rest at +100%, cut at
// -15%, dump on negative flow, never hold past 350 slots, never add to a
// position. No pyramid, no trail (both lost money in the sibling sweep),
// no randomness, no clock, no I/O: a pure function of the batch stream.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Cfg {
  // ---- runner entry ----
  /** First-buy window, slots since create. */
  ageMin: number;
  ageMax: number;
  /** Price over create price required to enter. */
  entryMult: number;
  /** Real SOL on the curve at decision time, at least. */
  minReserveSol: number;
  /** Distinct buyers on the coin so far, at least. */
  minBuyers: number;
  /** Distinct buyers at entry, at most (bundled-launch guard). */
  maxBuyers: number;
  /** Net SOL bought over flowSpan slots, at least. */
  minFlowSol: number;
  /** Flow window, slots. */
  flowSpan: number;
  /** Skip the coin when its creator sold before entry. */
  skipCreatorSold: boolean;
  /** First buy, SOL. The 1%-of-reserve cap binds first at low multiples. */
  stakeSol: number;
  /** Slots allowed from the first 2x crossing to the entry multiple. */
  riseWindow: number;
  // ---- dip entry (second chance on a proven runner) ----
  /** Dip buy: price at most this fraction of the high over dipSpan slots. */
  dipFrac: number;
  dipSpan: number;
  /** Dip buy: distinct buyers inside the dip window, at least. */
  dipBuyers: number;
  /** Dip buy: net SOL inside the dip window, at least. */
  dipFlowSol: number;
  /** Dip buy: real SOL at decision, at least. */
  dipReserveSol: number;
  /** Dip buy size, SOL. 0 = dip entry off. */
  dipStakeSol: number;
  /** Dip buy: only coins whose peak multiple reached this. */
  dipPeakMult: number;
  // ---- ladder add (add once a proven runner reaches a higher multiple) ----
  /** SOL per add into strength. 0 = no adds. */
  addSol: number;
  /** Price gain (fraction) over the last buy price that triggers an add. */
  addStep: number;
  /** Most SOL at cost in one coin (entry + adds). */
  addMaxSol: number;
  /** Most slots after create that adds are allowed. */
  addMaxAge: number;
  // ---- boosted exits: once a position got its add (it proved itself by
  // reaching a higher multiple), it exits on the selective profile, not the
  // broad profile — the two populations behave differently. ----
  /** Boosted stop, TP1 gain/share, TP2 gain/share, hold cap. */
  boostStop: number;
  boostTp1Gain: number;
  boostTp1Share: number;
  boostTp2Gain: number;
  boostTp2Share: number;
  boostHoldMax: number;
  // ---- exits ----
  /** Sell everything when value falls this far under cost. */
  stopFrac: number;
  /** First take-profit: sell tp1Share of tokens at this gain. */
  tp1Gain: number;
  tp1Share: number;
  /** Second take-profit: sell tp2Share of the remainder at this gain. */
  tp2Gain: number;
  tp2Share: number;
  /** Trailing stop: arms at this peak gain, sells on a trailFrac fall from peak value. 100 = off. */
  trailArmGain: number;
  trailFrac: number;
  /** Hard exit after this many slots held. */
  holdMax: number;
  /** Exit when net flow over exitFlowSpan slots drops below -exitFlowSol. */
  exitFlowSpan: number;
  exitFlowSol: number;
  /** Exit a flat position with no trade for this many slots (gain under +50%). */
  staleAfter: number;
  // ---- sizing / misc ----
  /** Buy/sell slippage, bps. */
  slipBps: number;
  /** Most SOL at cost across all open positions at once. */
  exposureMaxSol: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  rebuyCooldown: number;
  /** Most entries per coin over the whole run. */
  entriesPerCoin: number;
}

/** SHIPPED CONFIG (verified by grade-local, full dev window):
 *  Broad 3x entry, 0.1 SOL stake, tight exits (stop -10%, TP1 +25% sell
 *  half, TP2 +100% sell half, hold 250 slots, flow exit -1.5 SOL/30).
 *  Sweep (~25 configs): 5x runner is the only clearly positive shape
 *  (+0.58, 21 coins) but it cannot clear the 6h final guardrail
 *  (>= 20 mints in ~300; 21 coins/24h -> ~5/6h). 3x is the broadest
 *  near-breakeven shape (-0.37, 93 coins -> ~23/6h, clears the guardrail).
 *  2x/2.5x, dip entries, pyramid adds, re-entries and tighter/looser
 *  exits all scored worse. A position whose coin reaches 5x switches to
 *  the selective exit profile (stop -15%, TP1 +15%, hold 350). */
export const DEFAULT: Cfg = {
  ageMin: 0,
  ageMax: 5000,
  entryMult: 3,
  minReserveSol: 2,
  minBuyers: 1,
  maxBuyers: 1000,
  minFlowSol: 0,
  flowSpan: 30,
  skipCreatorSold: false,
  stakeSol: 0.1,
  riseWindow: 300,
  dipFrac: 0.25,
  dipSpan: 100,
  dipBuyers: 3,
  dipFlowSol: 0,
  dipReserveSol: 3,
  dipStakeSol: 0,
  dipPeakMult: 2,
  addSol: 0,
  addStep: 0.67,
  addMaxSol: 0.5,
  addMaxAge: 5000,
  boostStop: 0.15,
  boostTp1Gain: 0.15,
  boostTp1Share: 0.33,
  boostTp2Gain: 1,
  boostTp2Share: 0.5,
  boostHoldMax: 350,
  stopFrac: 0.1,
  tp1Gain: 0.25,
  tp1Share: 0.5,
  tp2Gain: 1,
  tp2Share: 0.5,
  trailArmGain: 100,
  trailFrac: 0.15,
  holdMax: 250,
  exitFlowSpan: 30,
  exitFlowSol: 1.5,
  staleAfter: 1000,
  slipBps: 10000,
  exposureMaxSol: 6,
  rebuyCooldown: 0,
  entriesPerCoin: 1,
};

const LAMPORTS = 1e9;

interface Tick {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Book {
  created: number | null;
  creator: string;
  p0: number;
  peak: number;
  t2x: number;
  ticks: Tick[];
  buyers: Set<string>;
  creatorSold: boolean;
  entries: number;
  lastExit: number;
  lastTrade: number;
}

interface Open {
  opened: number;
  peakValue: number;
  peakGain: number;
  filled: boolean;
  tp1Done: boolean;
  tp2Done: boolean;
  invested: number;
  lastAddPrice: number;
  boosted: boolean;
}

export function createStrategy(cfg: Cfg = DEFAULT) {
  const books = new Map<Pubkey, Book>();
  const open = new Map<Pubkey, Open>();
  const keep = Math.max(cfg.flowSpan, cfg.dipSpan, cfg.exitFlowSpan) + 10;

  const bookOf = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = {
        created: null, creator: '', p0: 0, peak: 0, t2x: 0, ticks: [],
        buyers: new Set(), creatorSold: false, entries: 0,
        lastExit: -1e12, lastTrade: -1e12,
      };
      books.set(mint, b);
    }
    return b;
  };

  /** Net SOL flow, distinct buyers and high price over the last `span` slots. */
  const recent = (b: Book, now: number, span: number): { net: number; buyers: number; high: number } => {
    let net = 0;
    let high = 0;
    const buyers = new Set<string>();
    for (let i = b.ticks.length - 1; i >= 0; i--) {
      const t = b.ticks[i]!;
      if (t.slot <= now - span) break;
      net += t.buy ? t.sol : -t.sol;
      if (t.buy) buyers.add(t.user);
      if (t.price > high) high = t.price;
    }
    return { net, buyers: buyers.size, high };
  };

  /** SOL received for selling `tokens` at these reserves, after the 1.25%
   *  curve fee and one transaction fee. Mirrors the bonding-curve math. */
  const quoteOut = (tokens: bigint, vq: bigint, vt: bigint, txFee: bigint): number => {
    if (tokens <= 0n || vt <= 0n) return 0;
    const q = (tokens * vq) / (vt + tokens);
    const net = Number(q - (q * 125n + 9999n) / 10_000n) / LAMPORTS;
    return net - Number(txFee) / LAMPORTS;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();

      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const b = bookOf(e.mint);
          b.created = e.slot;
          b.creator = e.creator;
          b.p0 = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const b = bookOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          b.lastTrade = e.slot;
          b.ticks.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          if (e.is_buy) {
            b.buyers.add(e.user);
          } else if (e.user === b.creator) {
            b.creatorSold = true;
          }
          if (b.p0 > 0 && price / b.p0 > b.peak) b.peak = price / b.p0;
          if (b.p0 > 0 && b.t2x === 0 && price / b.p0 >= 2) b.t2x = e.slot;
          traded.add(e.mint);
        }
      }
      for (const mint of traded) {
        const b = books.get(mint)!;
        let cut = 0;
        while (cut < b.ticks.length && b.ticks[cut]!.slot <= now - keep) cut++;
        if (cut > 0) b.ticks.splice(0, cut);
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pending = new Map<Pubkey, number>();
      const pendingSell = new Set<Pubkey>();
      for (const po of state.pending.values()) {
        pending.set(po.order.mint, (pending.get(po.order.mint) ?? 0) + 1);
        if (po.order.side === 'sell') pendingSell.add(po.order.mint);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const txSol = Number(txFee) / LAMPORTS;

      // --- exits first: never hold a loser past its rules ---
      for (const [mint, o] of open) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pending.has(mint)) {
            open.delete(mint);
            const b = bookOf(mint);
            if (o.filled) b.lastExit = now;
            else b.entries--;
          }
          continue;
        }
        o.filled = true;
        if (curve === undefined || curve.complete || pendingSell.has(mint)) continue;
        const mk = marks.get(mint);
        const vq = mk ? BigInt(mk.virtual_quote_reserves) : curve.virtual_quote_reserves;
        const vt = mk ? BigInt(mk.virtual_token_reserves) : curve.virtual_token_reserves;
        const value = quoteOut(BigInt(pos.token_amount), vq, vt, txFee);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > o.peakValue) o.peakValue = value;
        const gain = cost > 0 ? value / cost - 1 : 0;
        if (gain > o.peakGain) o.peakGain = gain;
        const b = bookOf(mint);
        // A position whose coin proves itself by reaching 5x switches to the
        // selective exit profile from then on — the cheap 3x ticket becomes
        // a 5x runner's position, with no add and no extra capital at risk.
        if (b.peak >= 5.0) o.boosted = true;
        // Boosted positions (got their add at a higher multiple) exit on the
        // selective profile; unboosted ones on the broad profile.
        const stop = o.boosted ? cfg.boostStop : cfg.stopFrac;
        const tp1g = o.boosted ? cfg.boostTp1Gain : cfg.tp1Gain;
        const tp1s = o.boosted ? cfg.boostTp1Share : cfg.tp1Share;
        const tp2g = o.boosted ? cfg.boostTp2Gain : cfg.tp2Gain;
        const tp2s = o.boosted ? cfg.boostTp2Share : cfg.tp2Share;
        const hold = o.boosted ? cfg.boostHoldMax : cfg.holdMax;
        let dump = false;
        if (gain <= -stop) {
          dump = true;
        } else if (!o.tp1Done && gain >= tp1g) {
          if (orders.length < cap) {
            const amt = (BigInt(pos.token_amount) * BigInt(Math.round(tp1s * 100))) / 100n;
            if (amt > 0n && amt < BigInt(pos.token_amount)) {
              orders.push({ side: 'sell', mint, token_amount: amt, max_slippage_bps: cfg.slipBps });
              o.tp1Done = true;
            }
          }
        } else if (o.tp1Done && !o.tp2Done && gain >= tp2g) {
          if (orders.length < cap) {
            const amt = (BigInt(pos.token_amount) * BigInt(Math.round(tp2s * 100))) / 100n;
            if (amt > 0n && amt < BigInt(pos.token_amount)) {
              orders.push({ side: 'sell', mint, token_amount: amt, max_slippage_bps: cfg.slipBps });
              o.tp2Done = true;
            }
          }
        }
        // Trailing stop arms on PEAK gain: arming on the current gain can
        // never fire for modest winners, because a pullback from the peak
        // drops the current gain below the arm level first.
        if (!dump && o.peakGain >= cfg.trailArmGain && value < o.peakValue * (1 - cfg.trailFrac)) dump = true;
        if (!dump && recent(b, now, cfg.exitFlowSpan).net < -cfg.exitFlowSol) dump = true;
        if (!dump && now - o.opened > hold) dump = true;
        if (!dump && gain < 0.5 && now - b.lastTrade > cfg.staleAfter) dump = true;
        if (!dump) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: cfg.slipBps });
      }

      // --- entries: one buy per coin, sized by the 1% reserve cap ---
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const mint of open.keys()) {
        exposure += Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS;
      }
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pending.has(mint)) continue;
        const b = books.get(mint)!;
        if (b.created === null || b.p0 <= 0) continue;
        const age = now - b.created;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const mult = price / b.p0;
        const reserveSol = Number(curve.real_quote_reserves) / LAMPORTS;
        const held = open.get(mint);
        if (held !== undefined) {
          // One add into strength: when a 3x entry proves itself by reaching
          // a higher multiple, size up to the proven level. Only once, only
          // while flow is still positive — never average down, never chase.
          if (cfg.addSol <= 0 || held.invested >= cfg.addMaxSol - 0.001 || age > cfg.addMaxAge) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined || !held.filled) continue;
          if (price < held.lastAddPrice * (1 + cfg.addStep)) continue;
          // Same discipline as a fresh entry: only add near the coin's own
          // high, never into a fade that is passing back through the level.
          if (price < b.peak * 0.9 * b.p0) continue;
          if (recent(b, now, cfg.flowSpan).net < 0) continue;
          const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
          let amount = Math.min(cfg.addSol, cfg.addMaxSol - held.invested, capSol, cfg.exposureMaxSol - exposure);
          if (amount > free - txSol) amount = free - txSol;
          if (amount < 0.01) continue;
          orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: cfg.slipBps });
          free -= amount + txSol;
          exposure += amount;
          held.invested += amount;
          held.lastAddPrice = price;
          held.boosted = true;
          continue;
        }
        if (slotsLeft <= 0) continue;
        if (b.entries >= cfg.entriesPerCoin || now - b.lastExit < cfg.rebuyCooldown) continue;
        let want = 0;
        const flow = recent(b, now, cfg.flowSpan);
        // Runner: enter the first ascent at the entry multiple, near the
        // coin's own high so far — not a faded coin re-crossing on its way down.
        // riseWindow 0 disables the 2x gate (spray mode: enter before 2x).
        if (
          age >= cfg.ageMin && age <= cfg.ageMax &&
          mult >= cfg.entryMult && mult >= b.peak * 0.9 &&
          reserveSol >= cfg.minReserveSol &&
          (cfg.riseWindow === 0 || (b.t2x > 0 && now - b.t2x <= cfg.riseWindow)) &&
          b.buyers.size >= cfg.minBuyers && b.buyers.size <= cfg.maxBuyers &&
          flow.net >= cfg.minFlowSol &&
          (!cfg.skipCreatorSold || !b.creatorSold)
        ) {
          want = cfg.stakeSol;
        } else if (cfg.dipStakeSol > 0 && age <= 2000 && b.peak >= cfg.dipPeakMult && reserveSol >= cfg.dipReserveSol) {
          // Dip: sharp pullback on a proven runner, buyers stepping back in.
          const dw = recent(b, now, cfg.dipSpan);
          if (
            dw.high > 0 && price <= dw.high * (1 - cfg.dipFrac) &&
            dw.buyers >= cfg.dipBuyers && dw.net >= cfg.dipFlowSol &&
            (!cfg.skipCreatorSold || !b.creatorSold)
          ) {
            want = cfg.dipStakeSol;
          }
        }
        if (want <= 0) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, want, cfg.exposureMaxSol - exposure);
        if (amount > free - txSol) amount = free - txSol;
        if (amount < 0.002) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: cfg.slipBps });
        free -= amount + txSol;
        exposure += amount;
        open.set(mint, { opened: now, peakValue: 0, peakGain: 0, filled: false, tp1Done: false, tp2Done: false, invested: amount, lastAddPrice: price, boosted: false });
        b.entries++;
        slotsLeft--;
      }
      return orders;
    },
  };
}
