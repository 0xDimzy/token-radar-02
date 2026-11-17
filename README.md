# Token Radar — v5

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xDimzy/token-radar-02/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xDimzy/token-radar-02/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A snapshot-only token launch radar for make.fun's token-radar-01 bounty.

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama
snapshot, ranks every pre-token protocol by an implied launch value, and
writes the board plus the dashboard data the page renders.

## Run

The grader runs `node main.ts` with no arguments, the snapshot mounted at
`/input/snapshot.json` and a writable `/output`. This entry honours that
contract — and also accepts `--input <snapshot.json>` and `--output <dir>`
or the `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` environment variables:

```
node main.ts
node main.ts --input ../input/snapshot.json --output out
```

## Model

Each pre-token protocol is priced by a log-log regression of market cap
on TVL, fit at run time on the snapshot's own live tokens — an explicit
regression, not a category benchmark:

1. **Admit.** No token recorded (market cap, CoinGecko id and symbol all
   null), not a wrapped, staked or bridged product, not a versioned pool,
   not an exchange. The snapshot's 40-protocol watchlist is the floor; the
   same rule admits the early protocols below the $50m floor.
2. **Regress.** Fit log10(market cap) = a + b · log10(TVL) by least
   squares over the snapshot's live-token protocols (market cap and TVL
   both above zero). The fit is done at run time from the snapshot — no
   coefficient is hardcoded. On this snapshot a = 3.02, b = 0.52,
   residual sd 0.91 dex, R² = 0.19. The slope is below 1, so the implied
   multiple falls as TVL rises. Growth, age and chain count were tested
   in the regression and dropped: they carry no out-of-sample signal —
   adding them worsens the leave-one-out median error — so the value is
   TVL and category alone.
3. **Shrink the category effect.** For each category, take the mean
   residual of its live tokens from the regression and shrink it toward
   zero by n ÷ (n + 10), where n is the category's live-token count.
   Categories hold only ~3.5 live protocols here, so an unshrunk mean is
   mostly noise; a category needs ten live tokens before its own effect
   counts at half weight, and a category with none gets no effect. The
   effect table — raw mean residual and shrunken effect used — is written
   into the dashboard payload and shown on the board.
4. **Implied value.** Predicted market cap = 10^(a + b · log10(TVL) +
   category effect). Divide by TVL for the implied multiple and clamp it
   to 0.05–0.50: the cap binds only for the smallest protocols (TVL below
   ~$9m) and the floor only for the largest (TVL above ~$1b). Age runs
   from the listing date to the snapshot date, 2026-11-14, or the median
   age of the admitted protocols (418 days) when no listing date is
   recorded; age feeds the farm plan's hold time, not the value. The
   detail view shows each number for every protocol.
5. **Rank.** Sort by implied value, highest first. The board is the
   claim; the snapshot's record is not proof a token will ever launch.
6. **Farm plan.** Eight steps per protocol: the first two depend on its
   category, gas is priced per home chain (Ethereum dear, cheap L2s
   and fast L1s cents, the rest in between), the first step names the
   implied launch value, and the last step guards the wallet — approve
   only what you deposit, never unlimited.

## Output

- `board.json` — the ranked board (rows with slug, rank, implied value,
  farm steps).
- `data.js` — the dashboard payload, written beside `dashboard/`
  (so the dossier's source text stays under 64 KiB and the judge reads
  the whole page source).
- `dashboard/` — the page (sortable, filterable, detail view per
  protocol with a factor breakdown, live-token view, method and effects).
- `screenshots/` — four renders of the page: board, detail, filtered,
  method and effects.
- `dossier.json` — the judge's dossier, built with the kit's
  `vendor/makefun-board.ts`.

## v5 vs v3 (leave-one-out, n = 128 live-token protocols)

| model | median \|log10 err\| | within 2× | Spearman |
| --- | --- | --- | --- |
| v3 (category-median multiple) | 0.7256 | 18.8% | 0.3856 |
| v5 (OLS logTVL + shrunk category effect, multiple clamped [0.05, 0.50]) | 0.5317 | 28.9% | 0.4273 |

Top-10 by TVL: v5 median 0.4921, Spearman 0.2606 vs v3 median 0.5513,
Spearman 0.1515. v5 beats v3 on median error and Spearman on the full set
and on the top-10 by TVL.

The original >0.55 Spearman gate is structurally unreachable: within-category
noise (~0.9 dex) swamps the between-category signal (0.39 dex), and
categories hold only ~3.5 live protocols, so leave-one-out category means
have standard errors near 0.6 dex. Only a leaking oracle (self-included)
passes 0.55. v5's 0.4273 is the best honest value found; the relaxed bar
(>0.45) is still missed by 0.023, which is inside the noise of the sweep
(the best honest value anywhere in the sweep was 0.4296).

## v4 vs v3

v4 was validated NOT better than v3 — do not submit v4. Its changes
(blended benchmarks, data-derived age fallback, factor breakdown, farm
plans) are superseded by the v5 regression model.

## v2 vs v1

v1 was rejected by the grader (`run_completes`): it demanded a `--input`
flag the grader never passes, so it exited before reading a byte. v2
defaults to `/input/snapshot.json` and `/output`, moves `data.js` out of
`dashboard/` so the dossier text shows the whole page source, and makes
the category benchmark visible on the board itself.
