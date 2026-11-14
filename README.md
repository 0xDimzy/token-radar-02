# Token Radar — v2

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

Each pre-token protocol is priced off the live tokens in its own category
— an explicit category benchmark:

1. **Admit.** No token recorded (market cap, CoinGecko id and symbol all
   null), not a wrapped, staked or bridged product, not a versioned pool,
   not an exchange. The snapshot's 40-protocol watchlist is the floor; the
   same rule admits the early protocols below the $50m floor.
2. **Benchmark.** Per category, the median of market-cap / TVL across its
   live-token protocols (at least 3 comparables, otherwise the global
   median across all live tokens), clamped to 0.05–1.00. The benchmark
   table — median, quartiles, comparables count — is written into the
   dashboard payload and shown on the board.
3. **Implied value.** TVL × category multiple × growth factor (7-day
   change, clamped −50%…+100%, weight 0.6) × age factor (0.70 + 0.30 ×
   age capped at 1095 days) × chain factor (1 + 0.04 per extra chain,
   capped at 5).
4. **Rank.** Highest implied value first. The board is the entry's own
   claim, not a prediction that a token launches.

## Output

- `board.json` — the ranked board (rows with slug, rank, implied value,
  farm steps).
- `data.js` — the dashboard payload, written beside `dashboard/`
  (so the dossier's source text stays under 64 KiB and the judge reads
  the whole page source).
- `dashboard/` — the page (sortable, filterable, detail view per
  protocol, live-token view, method and benchmarks).
- `screenshots/` — four renders of the page: board, detail, filtered,
  method and benchmarks.
- `dossier.json` — the judge's dossier, built with the kit's
  `vendor/makefun-board.ts`.

## v2 vs v1

v1 was rejected by the grader (`run_completes`): it demanded a `--input`
flag the grader never passes, so it exited before reading a byte. v2
defaults to `/input/snapshot.json` and `/output`, moves `data.js` out of
`dashboard/` so the dossier text shows the whole page source, and makes
the category benchmark visible on the board itself.
