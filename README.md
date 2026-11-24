# Pump.fun Paper Sprint — broad-entry replay bot

A pump.fun paper-trading bot for the [make.fun bounty](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b).

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leonsis6/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leonsis6/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

The final window is only 6 hours, so the guardrail (≥ 20 distinct mints with a
≥ 0.01 SOL round trip) is the binding constraint. The bot therefore enters
broad — every coin at 3x its create price, near its own high, 0.1 SOL — and
exits mechanically: bank half at +25%, half the rest at +100%, cut at −10%,
dump on negative flow, never hold past 250 slots. A coin that proves itself by
reaching 5x switches to the selective exit profile (cut −15%, bank a third at
+15%, hold 350 slots). No pyramid adds, no trailing stop, no re-entries, no
randomness, no clock, no I/O.

Dev window (grade-local, full 24h window, 128,058 events): net PnL −0.371 SOL
(−3.7%), 93 coins / 93 round trips, win rate 28%, max drawdown 5.4%,
guardrails met, deterministic (L1 regrade byte-identical). The 5x-only shape
scores +0.58 SOL on the same window but trades 21 coins — too few to clear
the 6h final guardrail — so breadth wins over dev PnL here.

Run it with the kit's local grader:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process
```
