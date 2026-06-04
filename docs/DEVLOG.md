# Development Log

## Phase 8B - Durable Journaling and Recovery-Safe Logging

### Objective

Make trade history survive process stops, PM2 restarts, and server reboots by writing important lifecycle data immediately to append-only files. No ICT logic, FVG/IFVG logic, MSS logic, trade selection, risk sizing, partial-close logic, or breakeven logic was changed.

### Append-Only Trade Events

Added:

```text
logs/trade-events.jsonl
```

Every durable lifecycle event appends one JSON object immediately:

- `ENTRY`
- `BREAKEVEN_ACTIVATED`
- `PARTIAL_CLOSE`
- `MANAGED_TARGET_EXIT`
- `BREAKEVEN_STOP_EXIT`
- `ENTRY_ZONE_DISRESPECT_EXIT`
- `HARD_STOP_EXIT`
- `RISK_EXIT`

Each JSONL event includes position identity, price, target, hard stop, active stop, size, quantity, unrealized/realized PnL, partial/runner PnL, confidence, zone fields, stop source, risk distance, expected profit/loss, RR, and exit reason.

### Completed Trade JSONL

Added:

```text
logs/completed-trades.jsonl
```

Every final exit immediately appends a completed trade record with:

- entry event summary
- partial close data
- breakeven data
- final exit
- final total PnL
- exit type
- duration
- MFE
- MAE

The existing `logs/completed-trades.json` array is still maintained for compatibility, but the JSONL file is the recovery-safe append-only source.

### Session Stats History

Added:

```text
logs/session-stats-history.jsonl
```

Every `saveSessionStats()` call now appends the stats snapshot to this history file in addition to updating `session-stats.json`.

### Journal Status Dashboard

Dashboard/session stats now include:

- `Journal Status`
- `Last Journal Write`
- `Completed Trades Logged`
- `Trade Events Logged`

`BotEngine.snapshot()` and `BotEngine.stop()` attach current journal status so shutdown saves do not stale the counters.

### Recovery Safety

`TradeJournal` now creates missing log files without truncating existing files:

- `events.log`
- `trade-events.jsonl`
- `completed-trades.jsonl`

On construction it counts existing JSONL rows so restarts preserve previous event and completed-trade counts.

### Tests Added

- `ENTRY` writes to `trade-events.jsonl`
- `PARTIAL_CLOSE` writes to `trade-events.jsonl`
- `BREAKEVEN_ACTIVATED` writes to `trade-events.jsonl`
- `MANAGED_TARGET_EXIT` writes to `completed-trades.jsonl`
- `HARD_STOP_EXIT` writes to `completed-trades.jsonl`
- Restarting `TradeJournal` does not erase JSONL logs
- Completed JSONL PnL includes partial + runner PnL

### Files Modified

- `src/journal/tradeJournal.ts`
- `src/journal/types.ts`
- `src/sessionStats.ts`
- `src/types.ts`
- `src/state.ts`
- `src/bot.ts`
- `src/index.ts`
- `src/testPositionExitManager.ts`
- `docs/DEVLOG.md`

## Phase 8A - Dollar Breakeven, Partial Close, Per-Position Dashboard, Startup Lookback

### Objective

Improve trade management and live dashboard visibility without changing ICT entry logic, FVG/IFVG detection, MSS validation, reaction scoring, target selection, or risk-first sizing.

### Dollar-Based Breakeven

Replaced progress-based BE activation with per-position dollar profit activation.

```text
if individualPositionUnrealizedPnlUsd >= BREAKEVEN_TRIGGER_PROFIT_USD:
  stopAtBreakeven = true
  active stop = entry price
  breakevenActivationPrice = current price
  breakevenActivationTime = current candle timestamp
```

Default:

```text
BREAKEVEN_TRIGGER_PROFIT_USD=0.80
```

The trigger is evaluated per open position. Aggregate basket PnL is not used to activate BE.

### Partial Close

Added one-time partial close management per position.

```text
if individualPositionUnrealizedPnlUsd >= PARTIAL_CLOSE_TRIGGER_PROFIT_USD
and partialCloseDone == false:
  partialCloseFraction = PARTIAL_CLOSE_LOCK_PROFIT_USD / unrealizedProfitUsd
  close activePositionSize * partialCloseFraction
  realizedPartialPnlUsd += PARTIAL_CLOSE_LOCK_PROFIT_USD
  keep remaining size open as runner
  keep stop at breakeven or better
```

Defaults:

```text
PARTIAL_CLOSE_ENABLED=true
PARTIAL_CLOSE_TRIGGER_PROFIT_USD=1.30
PARTIAL_CLOSE_LOCK_PROFIT_USD=1.00
```

Final completed trade PnL now uses:

```text
totalPnlUsd = realizedPartialPnlUsd + finalRunnerPnlUsd
```

### Dashboard

Added per-position dashboard rows for active positions. Each row shows:

- position index
- side
- entry
- current price
- target
- hard stop
- active stop
- size
- unrealized PnL
- current R
- progress to target
- BE state
- partial close state
- runner state
- age
- entry zone type
- stop source

### Startup Lookback

REAL_PUBLIC now preloads closed 1-minute candles before live ticking begins.

```text
STARTUP_CANDLE_LIMIT=500
```

The source requests `limit=501`, drops the current open candle, and loads the latest 500 closed candles into the bot candle buffers.

### Logging

Journal CSV and event logs now include:

- `positionId`
- `activeStopPrice`
- `unrealizedPnlUsd`
- `partialCloseDone`
- `partialClosePrice`
- `partialCloseTime`
- `partialCloseFraction`
- `realizedPartialPnlUsd`
- `remainingSizeAfterPartial`
- `finalRunnerPnlUsd`
- `totalPnlUsd`

### Files Modified

- `src/positionTradeManagement.ts`
- `src/bot.ts`
- `src/types.ts`
- `src/state.ts`
- `src/config.ts`
- `src/sessionStats.ts`
- `src/marketData/types.ts`
- `src/marketData/realPublicSource.ts`
- `src/marketData/testRealPublicSource.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/testPositionExitManager.ts`
- `src/execution/testLiveExecutionManager.ts`
- `.env.example`
- `docs/DEVLOG.md`

## Phase 7D - Break-Even Management + Time Exit Removal

### Objective

Remove time-based exits and make trade lifecycle management close only through hard stop, managed target hit, structure invalidation, or emergency risk controls. Add 50% target-progress break-even management without changing ICT logic, FVG/IFVG logic, target selection, or risk-first sizing.

### Exit Logic Changes

- `TIME_EXIT` is no longer triggered by `evaluatePositionExit`.
- Fixed percentage take-profit and quick-profit exits no longer close trades.
- Active close paths are now:
  - `HARD_STOP_EXIT`
  - `MANAGED_TARGET_EXIT`
  - `BREAKEVEN_STOP_EXIT`
  - `ENTRY_ZONE_DISRESPECT_EXIT`
  - `RISK_EXIT`

### Break-Even Management

When current price reaches at least 50% of the distance from entry to the managed target:

```text
progressToTargetPercent = favorableMove / abs(targetPrice - entryPrice) * 100

if progressToTargetPercent >= 50:
  stopAtBreakeven = true
  breakevenActivationPrice = current price
  breakevenActivationTime = candle timestamp
```

For both LONG and SHORT positions, the break-even stop is the entry price.

### Logging + Dashboard

- Added journal fields:
  - `breakevenActivated`
  - `breakevenActivationPrice`
  - `breakevenActivationTime`
- Added dashboard fields:
  - Break Even Active
  - Break Even Trigger
  - Progress To TP
  - BE Active Price
  - BE Active Time
- Dashboard now shows `Time Exit disabled` instead of a max-hold close rule.

### Files Modified

- `src/positionExitManager.ts`
- `src/positionExitTypes.ts`
- `src/bot.ts`
- `src/types.ts`
- `src/state.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/testPositionExitManager.ts`
- `src/risk/testTargetModes.ts`
- `docs/DEVLOG.md`

## Phase 7A - MSS Displacement Model

### Objective

Shift the ICT model from sweep-driven validation to displacement/FVG-driven validation while preserving risk-first sizing, hard stops, analytics, trade selection ranking, and `targetReachProbability`.

### Model Changes

- Liquidity sweep is no longer mandatory for validated FVG acceptance. It remains recorded as confidence context.
- MSS remains required and is evaluated on the break candle that creates the FVG.
- Consequent Encroachment / midpoint reactions no longer produce BUY/SELL entries or a 45 confidence score. Midpoint interaction remains diagnostic only.
- FVG and IFVG invalidation now require the candle body to close beyond the zone boundary.
- IFVG inversion now also requires a body close beyond the source FVG boundary.
- IFVGs formed inside a respected same-direction parent FVG receive:
  - `parentFvgId`
  - `parentFvgRespected`
  - `confidenceOverride = 100`
  - `confidenceAttribution`

### Confidence Attribution

When an IFVG carries a parent-FVG confidence override, the ICT signal engine uses the higher of the reaction score and the override. The signal reason includes the confidence attribution text so journal/session output can explain why confidence was boosted.

### Files Modified

- `src/ict/validatedFvgDetector.ts`
- `src/ict/fvgDetector.ts`
- `src/ict/ifvgDetector.ts`
- `src/ict/reactionEngine.ts`
- `src/ict/ictSignalEngine.ts`
- `src/ict/types.ts`
- `src/ict/fixtures.ts`
- `src/ict/reactionFixtures.ts`
- `src/ict/testValidatedFvgDetector.ts`
- `src/ict/testFvgIfvg.ts`
- `src/ict/testIctSignalEngine.ts`
- `docs/DEVLOG.md`

### Tests Updated

- No-sweep FVG fixtures now validate when displacement and MSS pass.
- Midpoint-only reaction fixtures now return `NONE` / `TOUCH`.
- FVG/IFVG invalidation fixtures now require body-close invalidation.
- Added IFVG parent-FVG confidence attribution coverage.

## Phase 6C - FVG Origin Stops

### Objective

Replace candidate stop placement from FVG/IFVG zone boundaries to origin-based stops while keeping reaction logic, candidate ranking, confidence scoring, and `targetReachProbability` unchanged.

### Stop Logic Changed

Candidate stop attribution now resolves through `src/ict/stopAttribution.ts`.

```text
FVG BUY:
stopPrice = first candle low
stopSource = firstCandleLow

FVG SELL:
stopPrice = first candle high
stopSource = firstCandleHigh

IFVG BUY:
stopPrice = inversion / displacement candle low
stopSource = displacementOrigin

IFVG SELL:
stopPrice = inversion / displacement candle high
stopSource = displacementOrigin
```

The previous zone-boundary stop is still calculated inside the helper only as reference metadata for regression tests; it is no longer passed into target selection, RR, sizing, or hard stop placement for ICT candidates.

### Files Modified

- `src/ict/stopAttribution.ts`
- `src/ict/testStopAttribution.ts`
- `src/bot.ts`
- `package.json`
- `docs/DEVLOG.md`

### Regression Tests

Added `npm run ict:stop-test`:

- Bullish FVG stop uses `firstCandleLow`.
- Bearish FVG stop uses `firstCandleHigh`.
- Bullish IFVG displacement-origin stop reduces risk versus old `zoneLow` boundary stop.
- Bearish IFVG displacement-origin stop reduces risk versus old `zoneHigh` boundary stop.

## Phase 6B - Stop Source Attribution

### Objective

Record stop attribution for every ICT trade candidate without changing trading logic.

### Attribution Fields Added

Every `TradeCandidate` now carries:

```text
entryPrice
stopPrice
riskDistance
zoneSize
stopSource
```

Supported `stopSource` values:

```text
zoneLow
zoneHigh
firstCandleLow
firstCandleHigh
displacementOrigin
IFVGOrigin
swingLow
swingHigh
```

### Current Stop Attribution

No stop placement logic changed. The current bot still assigns:

```text
LONG / BUY  stopPrice = zone.low   stopSource = zoneLow
SHORT / SELL stopPrice = zone.high stopSource = zoneHigh
```

`riskDistance = abs(entryPrice - stopPrice)`

`zoneSize = abs(zone.high - zone.low)`

### Files Modified

- `src/ict/tradeCandidateTypes.ts`
- `src/ict/tradeSelectionEngine.ts`
- `src/ict/ictSignalAuditLog.ts`
- `src/bot.ts`
- `src/types.ts`
- `src/state.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/analytics/scoreAttributionTypes.ts`
- `src/analytics/tradeOutcomeAnalytics.ts`
- `src/ict/testTradeSelectionEngine.ts`
- `src/analytics/testScoreAttribution.ts`
- `src/analytics/testAttributionPipeline.ts`
- `src/ict/testCandleBufferGap.ts`
- `src/testPositionExitManager.ts`
- `docs/DEVLOG.md`

### Outputs Updated

- Candidate/session stats: selected and all candidates now include stop attribution fields.
- ICT signal audit CSV/JSON: includes `entryPrice`, `stopPrice`, `riskDistance`, `zoneSize`, `stopSource`.
- Trade journal CSV/events: includes explicit stop attribution fields.
- Completed trades JSON: includes stop attribution fields.
- Score attribution analytics outcomes and HTML report: include stop attribution.

### Tests Added

- Candidate stop attribution fields are emitted by trade selection.
- Stop attribution survives into score attribution analytics outcomes.

## Phase 6A - ICT Sweep Rewrite + True Price RR Targets

### Objective

Make validated ICT sweeps require a real rejection close, and lock target placement to chart-visible price risk/reward.

### Sweep Logic

`detectValidatedFVGs` now treats the configured liquidity lookback as the swing reference and requires rejection through that level:

```text
Bearish FVG / buy-side sweep:
referenceLevel = highest high in liquidity lookback
passed = sweepCandle.high > referenceLevel
      && sweepCandle.close < referenceLevel

Bullish FVG / sell-side sweep:
referenceLevel = lowest low in liquidity lookback
passed = sweepCandle.low < referenceLevel
      && sweepCandle.close > referenceLevel
```

A wick through liquidity without a close back through the reference level is rejected.

### True Price RR Targets

The existing Phase 5B risk-first path already resolves bot TP from price risk distance:

```text
riskDistance = abs(entryPrice - stopPrice)
BUY target = entryPrice + riskDistance * TARGET_R_MULTIPLE
SELL target = entryPrice - riskDistance * TARGET_R_MULTIPLE
```

Phase 6A adds explicit short-side regression coverage so chart RR at `1 : TARGET_R_MULTIPLE` stays aligned with the bot TP.

### Files Modified

- `src/ict/validatedFvgDetector.ts`
- `src/ict/testValidatedFvgDetector.ts`
- `src/risk/testPositionSizing.ts`
- `src/risk/testTargetModes.ts`
- `docs/DEVLOG.md`

### Tests Added

- Bearish FVG buy-side sweep passes only when price trades above the swing high and closes back below it.
- Bearish FVG buy-side wick-only sweep is rejected.
- Bullish FVG sell-side sweep passes only when price trades below the swing low and closes back above it.
- Bullish FVG sell-side wick-only sweep is rejected.
- Risk-first short sizing resolves TP from `entry - riskDistance * TARGET_R_MULTIPLE`.
- SCALP short target selection resolves TP from `entry - riskDistance * TARGET_R_MULTIPLE`.

### Verification

Focused commands:

```powershell
npm.cmd run ict:validated-fvg-test
npm.cmd run position:sizing-test
npm.cmd run risk:target-modes-test
```

Focused verification passed after fixing a strict TypeScript nullable reference in the new sweep branch.

## Phase 5c — Validated FVG Rejection Diagnostics

### Objective

Add visibility into why raw FVGs are rejected by `detectValidatedFVGs` without changing any validation rules. The Phase 5b audit established that `DEBUG_ICT_PIPELINE` showed rawFVG > 0 / validatedFVG = 0; we needed to know which check rejected each raw FVG and with what measurements.

### Rejection Reasons Added

For every raw FVG that fails validation, the log captures:

- **Per-check pass flags**: `liquiditySweepPassed`, `displacementPassed`, `mssPassed`, `premiumDiscountPassed`, `sessionPassed`.
- **Displacement measurements**: `bodyToRangePercent` (measured) + `bodyToRangeRequiredPercent` (60), `rangeMultiple` (measured) + `rangeMultipleRequired` (1.2).
- **Detection flags**: `sweepDetected`, `mssDetected`, `premiumDiscountOk`, `sessionOk` (aliases that read naturally in the CSV).
- **Failed-check list**: `failedChecks: ('liquiditySweep' | 'displacement' | 'mss' | 'premiumDiscount' | 'session')[]`.
- **Original rejection reason strings** from `validation.rejectionReasons`.
- **Zone identity**: `direction`, `zoneHigh`, `zoneLow`, `zoneMidpoint`, `rawFvgId`, `symbol`, `timestamp`.

Summary across a validation batch:

- `totalRawFvgs`, `acceptedValidatedFvgs`, `rejectedFvgs`.
- `rejectedNoSweep`, `rejectedNoDisplacement`, `rejectedNoMss`, `rejectedPremiumDiscount`, `rejectedSession`.
- `mostCommonRejectionCombo` (e.g. `"displacement+mss"`) and `topRejectionReason` (the most common verbatim reason string).

### Files Created

- `src/ict/validatedFvgRejectionLog.ts` — pure module + thin file-writer class. Exports `RejectedFvgRecord`, `ValidatedFvgRejectionSummary`, `toRejectedFvgRecord`, `summarizeValidationResults`, `ValidatedFvgRejectionLog`, plus the constants `BODY_TO_RANGE_PERCENT_REQUIRED` (60) and `RANGE_MULTIPLE_REQUIRED` (1.2) which mirror `validatedFvgDetector` defaults.
- `src/ict/testValidatedFvgRejectionLog.ts` — 5 deterministic tests.
- `logs/validated-fvg-rejections.csv` (written by the bot at runtime when DEBUG_ICT_PIPELINE=true).
- `logs/validated-fvg-rejections.json` (written by the bot at runtime when DEBUG_ICT_PIPELINE=true).

### Files Modified

- `src/bot.ts` — replaced `detectValidatedFVGs({ candles })` with a single `validateFVGs(candles)` call so both accepted zones (used by the existing pipeline) and per-FVG rejection diagnostics can be produced from one validation pass. Wired in a private `fvgRejectionLog` instance; when `config.debugIctPipeline === true`, the bot writes rejections and persists the summary on `stats.latestFvgRejectionSummary`.
- `src/types.ts` — added `latestFvgRejectionSummary: ValidatedFvgRejectionSummary | null` to `SessionStats`; re-exports for downstream consumers.
- `src/sessionStats.ts` — initializes the new field on session start; appended three dashboard lines (`Raw FVGs`, `Validated FVGs`, `Top Rejection`) rendered only when `config.debugIctPipeline === true`.
- `package.json` — added `ict:fvg-rejection-test` npm script.
- `docs/DEVLOG.md` — this entry.

### Output

- `logs/validated-fvg-rejections.csv` — append-only, one row per rejected raw FVG. Header is created on first write.
- `logs/validated-fvg-rejections.json` — append-by-rewrite, full array of `RejectedFvgRecord` objects.
- `session-stats.json` `latestFvgRejectionSummary` — refreshed on every ICT evaluation when debug mode is on.
- Dashboard (when `DEBUG_ICT_PIPELINE=true`):
  - `Raw FVGs        <totalRawFvgs>`
  - `Validated FVGs  <acceptedValidatedFvgs>`
  - `Top Rejection   <topRejectionReason>`

### Tests Added

`src/ict/testValidatedFvgRejectionLog.ts`, run via `npm run ict:fvg-rejection-test`:

1. **rejected FVG records no sweep reason** — a `FvgValidationResult` with `liquiditySweep.passed = false` produces a record whose `liquiditySweepPassed === false` and whose `failedChecks` includes `"liquiditySweep"`.
2. **rejected FVG records no displacement reason** — a result with `displacement.passed = false`, `bodyToRangePercent = 35`, `rangeMultiple = 0.8` produces a record carrying those values alongside the required thresholds (60 / 1.2).
3. **rejected FVG records no MSS reason** — `marketStructureShift.passed = false` ⇒ `mssPassed === false` and `failedChecks` includes `"mss"`.
4. **accepted FVG is not logged as rejected** — `toRejectedFvgRecord` returns `null` for an `accepted: true` result; `ValidatedFvgRejectionLog.recordValidationResults` does not create CSV / JSON files when there is nothing to write.
5. **summary counts are correct** — a 4-result batch (1 accepted, 2 with sweep failure, 1 with displacement failure, where one of the sweep failures also fails MSS) returns `total=4 accepted=1 rejected=3 noSweep=2 noDisp=1 noMss=1 premium=0 session=0 combo=liquiditySweep`.

The test writes to `logs/validated-fvg-rejection-test/` and cleans up on each run; it does not touch the live `logs/validated-fvg-rejections.*` files.

### Commands Executed

```powershell
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run build
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:fvg-rejection-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:reaction-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:signal-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run analytics:pipeline-test
```

### Verification

- `npm run build` — clean.
- `npm run ict:fvg-rejection-test` — **5 / 5 passed** (new).
- `npm run ict:test` — **7 / 7 passed** (FVG/IFVG detection regression).
- `npm run ict:reaction-test` — **11 / 11 passed**.
- `npm run ict:signal-test` — **5 / 5 passed**.
- `npm run analytics:pipeline-test` — **5 / 5 passed**.

### Out of Scope

Per the Phase 5c plan, this phase did not change `detectFVGs`, `detectValidatedFVGs`, `detectIFVGs`, the validation thresholds (`displacementBodyToRangeMin`, `displacementRangeMultiplier`, lookbacks), the reaction logic, target logic, position sizing, candidate selection, or any live trading / exchange code. `validateFVGs` is the single shared computation; `detectValidatedFVGs` still exists and still produces the accepted-only filter for any external consumer.

## Phase 5g — Exit Target Modes (STRUCTURE / SCALP / HYBRID)

### Objective

Stop the bot from chasing distant opposing FVG / IFVG / swing targets when the strategy goal is a $1.00–$1.50 scalp at $1 risk. Introduce `EXIT_TARGET_MODE` with three modes and re-enable the quick-profit exit even when a managed target is set.

### Target Mode Logic

- **STRUCTURE** — existing behavior. Picks the nearest opposing FVG / IFVG; falls back to the latest confirmed swing high / low. No RR or distance gate.
- **SCALP** — ignores structure entirely. Target = `entry ± (riskDistance × TARGET_R_MULTIPLE)`. Deterministic and bounded.
- **HYBRID** (default) — computes both. Prefers the **closer** target that still satisfies `MIN_RISK_REWARD_RATIO` (and `MAX_TARGET_DISTANCE_PERCENT` when > 0). Falls through to scalp if structure fails either gate.

Live retargeting in `updateIctTradeManagement` is now gated: SCALP mode never upgrades its R-multiple target to an opposing FVG mid-trade (the scalp target is the contract). STRUCTURE and HYBRID continue to upgrade.

Quick-profit exit (`profitTargetUsdMin` ≤ unrealized PnL ≤ `profitTargetUsdMax`) was previously suppressed whenever an ICT-managed target existed (`bot.ts` set `useQuickProfitExit: config.signalSource !== 'ICT' || latestPosition.targetPrice === null`). That gate is removed; quick-profit exit is now always enabled. The bot can book the $1 objective even if the structure / scalp target is farther away.

### Files Modified

- `src/types.ts` — re-exported `ExitTargetMode`, `ManagedTargetSource`, `TargetSelectionResult` from the new pure module; added `latestTargetSelection: TargetSelectionResult | null` to `SessionStats`; added `exitTargetMode`, `targetRMultiple`, `minRiskRewardRatio`, `maxTargetDistancePercent` to `BotConfig`.
- `src/config.ts` — loads `EXIT_TARGET_MODE` (default `HYBRID`), `TARGET_R_MULTIPLE` (1.5), `MIN_RISK_REWARD_RATIO` (1.5), `MAX_TARGET_DISTANCE_PERCENT` (0 = disabled).
- `src/bot.ts` — replaced private `findManagedTarget` with `runTargetSelection` that delegates to the pure module; tracks `latestTargetSelection` on stats; passes `stopPrice` into target selection; SCALP-mode trades no longer retarget mid-trade; quick-profit exit gate removed.
- `src/sessionStats.ts` — initializes `latestTargetSelection: null`.
- `src/risk/positionSizing.ts` — reads `minRiskRewardRatio` from `PositionSizingConfig` (default 1.5) instead of a hardcoded constant, so HYBRID and sizing share one RR floor.
- `src/risk/positionSizingTypes.ts` — added optional `minRiskRewardRatio` to `PositionSizingConfig`.
- `src/risk/testPositionSizing.ts` — sets `minRiskRewardRatio: 1.5` on the base test config.
- `src/execution/testLiveExecutionManager.ts` — added the four new `BotConfig` fields to its synthetic config.
- `.env.example` — documents `EXIT_TARGET_MODE`, `TARGET_R_MULTIPLE`, `MIN_RISK_REWARD_RATIO`, `MAX_TARGET_DISTANCE_PERCENT`; bumped `TARGET_PROFIT_MIN_USD` / `TARGET_PROFIT_MAX_USD` to the spec defaults ($1.00 / $1.50).
- `package.json` — added `risk:target-modes-test` script.
- `docs/DEVLOG.md` — this entry.

### Files Created

- `src/risk/targetSelection.ts` — pure target-selection module. Exports `selectManagedTarget`, `ExitTargetMode`, `ManagedTarget`, `ManagedTargetSource`, `TargetSelectionConfig`, `TargetSelectionInput`, `TargetSelectionResult`. Also re-exports the helper functions (`findStructureTarget`, `findOpposingZoneTarget`, `findScalpTarget`) so the bot and the tests share one source of truth.
- `src/risk/testTargetModes.ts` — 8 deterministic tests.

### Tests Added

`src/risk/testTargetModes.ts` — invoked via `npm run risk:target-modes-test`:

1. **STRUCTURE mode uses opposing FVG target** — opposing bearish FVG at 102 chosen for LONG at 100.
2. **STRUCTURE mode falls back to swing target** — no opposing zone → swing price 105 selected.
3. **SCALP mode uses R-multiple target** — entry 100, stop 99, 1.5R → 101.5, source `SCALP_R`.
4. **HYBRID chooses scalp target when structure target is too far** — structure 15% away exceeds `MAX_TARGET_DISTANCE_PERCENT=5` → scalp wins.
5. **HYBRID chooses structure target when structure is nearby and valid** — structure at scalp distance with passing RR → structure wins (closer / tied).
6. **Trade rejected if RR < 1.5** — `calculatePositionSizing` rejects `RR=0.5` with a "Risk/reward" rejection reason.
7. **Trade rejected if expected loss > MAX_RISK_PER_TRADE_USD** — `minPositionUsd=500` with $1 risk cap forces rejection.
8. **Quick-profit exit fires in ICT mode with managed target** — target at 110 not hit, +$1.05 unrealized → `evaluatePositionLifecycleExit` returns `QUICK_PROFIT_EXIT`.

### Commands Executed

```powershell
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run build
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:reaction-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:signal-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run analytics:pipeline-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run position:exit-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run position:sizing-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run risk:target-modes-test
```

### Verification

- `npm run build` — clean (first pass surfaced one missing-field error in `testLiveExecutionManager.ts`; patched).
- `npm run ict:reaction-test` — **11 / 11 passed**.
- `npm run ict:signal-test` — **5 / 5 passed**.
- `npm run analytics:pipeline-test` — **5 / 5 passed**.
- `npm run position:exit-test` — **17 / 17 passed**.
- `npm run position:sizing-test` — **7 / 7 passed**.
- `npm run risk:target-modes-test` — **8 / 8 passed** (new).

### Out of Scope

Per the Phase 5g plan, this phase did not touch FVG detection, IFVG detection, reaction logic, signal logic, candidate selection, the position-sizing formula (only the RR floor moved from constant to config), Pine UI, or live trading / exchange code.

## Phase 5f — Reaction Rewrite

### Objective

Replace the weak `returnToZone + bodyCloseConfirmation` reaction model with a tier-based "who won the reaction" model driven by midpoint, boundary, and displacement outcomes. The bot now decides BUY / SELL / NONE from `reactionWinner` + `reactionScore`, not from a single touch-confirmation boolean.

### Reaction Logic Changes

Five tiers, scored 0–100, computed from the latest candle's relationship to the zone:

| Tier | Condition | Score | Winner |
|---|---|---|---|
| `DISPLACEMENT` | displacement candle (body/range ≥ 0.6, range ≥ 1.2× avg prior) closing past the zone boundary | 100 | side of the boundary crossed |
| `BOUNDARY` | close past zone.high or zone.low (no displacement) | 75 | side of the boundary crossed |
| `MIDPOINT` | candle range included midpoint, close picked a side | 45 | side the close picked |
| `TOUCH` | candle touched zone but did not include midpoint | 20 | NONE |
| `NONE` | no zone touch | 0 | NONE |

For a bullish zone the spec maps cleanly:
- close above high → BUY at BOUNDARY/DISPLACEMENT
- close above midpoint → weak BUY at MIDPOINT
- close below midpoint → SELL bias (bullish failure) at MIDPOINT
- close below low → SELL at BOUNDARY (zone violation)

Bearish zone is symmetric.

Signal generation in `ictSignalEngine.ts` now gates on `reactionWinner` + `reactionScore` (the canonical fields). `output` and `confidence` are kept as derived aliases so legacy consumers keep working.

The fresh-IFVG-formation 100% confidence bypass in `bot.ts` (`isFreshIfvgFormation` + `createIfvgFormationReaction`) was removed entirely. Fresh IFVG inversions now flow through the same tier evaluation as any other zone; they only earn high scores if the latest candle actually closes past the boundary or displaces.

### Files Modified

- `src/ict/reactionTypes.ts` — added `IctReactionTier`, `IctReactionWinner`, `IctReactionMidpointResult`, `IctReactionBoundaryResult`, `IctReactionDisplacementResult`, `IctDisplacementOptions`; extended `IctReactionResult` with `reactionType`, `midpointResult`, `boundaryCloseResult`, `displacementReaction`, `reactionWinner`, `reactionScore`.
- `src/ict/reactionEngine.ts` — rewritten around `evaluateTier`. Old binary check semantics dropped; `confidence` is now equal to `reactionScore`. Displacement detection ported from `validatedFvgDetector` defaults (body/range ≥ 0.6, range ≥ 1.2× avg prior over a 5-bar lookback).
- `src/ict/ictSignalEngine.ts` — gates on `reactionWinner` + `reactionScore` per spec.
- `src/bot.ts` — removed `isFreshIfvgFormation` and `createIfvgFormationReaction`; the per-zone evaluation now always calls `evaluateReaction` directly. The `ictTradeOnIfvgFormation` config flag remains in `BotConfig` but is unused (left in place to avoid touching the config schema).
- `src/ict/reactionFixtures.ts` — replaced 8 legacy fixtures with the 11 spec fixtures.
- `src/ict/testReactionEngine.ts` — extended `summarize` to expose the new tier fields.
- `src/ict/testIctSignalEngine.ts` — extended the synthetic `reaction()` helper to populate `reactionWinner` + `reactionScore`.
- `src/ict/testPaperTradingIntegration.ts`, `src/ict/testTradeSelectionEngine.ts`, `src/ict/historicalReplay.ts`, `src/analytics/testScoreAttribution.ts`, `src/analytics/testAttributionPipeline.ts` — synthetic `IctReactionResult` objects extended with the new mandatory fields (no behavioral change).
- `docs/DEVLOG.md` — this entry.

### Tests Added

`src/ict/reactionFixtures.ts` now drives 11 fixtures matching the spec:

1. Bullish FVG touch only → NONE / TOUCH / score 20.
2. Bullish FVG close above midpoint → weak BUY / MIDPOINT / score 45 (below default signal threshold).
3. Bullish FVG close above FVG high → BUY / BOUNDARY / score 75.
4. Bullish FVG displacement above FVG high → strong BUY / DISPLACEMENT / score 100.
5. Bullish FVG close below midpoint → SELL bias / MIDPOINT / score 45.
6. Bearish FVG touch only → NONE / TOUCH / score 20.
7. Bearish FVG close below midpoint → weak SELL / MIDPOINT / score 45.
8. Bearish FVG close below FVG low → SELL / BOUNDARY / score 75.
9. Bearish FVG displacement below FVG low → strong SELL / DISPLACEMENT / score 100.
10. Bearish FVG close above midpoint → BUY bias / MIDPOINT / score 45.
11. Fresh-IFVG-shaped zone with no candle interaction → NONE / score 0 (proves the auto-100 bypass is gone).

### Commands Executed

```powershell
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run build
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:reaction-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run ict:signal-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run analytics:pipeline-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run position:exit-test
```

### Verification

- `npm run build` — clean (no TypeScript errors after extending five callsites that synthesize `IctReactionResult`).
- `npm run ict:reaction-test` — **11 / 11 passed**.
- `npm run ict:signal-test` — **5 / 5 passed** (signal engine still emits BUY/SELL/NONE on the same threshold logic, now sourcing from `reactionWinner` + `reactionScore`).
- `npm run analytics:pipeline-test` — **5 / 5 passed** (Phase 5e attribution pipeline still intact).
- `npm run position:exit-test` — **17 / 17 passed** (exit logic untouched).

### Out of Scope

Per the Phase 5f plan, this phase did not touch FVG detection, IFVG detection, target logic, candidate selection, position sizing, Pine UI, or live trading / exchange code. The `tradeSelectionEngine` still gates on `reaction.output` + `checks.bodyCloseConfirmation` (which now derive from the new tier model) — selection rewrite is Phase 4 / 5h. The Pine overlay still encodes the old reaction model and is intentionally left out of sync until Phase 5 / 5i; its drift from the bot is documented in the audit.

## Phase 5e — Attribution Capture Fix

### Objective

Fix the score attribution capture pipeline before changing reaction, target, selection, or Pine UI logic. Symptom: `logs/completed-trades.json` contains 15 trades but `logs/score-attribution-report.json` reports `totalTrades = 0`. None of the 15 historical trades carry `scoreBreakdown`, `scoreFinal`, `selectionScore`, or `positionSizeUsd`.

### Root Cause

Two contributing problems were identified during audit:

1. **Coupling bug in `openInitialPosition` (src/bot.ts).** Attribution and sizing fields (`scoreAttribution`, `positionSizeUsd`, `expectedProfitUsd`, `expectedLossUsd`, `riskRewardRatio`, `expectedMovePercent`, `selectionScore`) were assigned **inside the `if (trigger.entryZone)` branch**. For the current ICT path `trigger.entryZone` is always truthy, so this happened to work, but the assignment was structurally fragile: any code path that opens a position without an entry zone would silently drop attribution.

2. **No end-to-end coverage.** The existing `analytics:test` exercised `createScoreAttribution` and `createScoreAttributionReport` in isolation, but nothing asserted the full pipeline (entry → `state.ts` JSON round-trip → `TradeJournal.logClose` → `completed-trades.json` → report). With no test, regressions in any single stage went undetected, and the historical 15 trades — written by earlier bot versions that pre-dated the attribution feature — silently kept the report at zero.

### Files Modified

- `src/bot.ts` — split `openInitialPosition` so sizing + `scoreAttribution` attach unconditionally when the trigger provides them; entry-zone fields stay gated.
- `package.json` — added `analytics:pipeline-test` script.
- `docs/DEVLOG.md` — this entry.

### Files Created

- `src/analytics/testAttributionPipeline.ts` — five-stage end-to-end test.

### Fix Applied

`openInitialPosition` now contains two independent attach blocks:

1. If `trigger.sizing`, `trigger.scoreAttribution`, or `trigger.positionSizeUsd` is provided → set sizing + attribution fields.
2. If `trigger.entryZone` is provided → set entry-zone fields and the managed target.

Attribution can no longer be lost because the entry-zone branch was skipped.

### Tests Added

`src/analytics/testAttributionPipeline.ts` asserts:

1. **attribution exists on entry** — a freshly constructed `PositionState` from a `TradeCandidate` carries a non-null `scoreAttribution` whose `finalScore` equals the candidate's score.
2. **attribution survives state save/load** — `JSON.stringify` + `JSON.parse` (the operation `saveOpenPositions` / `loadOpenPositions` perform through fs) preserves every component of `scoreAttribution.breakdown` and `finalScore`.
3. **attribution copied to completed trade** — `TradeJournal.logClose` writes a `CompletedTrade` to `completed-trades.json` whose `scoreBreakdown` and `scoreFinal` are populated.
4. **report `totalTrades > 0`** — `createScoreAttributionReport` reading those persisted trades returns `totalTrades === 1`.
5. **every score component survives the pipeline** — all ten keys (`liquiditySweepScore`, `displacementScore`, `mssScore`, `fvgQualityScore`, `ifvgBonus`, `targetFitScore`, `reactionScore`, `premiumDiscountScore`, `sessionScore`, `confidenceScore`) are present in the persisted trade.

The test writes to `logs/attribution-pipeline-test/` and cleans up on each run; it does not touch the live `logs/completed-trades.json`.

### Commands Executed

```powershell
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run build
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run analytics:test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run analytics:pipeline-test
npm --prefix 'C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot' run position:exit-test
```

### Verification

- `npm run build` — clean (no TypeScript errors).
- `npm run analytics:test` — 5 / 5 passed (no regression in the pre-existing score attribution unit tests).
- `npm run analytics:pipeline-test` — 5 / 5 passed (new end-to-end coverage).
- `npm run position:exit-test` — 17 / 17 passed (no regression in exit logic).

### Notes on Historical Data

The 15 trades already in `logs/completed-trades.json` were written before this phase and lack `scoreBreakdown` / `scoreFinal`. They will remain at zero in the attribution report; only new ICT trades opened after this fix will be attributed. Historical trades are not back-filled because the source attribution cannot be reconstructed.

### Out of Scope

Per Phase 5e plan, this phase does not touch reaction logic, FVG / IFVG detection, target logic, candidate selection, position sizing, Pine UI, or live trading / exchange code.

## Phase 4B

### Objective

Build a read-only FVG/IFVG visual validation layer that consumes the Phase 4A detector outputs and generates a standalone HTML report for manual inspection. This phase does not place trades, generate signals, enter positions, exit positions, modify strategy logic, add wallet logic, or add exchange integration.

### Files Created

- `src/ict/visualValidation.ts`
- `logs/fvg-ifvg-visual-validation.html`
- `docs/DEVLOG.md`

### Files Modified

- `package.json`

### Commands Executed

```powershell
Get-Content package.json
Get-ChildItem src\ict -Force
Get-Content src\ict\types.ts
if (Test-Path logs\detected-fvgs.json) { Get-Content logs\detected-fvgs.json } else { 'missing logs/detected-fvgs.json' }
if (Test-Path logs\detected-ifvgs.json) { Get-Content logs\detected-ifvgs.json } else { 'missing logs/detected-ifvgs.json' }
if (Test-Path docs\DEVLOG.md) { Get-Content docs\DEVLOG.md } else { 'docs/DEVLOG.md does not exist' }
npm.cmd run build
npm.cmd run ict:visualize
Test-Path logs\fvg-ifvg-visual-validation.html
Select-String -Path logs\fvg-ifvg-visual-validation.html -Pattern 'Bullish FVGs|Bearish FVGs|Bullish IFVGs|Bearish IFVGs|Total Zones'
Get-Item logs\fvg-ifvg-visual-validation.html | Select-Object FullName,Length,LastWriteTime
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- `npm.cmd run ict:visualize` read:
  - `logs/detected-fvgs.json`
  - `logs/detected-ifvgs.json`
- The command generated:
  - `logs/fvg-ifvg-visual-validation.html`
- `Test-Path logs\fvg-ifvg-visual-validation.html` returned `True`.
- `Select-String` confirmed the generated HTML contains:
  - `Bullish FVGs`
  - `Bearish FVGs`
  - `Bullish IFVGs`
  - `Bearish IFVGs`
  - `Total Zones`

### Errors Encountered

No build or runtime errors were encountered. `docs/DEVLOG.md` did not exist before this phase, so it was created.

### Output Examples

`npm.cmd run ict:visualize` output:

```text
> nado-trading-bot@1.0.0 ict:visualize
> ts-node src/ict/visualValidation.ts

ICT visual validation report generated
Output: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\fvg-ifvg-visual-validation.html
FVG source: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\detected-fvgs.json
IFVG source: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\detected-ifvgs.json
Bullish FVGs: 1
Bearish FVGs: 2
Bullish IFVGs: 2
Bearish IFVGs: 1
Total zones: 6
```

Generated HTML summary lines:

```html
<div class="stat"><span>Bullish FVGs</span><strong>1</strong></div>
<div class="stat"><span>Bearish FVGs</span><strong>2</strong></div>
<div class="stat"><span>Bullish IFVGs</span><strong>2</strong></div>
<div class="stat"><span>Bearish IFVGs</span><strong>1</strong></div>
<div class="stat"><span>Total Zones</span><strong>6</strong></div>
```

### Next Recommended Phase

Phase 4C: add deterministic fixture-based tests for FVG/IFVG detection and visual export integrity before integrating any live chart or strategy workflow.

## Phase 4C

### Objective

Build deterministic fixture-based tests for the Phase 4A FVG/IFVG detection engine before using live data. The tests verify known candle sequences for bullish FVGs, bearish FVGs, no FVGs, bullish IFVG flips, bearish IFVG flips, invalidated zones, and filled zones. This phase does not place trades, generate trading signals, modify strategy logic beyond testability, add wallet logic, or add exchange integration.

### Files Created

- `src/ict/fixtures.ts`
- `src/ict/testFvgIfvg.ts`

### Files Modified

- `package.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content package.json
Get-Content docs\DEVLOG.md
Get-ChildItem src\ict -Force
Get-Content src\ict\fvgDetector.ts
Get-Content src\ict\ifvgDetector.ts
npm.cmd run build
npm.cmd run ict:test
Select-String -Path package.json -Pattern 'ict:test|ict:visualize|build'
Select-String -Path docs\DEVLOG.md -Pattern '## Phase 4C|Objective|Files Created|Files Modified|Commands Executed|Verification|Errors Encountered|Output Examples|Next Recommended Phase'
Get-ChildItem src\ict -Force | Select-Object Name,Length,LastWriteTime
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- Deterministic fixture tests passed with `npm.cmd run ict:test`.
- The test runner printed the test name, expected result, actual result, and `PASS` or `FAIL` for each case.
- The runner exits with `process.exit(1)` if any fixture fails.
- Current result: `7/7 passed`.
- Readback checks confirmed `ict:test` exists in `package.json`, the Phase 4C devlog section exists, and both new ICT test files exist under `src/ict`.

### Errors Encountered

No build errors or fixture test failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:test` output:

```text
> nado-trading-bot@1.0.0 ict:test
> ts-node src/ict/testFvgIfvg.ts

Test: bullish FVG present
Expected: {"totalFVGs":1,"bullishFVGs":1,"bearishFVGs":0,"zone":{"direction":"BULLISH","high":102,"low":100,"midpoint":101,"invalidated":false,"filled":false,"flipped":false}}
Actual:   {"totalFVGs":1,"bullishFVGs":1,"bearishFVGs":0,"zone":{"direction":"BULLISH","high":102,"low":100,"midpoint":101,"invalidated":false,"filled":false,"flipped":false}}
Result:   PASS

Test: bearish FVG present
Expected: {"totalFVGs":1,"bullishFVGs":0,"bearishFVGs":1,"zone":{"direction":"BEARISH","high":100,"low":98,"midpoint":99,"invalidated":false,"filled":false,"flipped":false}}
Actual:   {"totalFVGs":1,"bullishFVGs":0,"bearishFVGs":1,"zone":{"direction":"BEARISH","high":100,"low":98,"midpoint":99,"invalidated":false,"filled":false,"flipped":false}}
Result:   PASS

Test: no FVG
Expected: {"totalFVGs":0,"bullishFVGs":0,"bearishFVGs":0}
Actual:   {"totalFVGs":0,"bullishFVGs":0,"bearishFVGs":0}
Result:   PASS

Test: bullish IFVG flip
Expected: {"totalFVGs":1,"totalIFVGs":1,"ifvg":{"direction":"BULLISH","high":100,"low":98,"midpoint":99,"invalidated":false,"filled":false,"flipped":false},"sourceFVG":{"direction":"BEARISH","invalidated":true,"filled":true,"flipped":true}}
Actual:   {"totalFVGs":1,"totalIFVGs":1,"ifvg":{"direction":"BULLISH","high":100,"low":98,"midpoint":99,"invalidated":false,"filled":false,"flipped":false},"sourceFVG":{"direction":"BEARISH","invalidated":true,"filled":true,"flipped":true}}
Result:   PASS

Test: bearish IFVG flip
Expected: {"totalFVGs":1,"totalIFVGs":1,"ifvg":{"direction":"BEARISH","high":102,"low":100,"midpoint":101,"invalidated":false,"filled":false,"flipped":false},"sourceFVG":{"direction":"BULLISH","invalidated":true,"filled":true,"flipped":true}}
Actual:   {"totalFVGs":1,"totalIFVGs":1,"ifvg":{"direction":"BEARISH","high":102,"low":100,"midpoint":101,"invalidated":false,"filled":false,"flipped":false},"sourceFVG":{"direction":"BULLISH","invalidated":true,"filled":true,"flipped":true}}
Result:   PASS

Test: invalidated zone
Expected: {"totalFVGs":1,"zone":{"direction":"BULLISH","invalidated":true,"filled":true,"flipped":true}}
Actual:   {"totalFVGs":1,"zone":{"direction":"BULLISH","invalidated":true,"filled":true,"flipped":true}}
Result:   PASS

Test: filled zone
Expected: {"totalFVGs":1,"zone":{"direction":"BULLISH","invalidated":false,"filled":true,"flipped":false}}
Actual:   {"totalFVGs":1,"zone":{"direction":"BULLISH","invalidated":false,"filled":true,"flipped":false}}
Result:   PASS

ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 4D: add historical candle replay export so fixture-tested detectors can process real recorded candles while still avoiding trading, signals, entries, exits, wallet logic, and exchange order integration.

## Phase 4E

### Objective

Build a historical replay engine that reads OHLCV candle files, runs the existing ICT FVG/IFVG detectors, and produces statistical reports. This phase remains detection/reporting only: no trading, no signals, no entries, no exits, no wallet logic, and no exchange order integration.

### Files Created

- `src/ict/historicalReplay.ts`
- `data/historical/phase4e-sample.csv`
- `logs/ict-replay-report.json`

### Files Modified

- `package.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content package.json
Get-ChildItem src\ict -Force | Select-Object Name,Length,LastWriteTime
Get-Content src\ict\types.ts
Get-Content src\ict\fvgDetector.ts
Get-Content src\ict\ifvgDetector.ts
Get-Content docs\DEVLOG.md
npm.cmd run build
npm.cmd run ict:replay
Get-Content logs\ict-replay-report.json
Select-String -Path package.json -Pattern 'ict:replay|ict:test|ict:visualize|build'
Get-Item logs\ict-replay-report.json | Select-Object FullName,Length,LastWriteTime
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- `npm.cmd run ict:replay` processed `data/historical/phase4e-sample.csv`.
- The replay engine generated `logs/ict-replay-report.json`.
- The report includes:
  - Total FVGs
  - Total IFVGs
  - Bullish/Bearish FVG counts
  - Bullish/Bearish IFVG counts
  - FVG, IFVG, and combined fill rates
  - FVG, IFVG, and combined flip rates
  - Average FVG, IFVG, and combined lifespan in candles
- Readback confirmed `ict:replay` exists in `package.json` and `logs/ict-replay-report.json` exists.

### Errors Encountered

No build errors or replay runtime errors were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:replay` output:

```text
> nado-trading-bot@1.0.0 ict:replay
> ts-node src/ict/historicalReplay.ts

ICT historical replay complete
Files processed: 1
Report: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\ict-replay-report.json
Total candles: 7
Total FVGs: 3
Bullish FVGs: 1
Bearish FVGs: 2
Total IFVGs: 3
Bullish IFVGs: 2
Bearish IFVGs: 1
Combined fill rate: 66.67%
Combined flip rate: 66.67%
Average FVG lifespan: 1.33 candles
Average IFVG lifespan: 1 candles
Average combined lifespan: 1.17 candles
```

Generated report excerpt:

```json
{
  "fileCount": 1,
  "candleCount": 7,
  "totalFVGs": 3,
  "totalIFVGs": 3,
  "bullishFVGs": 1,
  "bearishFVGs": 2,
  "bullishIFVGs": 2,
  "bearishIFVGs": 1,
  "combinedFillRate": 66.67,
  "combinedFlipRate": 66.67,
  "averageCombinedLifespanCandles": 1.17
}
```

### Next Recommended Phase

Phase 4F: add batch replay fixtures and regression assertions for replay report totals before replaying larger external historical datasets.

## Phase 5A

### Objective

Extend the historical replay engine for larger OHLCV dataset research. The replay layer now recursively processes multiple CSV/JSON candle files, aggregates statistics across files, and reports FVG counts, IFVG counts, fill rates, flip rates, lifespan distributions, time-to-fill, and time-to-flip. This phase remains research/reporting only: no trading, no signals, no orders, no wallets, and no exchange integration.

### Files Created

- `data/historical/phase5a-sample.csv`

### Files Modified

- `src/ict/historicalReplay.ts`
- `logs/ict-replay-report.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\historicalReplay.ts
Get-Content package.json
Get-Content docs\DEVLOG.md
Get-ChildItem data\historical -Force
npm.cmd run build
npm.cmd run ict:replay
Get-Content logs\ict-replay-report.json -TotalCount 220
Select-String -Path logs\ict-replay-report.json -Pattern 'lifespanDistributionCandles|timeToFillCandles|timeToFlipCandles|filledFVGs|flippedFVGs|fileCount'
Get-ChildItem data\historical -Force | Select-Object Name,Length,LastWriteTime
Select-String -Path package.json -Pattern 'ict:replay'
npm.cmd run ict:test
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- `npm.cmd run ict:replay` processed two files from `data/historical`.
- Multi-file aggregation was verified by `Files processed: 2` and `Total candles: 14`.
- `logs/ict-replay-report.json` now contains:
  - Per-file stats
  - Aggregate totals
  - FVG/IFVG counts
  - Bullish/bearish counts
  - Filled/flipped counts
  - Fill/flip rates
  - `lifespanDistributionCandles`
  - `lifespanDistributionMinutes`
  - `timeToFillCandles`
  - `timeToFillMinutes`
  - `timeToFlipCandles`
  - `timeToFlipMinutes`
- Existing deterministic detector tests still pass: `ICT FVG/IFVG fixture tests: 7/7 passed`.

### Errors Encountered

No build errors, replay runtime errors, or fixture test failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:replay` output:

```text
> nado-trading-bot@1.0.0 ict:replay
> ts-node src/ict/historicalReplay.ts

ICT historical replay complete
Files processed: 2
Report: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\ict-replay-report.json
Total candles: 14
Total FVGs: 6
Bullish FVGs: 2
Bearish FVGs: 4
Total IFVGs: 6
Bullish IFVGs: 4
Bearish IFVGs: 2
Combined fill rate: 66.67%
Combined flip rate: 66.67%
Average FVG lifespan: 1.33 candles
Average IFVG lifespan: 1 candles
Average combined lifespan: 1.17 candles
Lifespan distribution: count=12 min=0 median=1 p90=3 max=3 candles
Time-to-fill distribution: count=8 min=1 median=1.5 p90=3 max=3 candles
Time-to-flip distribution: count=8 min=1 median=1.5 p90=3 max=3 candles
```

Generated report excerpt:

```json
{
  "fileCount": 2,
  "candleCount": 14,
  "totalFVGs": 6,
  "totalIFVGs": 6,
  "bullishFVGs": 2,
  "bearishFVGs": 4,
  "bullishIFVGs": 4,
  "bearishIFVGs": 2,
  "combinedFillRate": 66.67,
  "combinedFlipRate": 66.67,
  "lifespanDistributionCandles": {
    "combined": {
      "count": 12,
      "min": 0,
      "max": 3,
      "average": 1.17,
      "median": 1,
      "p90": 3
    }
  },
  "timeToFillCandles": {
    "combined": {
      "count": 8,
      "min": 1,
      "max": 3,
      "average": 1.75,
      "median": 1.5,
      "p90": 3
    }
  },
  "timeToFlipCandles": {
    "combined": {
      "count": 8,
      "min": 1,
      "max": 3,
      "average": 1.75,
      "median": 1.5,
      "p90": 3
    }
  }
}
```

`npm.cmd run ict:test` result:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 5B: add CSV export and lightweight HTML summaries for large replay reports so dataset research can be reviewed without opening large JSON files directly.

## Phase 5B

### Objective

Build an ICT reaction engine that evaluates price behavior around detected FVG/IFVG zones. The engine accepts a zone, candles, and current price, then evaluates return to zone, midpoint interaction, body close confirmation, and optional volume confirmation. It outputs `BUY`, `SELL`, or `NONE` as a reaction classification only. This phase does not trade, create entries, create exits, add wallets, place orders, or add exchange integration.

### Files Created

- `src/ict/reactionTypes.ts`
- `src/ict/reactionEngine.ts`

### Files Modified

- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\types.ts
Get-Content src\signals\types.ts
Get-ChildItem src\ict -Force | Select-Object Name,Length,LastWriteTime
Get-Content docs\DEVLOG.md -Tail 180
Get-Content package.json
npm.cmd run build
node -e "const { evaluateReaction } = require('./dist/ict/reactionEngine'); const at = new Date('2026-06-01T00:00:00.000Z'); const bullishZone = { id:'bull-zone', direction:'BULLISH', high:102, low:100, midpoint:101, createdAt:at.toISOString(), invalidated:false, filled:false, flipped:false }; const bearishZone = { id:'bear-zone', direction:'BEARISH', high:102, low:100, midpoint:101, createdAt:at.toISOString(), invalidated:false, filled:false, flipped:false }; const c = (open, high, low, close, volume=100) => ({ open, high, low, close, volume, timestamp: at }); const cases = [{ name:'bullish reaction', input:{ zone:bullishZone, candles:[c(100.5,102,100,101.8)], currentPrice:101.8 } }, { name:'bearish reaction', input:{ zone:bearishZone, candles:[c(101.5,102,100,100.2)], currentPrice:100.2 } }, { name:'no reaction', input:{ zone:bullishZone, candles:[c(103,104,102.5,103.5)], currentPrice:103.5 } }]; for (const item of cases) { const result = evaluateReaction(item.input); console.log(item.name + ': output=' + result.output + ' reaction=' + result.reaction + ' confidence=' + result.confidence); }"
npm.cmd run ict:test
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- A compiled-module sanity check returned:
  - Bullish reaction -> `BUY`
  - Bearish reaction -> `SELL`
  - No reaction -> `NONE`
- Confidence scoring returned `100` for full bullish/bearish confirmation and `38.89` for the no-reaction sample that only had body direction without return-to-zone confirmation.
- Existing deterministic detector fixtures still pass: `ICT FVG/IFVG fixture tests: 7/7 passed`.

### Errors Encountered

One import typo was corrected while creating `src/ict/reactionTypes.ts`. No build errors or fixture test failures remained after correction.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

Reaction sanity check output:

```text
bullish reaction: output=BUY reaction=BULLISH_REACTION confidence=100
bearish reaction: output=SELL reaction=BEARISH_REACTION confidence=100
no reaction: output=NONE reaction=NO_REACTION confidence=38.89
```

`npm.cmd run ict:test` result:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 5C: add deterministic reaction fixture tests for return-to-zone, midpoint, body-close, volume-confirmed, and failed-reaction cases before integrating reaction analytics into replay reports.

## Phase 5C

### Objective

Validate the ICT reaction engine with deterministic fixtures. The fixture suite covers bullish reaction, bearish reaction, midpoint rejection, body close confirmation, volume confirmed reaction, failed reaction, no reaction, and invalidated zone handling. This phase does not add trading, signals, wallets, or exchange integration.

### Files Created

- `src/ict/reactionFixtures.ts`
- `src/ict/testReactionEngine.ts`

### Files Modified

- `src/ict/reactionEngine.ts`
- `package.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\reactionTypes.ts
Get-Content src\ict\reactionEngine.ts
Get-Content package.json
Get-Content docs\DEVLOG.md -Tail 120
npm.cmd run build
npm.cmd run ict:reaction-test
npm.cmd run ict:test
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- New deterministic reaction tests passed with `npm.cmd run ict:reaction-test`.
- The reaction fixture runner prints test name, expected result, actual result, and `PASS` or `FAIL`.
- The reaction fixture runner exits with `process.exit(1)` if any fixture fails.
- Existing FVG/IFVG detector fixture tests still pass with `npm.cmd run ict:test`.
- Invalidated zones now return `NONE` with zero confidence.

### Errors Encountered

No build errors or fixture test failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:reaction-test` output:

```text
> nado-trading-bot@1.0.0 ict:reaction-test
> ts-node src/ict/testReactionEngine.ts

Test: bullish reaction
Expected: {"output":"BUY","reaction":"BULLISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"BUY","reaction":"BULLISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

Test: bearish reaction
Expected: {"output":"SELL","reaction":"BEARISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"SELL","reaction":"BEARISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

Test: midpoint rejection
Expected: {"output":"NONE","reaction":"NO_REACTION","confidence":61.11,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"NONE","reaction":"NO_REACTION","confidence":61.11,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

Test: body close confirmation
Expected: {"output":"BUY","reaction":"BULLISH_REACTION","confidence":77.78,"returnToZone":true,"midpointInteraction":false,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"BUY","reaction":"BULLISH_REACTION","confidence":77.78,"returnToZone":true,"midpointInteraction":false,"bodyCloseConfirmation":true,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

Test: volume confirmed reaction
Expected: {"output":"BUY","reaction":"BULLISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":true}
Actual:   {"output":"BUY","reaction":"BULLISH_REACTION","confidence":100,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":true}
Result:   PASS

Test: failed reaction
Expected: {"output":"NONE","reaction":"NO_REACTION","confidence":90,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":false}
Actual:   {"output":"NONE","reaction":"NO_REACTION","confidence":90,"returnToZone":true,"midpointInteraction":true,"bodyCloseConfirmation":true,"volumeConfirmation":false}
Result:   PASS

Test: no reaction
Expected: {"output":"NONE","reaction":"NO_REACTION","confidence":0,"returnToZone":false,"midpointInteraction":false,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"NONE","reaction":"NO_REACTION","confidence":0,"returnToZone":false,"midpointInteraction":false,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

Test: invalidated zone
Expected: {"output":"NONE","reaction":"NO_REACTION","confidence":0,"returnToZone":false,"midpointInteraction":false,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Actual:   {"output":"NONE","reaction":"NO_REACTION","confidence":0,"returnToZone":false,"midpointInteraction":false,"bodyCloseConfirmation":false,"volumeConfirmation":"NOT_EVALUATED"}
Result:   PASS

ICT reaction fixture tests: 8/8 passed
```

`npm.cmd run ict:test` result:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 5D: integrate reaction analytics into historical replay reports as research-only statistics, while keeping all trading, entries, exits, wallets, and exchange integration disabled.

## Phase 5D

### Objective

Integrate the existing ICT reaction engine into historical replay reports as research-only analytics. The replay now evaluates detected FVG/IFVG zones for reaction classifications and reports BUY reactions, SELL reactions, NONE reactions, confidence distributions, average confidence, reaction frequency, and volume-confirmed reaction statistics. This phase does not add trading, entries, exits, wallets, order placement, or exchange integration.

### Files Created

- `data/historical/phase5d-reaction-sample.csv`

### Files Modified

- `src/ict/historicalReplay.ts`
- `logs/ict-replay-report.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\historicalReplay.ts
Get-Content src\ict\reactionEngine.ts
Get-Content src\ict\reactionTypes.ts
Get-Content docs\DEVLOG.md -Tail 140
npm.cmd run build
npm.cmd run ict:replay
Select-String -Path logs\ict-replay-report.json -Pattern 'reactionAnalytics|buyReactions|sellReactions|noneReactions|confidenceDistribution|volumeConfirmedReactions|reactionFrequency'
Get-Content logs\ict-replay-report.json -Tail 140
npm.cmd run ict:reaction-test
npm.cmd run ict:test
Select-String -Path logs\ict-replay-report.json -Pattern '"fileCount": 3|"buyReactions":|"sellReactions":|"noneReactions":|"averageConfidence":|"volumeConfirmedReactions":|"confidenceDistribution"'
Get-ChildItem data\historical -Force | Select-Object Name,Length,LastWriteTime
Get-Item logs\ict-replay-report.json | Select-Object FullName,Length,LastWriteTime
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- `npm.cmd run ict:replay` processed three historical files.
- Replay report generated `reactionAnalytics` blocks per file and in aggregate totals.
- Aggregate replay output included:
  - BUY reactions: `2`
  - SELL reactions: `1`
  - NONE reactions: `12`
  - Reaction frequency: `20%`
  - Average reaction confidence: `42`
  - Confidence distribution summary
  - Volume-confirmed reactions: `1`
  - Volume confirmation pass rate: `27.27%`
- Deterministic reaction tests still pass: `ICT reaction fixture tests: 8/8 passed`.
- FVG/IFVG detector tests still pass: `ICT FVG/IFVG fixture tests: 7/7 passed`.

### Errors Encountered

No build errors, replay runtime errors, reaction fixture failures, or detector fixture failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:replay` output:

```text
> nado-trading-bot@1.0.0 ict:replay
> ts-node src/ict/historicalReplay.ts

ICT historical replay complete
Files processed: 3
Report: C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\ict-replay-report.json
Total candles: 22
Total FVGs: 8
Bullish FVGs: 3
Bearish FVGs: 5
Total IFVGs: 7
Bullish IFVGs: 4
Bearish IFVGs: 3
Combined fill rate: 66.67%
Combined flip rate: 66.67%
Average FVG lifespan: 1.25 candles
Average IFVG lifespan: 1 candles
Average combined lifespan: 1.13 candles
Lifespan distribution: count=15 min=0 median=1 p90=3 max=3 candles
Time-to-fill distribution: count=10 min=1 median=1 p90=3 max=3 candles
Time-to-flip distribution: count=10 min=1 median=1.5 p90=3 max=4 candles
BUY reactions: 2
SELL reactions: 1
NONE reactions: 12
Reaction frequency: 20%
Average reaction confidence: 42
Confidence distribution: count=15 min=0 median=55 p90=90 max=100
Volume-confirmed reactions: 1
Volume confirmation pass rate: 27.27%
```

Generated report excerpt:

```json
{
  "fileCount": 3,
  "reactionAnalytics": {
    "totalZonesEvaluated": 15,
    "buyReactions": 2,
    "sellReactions": 1,
    "noneReactions": 12,
    "reactionFrequency": 20,
    "averageConfidence": 42,
    "confidenceDistribution": {
      "count": 15,
      "min": 0,
      "max": 100,
      "average": 42,
      "median": 55,
      "p90": 90
    },
    "volumeConfirmedReactions": 1,
    "volumeConfirmedBuyReactions": 0,
    "volumeConfirmedSellReactions": 1,
    "volumeConfirmedNoneReactions": 2,
    "volumeConfirmationPassRate": 27.27,
    "volumeConfirmedReactionRate": 33.33
  }
}
```

`npm.cmd run ict:reaction-test` result:

```text
ICT reaction fixture tests: 8/8 passed
```

`npm.cmd run ict:test` result:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 5E: export replay reaction analytics to CSV/HTML research summaries so large report outputs can be reviewed without opening the full JSON file.

## Phase 6A

### Objective

Build the ICT Signal Engine that converts existing ICT reaction results into formal signal classifications. The engine accepts a detected FVG/IFVG zone, reaction result, and optional candle/context metadata, then outputs `BUY`, `SELL`, or `NONE` with confidence, reason, source zone type, and zone id. This phase does not place trades, enter positions, exit positions, add wallets, add exchange integration, or connect to Nado.

### Files Created

- `src/ict/ictSignalTypes.ts`
- `src/ict/ictSignalEngine.ts`
- `src/ict/testIctSignalEngine.ts`

### Files Modified

- `package.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\reactionTypes.ts
Get-Content src\ict\types.ts
Get-Content package.json
Get-Content docs\DEVLOG.md -Tail 120
npm.cmd run build
npm.cmd run ict:signal-test
npm.cmd run ict:reaction-test
npm.cmd run ict:test
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- Signal fixture tests passed with `npm.cmd run ict:signal-test`.
- The signal fixture runner exits with non-zero status if any test fails.
- Reaction fixture tests still pass with `npm.cmd run ict:reaction-test`.
- FVG/IFVG detector fixture tests still pass with `npm.cmd run ict:test`.
- Rules verified:
  - BUY only when reaction output is `BUY` and confidence is at/above threshold.
  - SELL only when reaction output is `SELL` and confidence is at/above threshold.
  - Confidence below default threshold `75` returns `NONE`.
  - Invalidated zones always return `NONE`.
  - `NONE` reactions return `NONE`.

### Errors Encountered

No build errors or fixture test failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:signal-test` output:

```text
> nado-trading-bot@1.0.0 ict:signal-test
> ts-node src/ict/testIctSignalEngine.ts

Test: BUY signal above threshold
Expected: {"signal":"BUY","confidence":82,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"BUY","minConfidence":75}
Actual:   {"signal":"BUY","confidence":82,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"BUY","minConfidence":75}
Result:   PASS

Test: SELL signal above threshold
Expected: {"signal":"SELL","confidence":88,"sourceZoneType":"IFVG","zoneId":"signal-ifvg-bear","reactionOutput":"SELL","minConfidence":75}
Actual:   {"signal":"SELL","confidence":88,"sourceZoneType":"IFVG","zoneId":"signal-ifvg-bear","reactionOutput":"SELL","minConfidence":75}
Result:   PASS

Test: confidence below threshold returns NONE
Expected: {"signal":"NONE","confidence":74,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"BUY","minConfidence":75}
Actual:   {"signal":"NONE","confidence":74,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"BUY","minConfidence":75}
Result:   PASS

Test: invalidated zone returns NONE
Expected: {"signal":"NONE","confidence":0,"sourceZoneType":"FVG","zoneId":"signal-invalidated-fvg","reactionOutput":"BUY","minConfidence":75}
Actual:   {"signal":"NONE","confidence":0,"sourceZoneType":"FVG","zoneId":"signal-invalidated-fvg","reactionOutput":"BUY","minConfidence":75}
Result:   PASS

Test: NONE reaction returns NONE
Expected: {"signal":"NONE","confidence":100,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"NONE","minConfidence":75}
Actual:   {"signal":"NONE","confidence":100,"sourceZoneType":"FVG","zoneId":"signal-fvg-bull","reactionOutput":"NONE","minConfidence":75}
Result:   PASS

ICT signal fixture tests: 5/5 passed
```

Regression outputs:

```text
ICT reaction fixture tests: 8/8 passed
ICT FVG/IFVG fixture tests: 7/7 passed
```

### Next Recommended Phase

Phase 6B: integrate ICT signal generation into historical replay reports as research-only signal analytics, without connecting signals to trading, entries, exits, wallets, exchanges, or Nado.

## Phase 6B

### Objective

Integrate the ICT Signal Engine into historical replay reports as research-only signal analytics. The replay now uses the existing FVG/IFVG detectors, reaction engine, and ICT signal engine to add aggregate signal statistics. This phase does not place trades, enter positions, exit positions, add wallet logic, add exchange integration, or connect to Nado.

### Files Created

- None

### Files Modified

- `src/ict/historicalReplay.ts`
- `logs/ict-replay-report.json`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\ict\historicalReplay.ts
Get-Content src\ict\ictSignalEngine.ts
Get-Content src\ict\ictSignalTypes.ts
Get-Content docs\DEVLOG.md -Tail 140
npm.cmd run build
npm.cmd run ict:replay
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
Select-String -Path logs\ict-replay-report.json -Pattern 'signalAnalytics|totalBuySignals|totalSellSignals|totalNoneSignals|signalFrequency|averageSignalConfidence|signalsByZoneType|signalsByFVG|signalsByIFVG|rejectedByConfidenceThreshold|rejectedBecauseZoneInvalidated'
Get-Content logs\ict-replay-report.json -Tail 120
Get-ChildItem src\ict,logs -Force | Where-Object { $_.Name -in @('historicalReplay.ts','ict-replay-report.json') } | Select-Object FullName,Length,LastWriteTime
```

### Verification

- TypeScript compilation passed with `npm.cmd run build`.
- `npm.cmd run ict:replay` generated `signalAnalytics` in `logs/ict-replay-report.json`.
- Replay signal analytics include:
  - `totalBuySignals`
  - `totalSellSignals`
  - `totalNoneSignals`
  - `signalFrequency`
  - `averageSignalConfidence`
  - confidence distributions
  - `signalsByZoneType`
  - `signalsByFVG`
  - `signalsByIFVG`
  - `rejectedByConfidenceThreshold`
  - `rejectedBecauseZoneInvalidated`
- Required regression tests passed:
  - `npm.cmd run ict:test`
  - `npm.cmd run ict:reaction-test`
  - `npm.cmd run ict:signal-test`

### Errors Encountered

No build errors, replay runtime errors, or fixture test failures were encountered.

### Output Examples

`npm.cmd run build` output:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

`npm.cmd run ict:replay` signal output:

```text
BUY signals: 0
SELL signals: 1
NONE signals: 14
Signal frequency: 6.67%
Average signal confidence: 6.67
Signal confidence distribution: count=15 min=0 median=0 p90=0 max=100
Signals rejected by confidence: 0
Signals rejected by invalidated zone: 10
```

Generated report excerpt:

```json
{
  "signalAnalytics": {
    "totalZonesEvaluated": 15,
    "totalBuySignals": 0,
    "totalSellSignals": 1,
    "totalNoneSignals": 14,
    "signalFrequency": 6.67,
    "averageSignalConfidence": 6.67,
    "signalsByZoneType": {
      "FVG": {
        "buy": 0,
        "sell": 1,
        "none": 7
      },
      "IFVG": {
        "buy": 0,
        "sell": 0,
        "none": 7
      }
    },
    "signalsByFVG": {
      "buy": 0,
      "sell": 1,
      "none": 7
    },
    "signalsByIFVG": {
      "buy": 0,
      "sell": 0,
      "none": 7
    },
    "rejectedByConfidenceThreshold": 0,
    "rejectedBecauseZoneInvalidated": 10,
    "minConfidence": 75
  }
}
```

Regression outputs:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
ICT reaction fixture tests: 8/8 passed
ICT signal fixture tests: 5/5 passed
```

### Next Recommended Phase

Phase 6C: export replay signal analytics to CSV/HTML research summaries so signal counts, rejection reasons, and zone-type breakdowns can be reviewed without opening the full JSON report.

## Phase 6C

### Objective

Connected the ICT Signal Engine to the existing paper trading simulation engine behind a configurable signal source switch. The default remains `VOLUME_SPIKE`; setting `SIGNAL_SOURCE=ICT` runs the existing FVG/IFVG detectors, reaction engine, and ICT signal engine before allowing simulated paper entries. No real order, wallet, private key, exchange, or Nado integration was added.

### Files Created

- `src/ict/testPaperTradingIntegration.ts`

### Files Modified

- `src/types.ts`
- `src/config.ts`
- `src/bot.ts`
- `src/index.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `package.json`
- `.env.example`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\types.ts
Get-Content src\config.ts
Get-Content src\bot.ts
Get-Content src\sessionStats.ts
Get-Content src\journal\types.ts
Get-Content src\journal\tradeJournal.ts
Get-Content src\state.ts
Get-Content src\index.ts
Get-Content package.json
if (Test-Path .env.example) { Get-Content .env.example } else { 'NO_ENV_EXAMPLE' }
Get-Content src\ict\ictSignalTypes.ts
Get-Content src\ict\ictSignalEngine.ts
Get-Content src\ict\reactionTypes.ts
Get-Content src\ict\reactionEngine.ts
Get-Content src\ict\fvgDetector.ts
Get-Content src\ict\ifvgDetector.ts
Get-Content src\signals\types.ts
Get-Content src\signals\volumeSpikeReversal.ts
Get-Content tsconfig.json
$path='src\sessionStats.ts'; $i=1; Get-Content $path | ForEach-Object { '{0,4}: {1}' -f $i, $_; $i++ } | Select-Object -Skip 96 -First 95
$path='src\sessionStats.ts'; (Get-Content $path)[177..184] | ForEach-Object { $_ }
$path='src\sessionStats.ts'; (Get-Content $path)[185..192] | ForEach-Object { $_ }
$line=(Get-Content src\sessionStats.ts)[185]; $line; ($line.ToCharArray() | ForEach-Object { [int][char]$_ }) -join ' '
rg "makeEvent|TradeEvent|signalSource|printDashboard\(" src
rg "latestIctSignal|BotConfig|SessionStats" src -g "*.ts"
Get-Content src\ict\testIctSignalEngine.ts
Get-Content src\ict\fixtures.ts
Get-Content src\reports\performanceReport.ts
Get-Content src\ict\reactionFixtures.ts
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:paper-sim
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:paper-sim
Get-Content docs\DEVLOG.md -Tail 120
Get-Content docs\DEVLOG.md -Tail 140
Get-ChildItem src\ict\testPaperTradingIntegration.ts,src\bot.ts,src\config.ts,src\types.ts,src\sessionStats.ts,src\journal\types.ts,src\journal\tradeJournal.ts,src\index.ts,package.json,.env.example,docs\DEVLOG.md | Select-Object FullName,Length,LastWriteTime
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:paper-sim` passed: `ICT paper integration dry-run tests: 3/3 passed`.
- Dashboard snapshots now include signal source and ICT signal fields when `SIGNAL_SOURCE=ICT`.
- Journal CSV/event records now include signal source and ICT signal metadata.

### Errors Encountered

- Some existing files contained encoded box-drawing/punctuation characters that resisted narrow line patches. `src/bot.ts`, `src/index.ts`, and `src/sessionStats.ts` were replaced with clean ASCII equivalents while preserving existing behavior and adding Phase 6C behavior.
- No TypeScript build errors or fixture failures were encountered after implementation.

### Output Examples

`npm.cmd run build`:

```text
> nado-trading-bot@1.0.0 build
> tsc
```

Required regression tests:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
ICT reaction fixture tests: 8/8 passed
ICT signal fixture tests: 5/5 passed
```

Dry-run paper integration test:

```text
Test: ICT BUY signal maps to paper LONG entry
Expected: ENTER_LONG
Actual:   ENTER_LONG
Result:   PASS

Test: ICT SELL signal maps to paper SHORT entry
Expected: ENTER_SHORT
Actual:   ENTER_SHORT
Result:   PASS

Test: ICT NONE signal maps to no paper entry
Expected: NO_ENTRY
Actual:   NO_ENTRY
Result:   PASS

ICT paper integration dry-run tests: 3/3 passed
```

### Next Recommended Phase

Phase 6D: add controlled paper-trading replay metrics for ICT-sourced entries, including simulated PnL, drawdown, trade duration, and rejection reasons, still without real orders or wallet integration.

## Bug Fix — SIGNAL_SOURCE Loading

### Root Cause

`.env.example` contained `SIGNAL_SOURCE`, but the active `.env` file did not. `src/config.ts` correctly read `process.env.SIGNAL_SOURCE`, but when the value was missing it silently defaulted to `VOLUME_SPIKE`, so startup and dashboard output showed `VOLUME_SPIKE`.

### Files Modified

- `src/config.ts`
- `src/index.ts`
- `.env`
- `docs/DEVLOG.md`

### Verification Performed

```powershell
npm.cmd run build
node -e "const { loadConfig } = require('./dist/config'); const config = loadConfig(); console.log('Signal Source: ' + config.signalSource);"
node -e "process.env.SIGNAL_SOURCE=''; const { loadConfig } = require('./dist/config'); const config = loadConfig(); console.log('Signal Source: ' + config.signalSource);"
```

### Final Result

- `.env` now includes `SIGNAL_SOURCE=ICT`.
- Startup header now prints `Signal Source: <configured value>`.
- Dashboard already displays `Signal Source   <configured value>` from `config.signalSource`.
- Missing or blank `SIGNAL_SOURCE` now prints a warning and defaults to `VOLUME_SPIKE`.
- Build passed, and compiled config verification printed `Signal Source: ICT` from the active `.env`.

## PnL Side Handling Audit and ICT Run Analytics

### Objective

Audit paper-trading side handling after the ICT paper integration and summarize the saved live-public paper run. The scope was read-only for trading behavior: no ICT logic, reaction logic, signal logic, wallet logic, exchange integration, or order logic was changed.

### Context

The bot had been run with:

- `SIGNAL_SOURCE=ICT`
- `MARKET_DATA_SOURCE=REAL_PUBLIC`
- `SYMBOL=BTC`
- `BOT_MODE=simulation`

The user requested confirmation that:

- BUY signals open LONG positions.
- SELL signals open SHORT positions.
- LONG unrealized PnL uses `size * (currentPrice - avgEntry)`.
- SHORT unrealized PnL uses `size * (avgEntry - currentPrice)`.
- Dashboard side label matches actual position side.
- Realized PnL uses the same side-aware formula.

### Files Inspected

- `session-stats.json`
- `position-state.json`
- `logs/trades.csv`
- `logs/events.log`
- `logs/completed-trades.json`
- `src/bot.ts`
- `src/sessionStats.ts`

### Commands Executed

```powershell
Get-Content session-stats.json
Get-Content position-state.json
if (Test-Path logs\trades.csv) { Get-Content logs\trades.csv -Tail 50 } else { 'logs/trades.csv not found' }
if (Test-Path logs\completed-trades.json) { Get-Content logs\completed-trades.json } else { 'logs/completed-trades.json not found' }
if (Test-Path logs\events.log) { Get-Content logs\events.log -Tail 80 } else { 'logs/events.log not found' }
Select-String -Path src\bot.ts,src\sessionStats.ts -Pattern "pnlUsd|unrealized|activeSide|position.side|config.side|Signal Source|LONG|SHORT"
node -e "<calculated runtime, implied price, TP, DCA, signal rate, and PnL metrics from session-stats.json and position-state.json>"
$path='src\bot.ts'; $i=1; Get-Content $path | ForEach-Object { '{0,4}: {1}' -f $i, $_; $i++ } | Select-Object -Skip 186 -First 155
$path='src\sessionStats.ts'; $i=1; Get-Content $path | ForEach-Object { '{0,4}: {1}' -f $i, $_; $i++ } | Select-Object -Skip 36 -First 130
```

### PnL Side Handling Findings

- BUY signal opens LONG:
  - `src/bot.ts` maps `ictSignal.signal === 'BUY'` to `LONG`.
- SELL signal opens SHORT:
  - `src/bot.ts` maps non-NONE ICT SELL to `SHORT`.
- Unrealized LONG/SHORT PnL is side-aware:
  - `src/sessionStats.ts` calculates LONG as `positionValue - costBasis`.
  - `src/sessionStats.ts` calculates SHORT as `costBasis - positionValue`.
- Realized close PnL is side-aware:
  - `src/bot.ts` calculates LONG as `exitValue - entryValue`.
  - `src/bot.ts` calculates SHORT as `entryValue - exitValue`.
- Dashboard side label uses actual position side:
  - `src/sessionStats.ts` uses `position.side` when a position exists, falling back to configured side only when no position is open.

### Run Analytics

Saved session window:

- Started: `2026-06-01T21:22:22.143Z`
- Updated: `2026-06-01T22:36:37.416Z`
- Runtime: about `74.25` minutes

Session configuration and state:

- Data source: `REAL_PUBLIC (Binance)`
- Signal source: `ICT`
- Symbol: `BTC`
- Completed trades: `0`
- ICT signals fired: `40`
- Approximate signal rate: `32.32` signals/hour
- Latest ICT signal: `BUY`
- Latest ICT confidence: `77.78`
- Latest ICT zone type: `FVG`
- Latest ICT zone id: `FVG:BULLISH:63:64:65:71153.02:71249.48`

Open paper position:

- Side: `SHORT`
- Entry signal: `SELL`
- Entry price: `$71,129.99`
- Position size: `0.0014058767616865965 BTC`
- Total invested: `$100.00`
- DCA count: `1`
- Average entry: `$71,129.99`

PnL and risk metrics:

- Implied current price from saved unrealized PnL: about `$71,222.18`
- Unrealized PnL: `-$0.1296`
- Unrealized return on invested capital: about `-0.1296%`
- Max drawdown: about `$0.3199`
- SHORT take-profit price: about `$70,703.21`
- SHORT DCA trigger price: about `$72,196.94`
- Distance to take profit: about `$518.97`
- Distance to DCA trigger: about `$974.76`

### Log Findings

`logs/events.log` showed one paper entry:

```text
ENTRY SHORT BTC price=$71129.99 signal=SELL signalSource=ICT ict=SELL confidence=77.78 zone=FVG:FVG:BEARISH:4:5:6:71172.85:71200.01 reason="Reaction output SELL met confidence threshold"
```

`logs/completed-trades.json` contained:

```json
[]
```

No realized PnL exists yet because no trade closed during the saved run.

### Issues Observed

- `logs/trades.csv` still had the old CSV header ending at `signalDirection`, while the row contained the newer ICT metadata columns appended after it.
- This is a logging header/data-shape issue only. The readable `events.log` contained the ICT metadata correctly.
- No PnL formula issue was found.

### Files Modified

- `docs/DEVLOG.md`

### Verification Result

The side-handling audit passed:

- BUY -> LONG confirmed.
- SELL -> SHORT confirmed.
- LONG unrealized PnL formula confirmed.
- SHORT unrealized PnL formula confirmed.
- Realized PnL formula confirmed.
- Dashboard active side display confirmed.

### Final Status

No trading logic changes were made. The current saved run has one open SHORT paper position from an ICT SELL signal, no completed trades, and a small unrealized loss. The next recommended fix is to update the CSV journal header handling so existing `logs/trades.csv` files with old headers are detected and rotated or rewritten safely before appending ICT metadata columns.

## Phase 6D.5 — ICT Signal Audit Log

### Objective

Create a complete observability trail for every ICT signal evaluation so research can inspect what the bot saw, what was accepted, what was rejected, why it was rejected, and what can later be correlated to paper trade events. This phase is analytics and observability only.

No ICT logic, FVG logic, IFVG logic, reaction logic, confidence calculations, entry logic, exit logic, take-profit logic, DCA logic, wallet logic, exchange integration, or Nado integration was changed.

### Files Created

- `src/ict/ictSignalAuditLog.ts`
- `logs/ict-signals.csv`
- `logs/ict-signals.json`

### Files Modified

- `src/bot.ts`
- `src/types.ts`
- `src/sessionStats.ts`
- `src/reports/performanceReport.ts`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
Get-Content src\bot.ts
Get-Content src\types.ts
Get-Content src\sessionStats.ts
Get-Content src\report.ts
Get-Content src\reports\performanceReport.ts
Get-Content package.json
if (Test-Path logs\ict-signals.csv) { Get-Content logs\ict-signals.csv -TotalCount 5 } else { 'NO_ICT_SIGNALS_CSV' }
if (Test-Path logs\ict-signals.json) { Get-Content logs\ict-signals.json -TotalCount 20 } else { 'NO_ICT_SIGNALS_JSON' }
Get-ChildItem logs -Force | Select-Object Name,Length,LastWriteTime
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run report
Get-Content logs\ict-signals.csv
Get-Content logs\ict-signals.json
Get-ChildItem src\ict\ictSignalAuditLog.ts,logs\ict-signals.csv,logs\ict-signals.json,src\bot.ts,src\types.ts,src\sessionStats.ts,src\reports\performanceReport.ts | Select-Object FullName,Length,LastWriteTime
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run report` printed the new `ICT SIGNAL AUDIT` section.
- `logs/ict-signals.csv` exists with the required header.
- `logs/ict-signals.json` exists with `summary` counters and `records`.

### Errors Encountered

- The existing report file contained encoded box-drawing/punctuation characters that blocked narrow patching. `src/reports/performanceReport.ts` was replaced with a clean ASCII equivalent while preserving existing report behavior and adding the ICT signal audit section.
- No build failures or fixture test failures were encountered.

### Output Examples

`logs/ict-signals.csv` initial header:

```csv
timestamp,symbol,price,signal,confidence,zoneType,zoneId,reason,accepted,rejectionReason,signalSource,marketDataSource
```

`logs/ict-signals.json` initial structure:

```json
{
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "summary": {
    "totalEvaluations": 0,
    "buyCount": 0,
    "sellCount": 0,
    "noneCount": 0,
    "acceptedCount": 0,
    "rejectedCount": 0
  },
  "records": []
}
```

Required verification output:

```text
ICT FVG/IFVG fixture tests: 7/7 passed
ICT reaction fixture tests: 8/8 passed
ICT signal fixture tests: 5/5 passed
```

Report output excerpt before a new post-phase bot run:

```text
ICT SIGNAL AUDIT
  Total Signals Seen                                       0
  Acceptance Rate                                       0.0%
  Rejection Rate                                        0.0%
  BUY Count                                                0
  SELL Count                                               0
  NONE Count                                               0
```

### Final Status

Phase 6D.5 is complete. The next bot run in `SIGNAL_SOURCE=ICT` mode will append every per-zone ICT signal evaluation to `logs/ict-signals.csv` and `logs/ict-signals.json`, update live dashboard counters for ICT evaluations/accepted/rejected, and expose aggregate signal audit analytics through `npm run report`.

## Phase 6E — ICT Trade Selection Layer

### Objective

Add a paper-only ICT trade selection layer so the bot does not automatically take the first accepted ICT signal. The selector evaluates all current ICT signal evaluations and selects the best candidate based on confidence, zone type, target profit fit, reaction confirmation, and volume confirmation.

The strategy research target is quick paper trades aiming for approximately `$0.50` to `$1.00` profit per completed trade, but this phase did not change ICT detection, IFVG/FVG logic, reaction logic, signal confidence logic, TP/DCA logic, exit logic, wallet logic, exchange integration, or real order handling.

### Files Created

- `src/ict/tradeCandidateTypes.ts`
- `src/ict/tradeSelectionEngine.ts`
- `src/ict/testTradeSelectionEngine.ts`

### Files Modified

- `src/bot.ts`
- `src/types.ts`
- `src/sessionStats.ts`
- `src/ict/ictSignalAuditLog.ts`
- `logs/ict-signals.csv`
- `package.json`
- `docs/DEVLOG.md`

### What Changed

- Added a pure ICT trade selection engine.
- For every evaluated candidate, the selector calculates:
  - `expectedProfitAtTPUsd`
  - `distanceToTPPercent`
  - `distanceToInvalidationPercent`
  - `confidence`
  - `zoneType`
  - `signalDirection`
  - `reason`
  - `score`
- Selection rules implemented:
  - Reject below minimum confidence.
  - Reject expected TP profit below `$0.50`.
  - Prefer `$0.50` to `$1.00` expected TP profit.
  - Allow above `$1.00`, marked as `EXTENDED_TARGET`.
  - Select highest score.
  - Return `NONE` if no candidate qualifies.
- Scoring includes:
  - Confidence weight.
  - IFVG/FVG zone quality weight.
  - Target profit fit weight.
  - Reaction confirmation weight.
  - Volume confirmation weight.
- Bot ICT behavior now:
  - Evaluates all current ICT signal results.
  - Passes them to `tradeSelectionEngine`.
  - Enters only the selected candidate when flat.
  - Keeps rejected and not-selected candidates visible in `logs/ict-signals.csv` / `logs/ict-signals.json`.
- Dashboard now shows:
  - Candidates evaluated.
  - Selected candidate.
  - Expected profit at TP.
  - Selection score.
  - Selection rejection reason when none is selected.

### Commands Executed

```powershell
Get-Content src\bot.ts
Get-Content src\types.ts
Get-Content src\sessionStats.ts
Get-Content src\ict\ictSignalTypes.ts
Get-Content src\ict\reactionTypes.ts
Get-Content package.json
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run report
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 5/5 passed`.
- `npm.cmd run report` passed and displayed the `ICT SIGNAL AUDIT` section.

### Output Examples

Trade selection fixture output:

```text
Test: first accepted signal is not always selected
Result:   PASS

Test: highest score candidate selected
Result:   PASS

Test: candidate below $0.50 target rejected
Result:   PASS

Test: candidate between $0.50-$1.00 preferred
Result:   PASS

Test: no valid candidate returns NONE
Result:   PASS

ICT trade selection fixture tests: 5/5 passed
```

Report smoke check output:

```text
ICT SIGNAL AUDIT
  Total Signals Seen                                     248
  Acceptance Rate                                      12.5%
  Rejection Rate                                       87.5%
  BUY Count                                               19
  SELL Count                                              12
  NONE Count                                             217
```

### Errors Encountered

No build failures or fixture test failures were encountered.

### Final Status

Phase 6E is complete. ICT mode now evaluates all current accepted ICT signals through a trade selection layer and only enters the selected paper candidate. Rejected and not-selected candidates are preserved in the ICT signal audit log. No wallet, exchange, real order, ICT detection, reaction, confidence, TP, DCA, or exit logic was changed.

## Phase 6F — Position Exit Manager

### Objective

Make paper positions close more reliably for quick in-and-out research trades targeting approximately `$0.50` to `$1.00` profit per completed trade. This phase adds side-aware paper exit evaluation for take profit, quick profit, max hold time, and max loss.

No ICT detection logic, reaction logic, signal confidence logic, wallet logic, exchange integration, or real order handling was changed.

### Close Logic Audit

Existing close behavior before Phase 6F:

- LONG take-profit was side-aware:
  - `currentPrice >= avgEntry * (1 + takeProfitPct)`
- SHORT take-profit was side-aware:
  - `currentPrice <= avgEntry * (1 - takeProfitPct)`
- LONG DCA was side-aware:
  - DCA triggered on adverse downward move.
- SHORT DCA was side-aware:
  - DCA triggered on adverse upward move.
- Realized PnL was side-aware:
  - LONG: `exitValue - entryValue`
  - SHORT: `entryValue - exitValue`
- Close records wrote through:
  - `logs/events.log`
  - `logs/trades.csv`
  - `logs/completed-trades.json`
  - `session-stats.json` through `recordClosedTrade`

Gap found:

- Positions only closed on percentage take-profit or risk paths already present in code.
- There was no dollar-based quick profit exit.
- There was no persisted position open timestamp for max-hold exits.
- There was no max-loss dollar close path.

### Files Created

- `src/positionExitTypes.ts`
- `src/positionExitManager.ts`
- `src/testPositionExitManager.ts`

### Files Modified

- `src/types.ts`
- `src/state.ts`
- `src/config.ts`
- `.env`
- `.env.example`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/sessionStats.ts`
- `src/bot.ts`
- `package.json`
- `docs/DEVLOG.md`

### What Changed

- Added `PositionExitManager` pure evaluation module.
- Added `openedAt` to persisted `PositionState`.
- Added configurable paper-only exit controls:
  - `PROFIT_TARGET_USD_MIN=0.50`
  - `PROFIT_TARGET_USD_MAX=1.00`
  - `MAX_POSITION_MINUTES=30`
  - `MAX_LOSS_USD=1.00`
- Added close reasons:
  - `TAKE_PROFIT`
  - `QUICK_PROFIT_EXIT`
  - `TIME_EXIT`
  - `RISK_EXIT`
- Exit evaluation now runs before DCA management.
- Quick profit exit closes when unrealized PnL is at least `PROFIT_TARGET_USD_MIN`.
- Time exit closes when position age is at least `MAX_POSITION_MINUTES`.
- Risk exit closes when unrealized PnL is at or below `-MAX_LOSS_USD`.
- Dashboard now shows:
  - TP price
  - quick profit target
  - max loss
  - position age
  - last close reason when flat
- `TradeJournal` now accepts an optional `logsDir` for deterministic isolated tests while preserving default `logs/` behavior.

### Commands Executed

```powershell
Get-Content src\bot.ts
Get-Content src\types.ts
Get-Content src\config.ts
Get-Content src\state.ts
Get-Content src\journal\types.ts
Get-Content src\journal\tradeJournal.ts
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:paper-sim
npm.cmd run position:exit-test
npm.cmd run build
npm.cmd run position:exit-test
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:paper-sim
npm.cmd run position:exit-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:paper-sim` passed: `ICT paper integration dry-run tests: 3/3 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 7/7 passed`.

### Output Examples

Position exit test output:

```text
Test: LONG closes at TP
Expected: TAKE_PROFIT
Actual:   TAKE_PROFIT
Result:   PASS

Test: SHORT closes at TP
Expected: TAKE_PROFIT
Actual:   TAKE_PROFIT
Result:   PASS

Test: LONG closes at +$0.50 quick profit
Expected: QUICK_PROFIT_EXIT
Actual:   QUICK_PROFIT_EXIT
Result:   PASS

Test: SHORT closes at +$0.50 quick profit
Expected: QUICK_PROFIT_EXIT
Actual:   QUICK_PROFIT_EXIT
Result:   PASS

Test: position closes at max loss
Expected: RISK_EXIT
Actual:   RISK_EXIT
Result:   PASS

Test: position closes at max hold time
Expected: TIME_EXIT
Actual:   TIME_EXIT
Result:   PASS

Test: completed trade record is written
Expected: QUICK_PROFIT_EXIT
Actual:   QUICK_PROFIT_EXIT
Result:   PASS

Position exit manager tests: 7/7 passed
```

### Errors Encountered

- First `position:exit-test` attempt failed because the runtime denied creating a temp directory under `C:\tmp`.
- Resolved by using an isolated temporary test directory under workspace `logs/` and deleting only that test-specific directory after the test.
- No build failures remained after the test-path fix.

### Final Status

Phase 6F is complete. Paper positions now have side-aware percentage TP, dollar quick-profit exit, max-loss exit, and max-hold time exit. Every close still uses the existing journal close path, writing to events, trade CSV, completed trades JSON, and session stats. No wallet, exchange, real order, ICT detection, reaction, or signal confidence logic was changed.

## Bug Fix -- Dashboard Unrealized PnL Sign Display

### Objective

Fix dashboard formatting so unrealized PnL dollar values display an explicit `+` or `-` sign while preserving the existing percentage sign.

### Root Cause

`src/sessionStats.ts` formatted unrealized PnL dollars with `Math.abs(stats.unrealizedPnlUsd)` and only prefixed `+` for non-negative values. Negative dollar PnL therefore rendered as `$0.10` instead of `-$0.10`, while the percentage still rendered correctly as negative.

### Files Modified

- `src/sessionStats.ts`
- `docs/DEVLOG.md`

### What Changed

- Added a side-neutral display-only dollar sign:
  - `+` when `unrealizedPnlUsd >= 0`
  - `-` when `unrealizedPnlUsd < 0`
- Kept the existing unrealized PnL calculation unchanged.
- Kept exit logic unchanged.
- Kept percentage formatting side-aware by deriving its sign from `unrPct`.

### Commands Executed

```powershell
npm.cmd run build
```

### Verification

`npm.cmd run build` passed.

Expected display for a losing SHORT:

```text
Unrealized PnL  -$0.10 (-0.10%)
```

### Final Status

Dashboard unrealized PnL dollar display now includes the correct sign. No PnL calculation logic, exit logic, ICT logic, wallet logic, or exchange integration was changed.

## Phase 6G -- Entry Zone Disrespect Exit

### Objective

Close an open paper ICT position when the original selected FVG/IFVG entry zone is disrespected by a candle body close through the wrong boundary.

This is not an opposite-signal exit. The bot does not close because a new opposite signal appears. The exit only evaluates the original stored entry zone for the active paper position.

### Files Created

None.

### Files Modified

- `src/types.ts`
- `src/state.ts`
- `src/positionExitTypes.ts`
- `src/positionExitManager.ts`
- `src/bot.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/testPositionExitManager.ts`
- `docs/DEVLOG.md`

### What Changed

- Added close reasons:
  - `FVG_DISRESPECT_EXIT`
  - `IFVG_DISRESPECT_EXIT`
- Persisted original ICT entry-zone metadata on active paper positions:
  - `entryZoneId`
  - `entryZoneType`
  - `entryZoneHigh`
  - `entryZoneLow`
  - `entryZoneMidpoint`
  - `entryZoneDirection`
  - `entryZoneRespected`
- Preserved entry-zone metadata through DCA updates.
- Added pure disrespect evaluation:
  - SHORT from bearish FVG/IFVG closes only when candle close is above entry-zone high.
  - LONG from bullish FVG/IFVG closes only when candle close is below entry-zone low.
  - Wick-only boundary violations do not close.
  - Opposite signals are not used by this exit path.
- Wired the bot loop to evaluate entry-zone disrespect before normal exit/DCA management.
- Dashboard now shows:
  - Entry zone type/direction
  - Entry zone high
  - Entry zone low
  - Whether the zone is still respected
- Journal close events now include:
  - Close reason
  - Entry zone id
  - Entry zone type
  - Entry zone high/low/midpoint/direction
  - Entry zone respected flag
  - Disrespect candle close
  - Zone boundary violated

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 5/5 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 13/13 passed`.

### Output Examples

Position exit fixture output:

```text
Test: SHORT closes when bearish FVG high is body-closed above
Expected: FVG_DISRESPECT_EXIT
Actual:   FVG_DISRESPECT_EXIT
Result:   PASS

Test: SHORT does not close on wick above only
Expected: NO_CLOSE
Actual:   NO_CLOSE
Result:   PASS

Test: LONG closes when bullish FVG low is body-closed below
Expected: FVG_DISRESPECT_EXIT
Actual:   FVG_DISRESPECT_EXIT
Result:   PASS

Test: LONG does not close on wick below only
Expected: NO_CLOSE
Actual:   NO_CLOSE
Result:   PASS

Test: No close if unrelated opposite signal appears
Expected: NO_CLOSE
Actual:   NO_CLOSE
Result:   PASS

Test: completed trade is written with FVG_DISRESPECT_EXIT
Expected: FVG_DISRESPECT_EXIT
Actual:   FVG_DISRESPECT_EXIT
Result:   PASS

Position exit manager tests: 13/13 passed
```

### Errors Encountered

One TypeScript narrowing error occurred while wiring `managePosition()` after the refactor:

```text
Argument of type '"NONE" | "LONG" | "SHORT"' is not assignable to parameter of type 'TradeSide'.
```

Resolved by explicitly returning if the position side is `NONE` before DCA side handling. No behavior change was made.

### Final Status

Phase 6G is complete. ICT paper positions now store their original FVG/IFVG entry zone and can close with `FVG_DISRESPECT_EXIT` or `IFVG_DISRESPECT_EXIT` when that original zone is body-closed through in the wrong direction. No FVG detection rules, IFVG detection rules, signal confidence logic, wallet logic, exchange integration, or real order logic was changed.

## Phase 6H -- ICT FVG Rule Correction

### Objective

Correct the ICT signal path so the bot does not treat every raw 3-candle gap as a tradable ICT FVG. Raw FVG detection remains available for research, replay, and visualization, while live/paper ICT signal evaluation now uses a separate validated FVG layer.

### Reference Resources Reviewed

- `C:\Users\bjpro\Downloads\ICT 2022 Mentorship Notes TanjaTrades.pdf`
- `C:\Users\bjpro\Downloads\ICT 2022 Mentorship Notes TanjaTrades (1).pdf`
- `C:\Users\bjpro\Downloads\ICT_Mentorship_notes.docx`
- `C:\Users\bjpro\Downloads\ICT Short Term Trading Model.pdf`
- `C:\Users\bjpro\Downloads\ICT For Dummies E-Book.pdf`
- `C:\Users\bjpro\Downloads\ICT MMXM Model.pdf`

Reference summary used for implementation:

- A raw Fair Value Gap is a 3-candle imbalance.
- The ICT setup is not any random FVG.
- Bearish ICT FVG context requires buy-side liquidity to be taken, then a displacement lower, then a break/shift lower in market structure.
- Bullish ICT FVG context requires sell-side liquidity to be taken, then a displacement higher, then a break/shift higher in market structure.
- Premium/discount and session/time filters are useful context, but they remain optional in this phase.

### Current Detector Audit

- `src/ict/fvgDetector.ts` correctly detects raw 3-candle imbalances.
- The raw detector does not validate liquidity sweep, displacement, or market structure shift.
- `src/bot.ts` previously fed raw FVGs directly into ICT reaction/signal evaluation.
- This caused the bot to treat random 3-candle gaps as potential ICT trading FVGs.

### Files Created

- `src/ict/validatedFvgTypes.ts`
- `src/ict/validatedFvgDetector.ts`
- `src/ict/testValidatedFvgDetector.ts`

### Files Modified

- `src/bot.ts`
- `package.json`
- `docs/DEVLOG.md`

### What Changed

- Added a validated FVG layer that wraps raw FVGs with ICT validation metadata.
- Kept `detectFVGs()` unchanged for raw research/visualization.
- Added `detectValidatedFVGs()` and `validateFVGs()`.
- Added validation checks for:
  - 3-candle imbalance from the raw detector
  - Prior liquidity sweep
  - Directional displacement candle
  - Market structure shift
  - Optional premium/discount context
  - Optional session/time filter
- Updated the bot ICT signal path:
  - Before: `detectFVGs()` -> ICT reaction/signal path
  - After: `detectValidatedFVGs()` -> ICT reaction/signal path
- IFVGs in the bot signal path are now derived from validated FVGs, not random raw FVGs.
- Added npm script:
  - `npm.cmd run ict:validated-fvg-test`

### Validation Rules Implemented

Bearish validated FVG:

- Raw bearish 3-candle FVG exists.
- Candle 1 sweeps buy-side liquidity above prior highs.
- Candle 2 is bearish displacement.
- Candle 3 closes below prior structure low.
- Optional premium/session filters pass if enabled.

Bullish validated FVG:

- Raw bullish 3-candle FVG exists.
- Candle 1 sweeps sell-side liquidity below prior lows.
- Candle 2 is bullish displacement.
- Candle 3 closes above prior structure high.
- Optional discount/session filters pass if enabled.

### NEEDS_VERIFICATION

The uploaded notes specify displacement should be significant/energetic and that market structure should shift, but they do not define fixed numeric thresholds. The detector therefore keeps these values configurable:

- `displacementBodyToRangeMin`
- `displacementRangeMultiplier`
- `liquidityLookback`
- `marketStructureLookback`
- optional premium/discount settings
- optional session/time settings

These defaults are implementation thresholds for deterministic automation and should be researched/tuned before live use.

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:validated-fvg-test
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:validated-fvg-test` passed: `Validated FVG detector tests: 5/5 passed`.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 5/5 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 13/13 passed`.

### Output Examples

Validated FVG fixture output:

```text
Test: random 3-candle gap is rejected
Expected: {"foundRawFvg":true,"accepted":false,"validatedCount":0,"rejectionIncludes":"liquidity","liquiditySweep":"FAIL"}
Actual:   {"foundRawFvg":true,"accepted":false,"validatedCount":0,"direction":"BULLISH","rejectionReasons":["Bullish FVG did not sweep sell-side liquidity first"],"liquiditySweep":"FAIL","displacement":"PASS","marketStructureShift":"PASS"}
Result:   PASS

Test: bearish FVG after buy-side sweep is accepted
Expected: {"foundRawFvg":true,"accepted":true,"validatedCount":1,"liquiditySweep":"PASS","displacement":"PASS","marketStructureShift":"PASS"}
Actual:   {"foundRawFvg":true,"accepted":true,"validatedCount":1,"direction":"BEARISH","rejectionReasons":[],"liquiditySweep":"PASS","displacement":"PASS","marketStructureShift":"PASS"}
Result:   PASS

Test: bullish FVG after sell-side sweep is accepted
Expected: {"foundRawFvg":true,"accepted":true,"validatedCount":1,"liquiditySweep":"PASS","displacement":"PASS","marketStructureShift":"PASS"}
Actual:   {"foundRawFvg":true,"accepted":true,"validatedCount":1,"direction":"BULLISH","rejectionReasons":[],"liquiditySweep":"PASS","displacement":"PASS","marketStructureShift":"PASS"}
Result:   PASS

Validated FVG detector tests: 5/5 passed
```

### Errors Encountered

No build errors or test failures were encountered.

### Final Status

Phase 6H is complete. Raw FVG detection remains unchanged for research, replay, and visualization. The bot's ICT signal path now uses validated FVGs requiring liquidity sweep, displacement, and market structure shift before a raw FVG can become a tradable ICT FVG candidate. No wallet logic, exchange integration, or live order logic was added or changed.

## Phase 6I -- Add NASDAQ Market Data Source

### Objective

Allow the paper bot to run on NASDAQ-style instruments using public/read-only market data while keeping the existing Binance crypto source unchanged.

No ICT logic, FVG logic, IFVG logic, reaction logic, trade selection logic, exit logic, wallet logic, broker orders, exchange execution, or live order logic was changed.

### Files Created

- `src/marketData/publicProviderTypes.ts`
- `src/marketData/yahooNasdaqProvider.ts`
- `src/marketData/nasdaqPublicSource.ts`

### Files Modified

- `src/types.ts`
- `src/config.ts`
- `src/marketData/factory.ts`
- `src/index.ts`
- `.env.example`
- `docs/DEVLOG.md`

### What Changed

- Added `MARKET_DATA_SOURCE=NASDAQ_PUBLIC`.
- Added `MarketDataSourceName = 'SIMULATOR' | 'REAL_PUBLIC' | 'NASDAQ_PUBLIC'`.
- Added `PublicMarketDataProvider` abstraction so future NASDAQ/equity data APIs can be plugged in behind the same source.
- Added `YahooNasdaqProvider` as the first read-only public provider.
- Added explicit symbol mapping:
  - `QQQ` -> `QQQ`
  - `NDX` -> `^NDX`
  - `NQ` -> `NQ=F`
- Added `NasdaqPublicSource`, which implements the existing `IMarketDataSource` contract.
- `NasdaqPublicSource` returns a new candle only when a new complete 1-minute candle is available.
- The current forming 1-minute bar is skipped.
- Dashboard-facing `sourceName` is exactly `NASDAQ_PUBLIC`.
- `.env.example` now defaults to:
  - `MARKET_DATA_SOURCE=NASDAQ_PUBLIC`
  - `SYMBOL=QQQ`
- Startup now prints a read-only NASDAQ data message:
  - no broker
  - no wallet
  - no private key
  - no order execution path

### Commands Executed

```powershell
npm.cmd run build
node -e "process.env.MARKET_DATA_SOURCE='NASDAQ_PUBLIC'; process.env.SYMBOL='QQQ'; const { loadConfig } = require('./dist/config'); const { createMarketDataSource } = require('./dist/marketData/factory'); const config = loadConfig(); const source = createMarketDataSource(config); console.log('Market Data Source:', config.marketDataSource); console.log('Symbol:', config.symbol); console.log('Dashboard Data Source:', source.sourceName);"
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
```

### Verification

- `npm.cmd run build` passed.
- No-network wiring check passed:
  - `Market Data Source: NASDAQ_PUBLIC`
  - `Symbol: QQQ`
  - `Dashboard Data Source: NASDAQ_PUBLIC`
- Final post-change regression results:
  - `npm.cmd run build` passed.
  - `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
  - `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
  - `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
  - `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 5/5 passed`.
  - `npm.cmd run position:exit-test` passed: `Position exit manager tests: 13/13 passed`.

### Output Examples

NASDAQ wiring check:

```text
Market Data Source: NASDAQ_PUBLIC
Symbol: QQQ
Dashboard Data Source: NASDAQ_PUBLIC
```

Expected dashboard/header fields when configured:

```text
Data Source     NASDAQ_PUBLIC
Symbol          QQQ
```

### Errors Encountered

No build errors or test failures were encountered.

### Final Status

Phase 6I is complete. The paper bot can now be configured with `MARKET_DATA_SOURCE=NASDAQ_PUBLIC` and `SYMBOL=QQQ` for NASDAQ-style public market data. Binance `REAL_PUBLIC` remains unchanged. No trading, broker order, wallet, exchange execution, ICT, FVG, IFVG, reaction, trade selection, or exit logic was changed.

## Maintenance -- Journal Header Repair and Log Viewer

### Objective

Fix the stale `logs/trades.csv` header so newer ICT and entry-zone columns line up correctly, and create one browser-readable file for reviewing the bot logs.

### Root Cause

`logs/trades.csv` was created before later journal fields were added. New rows included ICT metadata and entry-zone metadata, but the old CSV header still ended at `signalDirection`.

### Files Created

- `src/reports/logViewer.ts`
- `logs/journal-viewer.html`

### Files Modified

- `src/journal/tradeJournal.ts`
- `package.json`
- `logs/trades.csv`
- `docs/DEVLOG.md`

### What Changed

- `TradeJournal` now repairs a stale `trades.csv` header on startup while preserving all existing rows.
- Added `npm.cmd run logs:view`.
- Added a generated HTML journal viewer at `logs/journal-viewer.html`.
- The viewer includes:
  - Summary cards
  - Active position state
  - Session stats
  - ICT signal audit totals
  - Completed trade table
  - Raw file sections for events, trades, completed trades, ICT signals, session stats, and position state

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run logs:view
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run logs:view` generated:
  - `C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\journal-viewer.html`
- `logs/trades.csv` now has the full current header:
  - `timestamp,symbol,marketDataSource,action,side,price,size,investedUsd,avgEntry,dcaCount,realizedPnlUsd,signalDirection,signalSource,ictSignal,ictConfidence,ictZoneId,ictZoneType,ictReason,entryZoneId,entryZoneType,entryZoneHigh,entryZoneLow,entryZoneMidpoint,entryZoneDirection,entryZoneRespected,disrespectCandleClose,zoneBoundaryViolated`

### Final Status

Journal header repair is complete. The current logs can be viewed in `logs/journal-viewer.html`, and future journal startup will keep the CSV header aligned with the current schema.

## Refinement -- Phase 6G Trade Lifecycle Rules

### Objective

Refine the ICT paper trade lifecycle so FVG/IFVG scalp trades treat the original entry zone as the trade idea, close quickly by default, and exit immediately when that original zone is disrespected by a candle body close.

No raw FVG detection logic, raw IFVG detection logic, reaction confidence logic, wallet logic, exchange integration, broker logic, or live order logic was changed.

### Files Created

None.

### Files Modified

- `src/positionExitTypes.ts`
- `src/positionExitManager.ts`
- `src/bot.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/sessionStats.ts`
- `src/config.ts`
- `.env`
- `.env.example`
- `src/reports/logViewer.ts`
- `src/testPositionExitManager.ts`
- `src/ict/testTradeSelectionEngine.ts`
- `logs/trades.csv`
- `logs/journal-viewer.html`
- `docs/DEVLOG.md`

### What Changed

- Unified FVG/IFVG disrespect exits under:
  - `ENTRY_ZONE_DISRESPECT_EXIT`
- Added a pure lifecycle exit evaluator:
  - `evaluatePositionLifecycleExit()`
- Lifecycle exit priority is now:
  - Entry zone disrespect
  - Quick profit exit
  - Take profit
  - Max loss
  - Time exit
  - DCA
- `evaluatePositionExit()` now checks quick profit before percentage take profit.
- Changed default max hold time:
  - Before: `30` minutes
  - After: `5` minutes
- Added exported config default:
  - `DEFAULT_MAX_POSITION_MINUTES = 5`
- Updated `.env` and `.env.example`:
  - `MAX_POSITION_MINUTES=5`
- Preserved original entry-zone metadata on positions:
  - `entryZoneId`
  - `entryZoneType`
  - `entryZoneDirection`
  - `entryZoneHigh`
  - `entryZoneLow`
  - `entryZoneMidpoint`
  - `entryZoneRespected`
- Close logging now includes:
  - close reason
  - entry zone id
  - entry zone type
  - violated boundary
  - disrespect candle close
  - realized PnL
  - `tradeDurationMinutes`
- Dashboard now shows:
  - active entry zone type
  - entry zone high
  - entry zone low
  - zone respected `YES/NO`
  - position age
  - max hold minutes
  - last close reason
- `logs/trades.csv` header now includes:
  - `tradeDurationMinutes`
- `logs/journal-viewer.html` was regenerated.

### Trade Selection Rule

The existing trade selection engine already selected the highest score candidate and used confidence as the tie-breaker. This was verified and strengthened with a new deterministic test:

- `tie uses highest confidence`

### Tests Added Or Updated

- Highest-score candidate selected.
- Tie uses highest confidence.
- SHORT closes when candle body closes above bearish entry zone high.
- SHORT does not close on wick above only.
- LONG closes when candle body closes below bullish entry zone low.
- LONG does not close on wick below only.
- Opposite signal alone does not close.
- Max hold default is 5 minutes.
- Exit priority chooses zone disrespect before time exit.
- Completed disrespect trade writes `ENTRY_ZONE_DISRESPECT_EXIT`, boundary, candle close, entry zone metadata, and duration.

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run position:exit-test
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run ict:paper-sim
npm.cmd run logs:view
```

### Verification

Final required verification passed:

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 6/6 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 15/15 passed`.
- `npm.cmd run ict:paper-sim` passed: `ICT paper integration dry-run tests: 3/3 passed`.
- `npm.cmd run logs:view` regenerated:
  - `C:\Users\bjpro\OneDrive\Desktop\nado-trading-bot\logs\journal-viewer.html`

### Output Examples

Trade selection fixture:

```text
Test: tie uses highest confidence
Expected: {"action":"BUY","selectedZoneId":"higher-confidence-fvg","expectedProfitAtTPUsd":0.6,"targetFit":"PREFERRED_RANGE"}
Actual:   {"action":"BUY","selectedZoneId":"higher-confidence-fvg","expectedProfitAtTPUsd":0.6,"targetFit":"PREFERRED_RANGE"}
Result:   PASS

ICT trade selection fixture tests: 6/6 passed
```

Position lifecycle fixture:

```text
Test: SHORT closes when candle body closes above bearish entry zone high
Expected: ENTRY_ZONE_DISRESPECT_EXIT
Actual:   ENTRY_ZONE_DISRESPECT_EXIT
Result:   PASS

Test: max hold default is 5 minutes
Expected: 5
Actual:   5
Result:   PASS

Test: exit priority chooses zone disrespect before time exit
Expected: ENTRY_ZONE_DISRESPECT_EXIT
Actual:   ENTRY_ZONE_DISRESPECT_EXIT
Result:   PASS

Position exit manager tests: 15/15 passed
```

### Errors Encountered

- The first version of the priority fixture failed because the normal exit branch hit `RISK_EXIT` before `TIME_EXIT`.
- The lifecycle result still selected `ENTRY_ZONE_DISRESPECT_EXIT`; the fixture was corrected so the competing lower-priority close was specifically `TIME_EXIT`.
- After the fixture correction, `position:exit-test` passed `15/15`.

### Final Status

Lifecycle refinement is complete. The bot now prioritizes original entry-zone disrespect, uses a 5-minute default max hold, logs trade duration on closes, keeps selecting the best candidate by score with confidence tie-breaks, and preserves all requested paper-only safety boundaries.

## Phase 7A

### Objective

Build a strict safety-gated real trading execution layer without connecting to a real exchange yet. The phase adds live mode configuration, exchange adapter interfaces, a stub adapter, a live execution manager, live order journaling, dashboard visibility, and deterministic tests. No ICT, FVG, IFVG, reaction, trade selection, paper exit, wallet, or exchange execution logic was changed.

### Files Created

- `src/execution/exchangeTypes.ts`
- `src/execution/exchangeAdapter.ts`
- `src/execution/liveOrderJournal.ts`
- `src/execution/liveExecutionManager.ts`
- `src/execution/testLiveExecutionManager.ts`
- `logs/live-orders.csv`
- `logs/live-orders.json`

### Files Modified

- `src/types.ts`
- `src/config.ts`
- `src/sessionStats.ts`
- `src/index.ts`
- `package.json`
- `.env.example`
- `.env`
- `docs/DEVLOG.md`

### Safety Gates Added

Before a live order can be submitted through `LiveExecutionManager`, all configured gates must pass:

- `BOT_MODE` must equal `live`.
- `LIVE_TRADING_ENABLED` must equal `true`.
- If `REQUIRE_MANUAL_ARM=true`, `LIVE_ARM_CONFIRM` must equal `I_UNDERSTAND_REAL_MONEY_RISK`.
- API key and API secret must exist.
- Requested order size must be less than or equal to `MAX_LIVE_ORDER_SIZE_USD`.
- Daily live PnL must not breach `MAX_DAILY_LOSS_USD`.
- Daily live trades must be below `MAX_DAILY_TRADES`.
- A duplicate open live position is rejected.
- Short opens are rejected when `ALLOW_SHORTS=false`.
- Open orders must confirm exit logic exists for the position.
- Position side checks are enforced.
- Withdrawals are not implemented or exposed anywhere.

### Commands Executed

```powershell
New-Item -ItemType Directory -Force src\execution
npm.cmd run build
npm.cmd run live:execution-test
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run ict:paper-sim
npm.cmd run build
npm.cmd run live:execution-test
```

### Verification

Final verification passed:

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 6/6 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 15/15 passed`.
- `npm.cmd run ict:paper-sim` passed: `ICT paper integration dry-run tests: 3/3 passed`.
- `npm.cmd run live:execution-test` passed: `Live execution manager tests: 8/8 passed`.

### Output Examples

Live execution test:

```text
Test: live order rejected when BOT_MODE != live
Expected: BOT_MODE_NOT_LIVE
Actual:   BOT_MODE_NOT_LIVE
Result:   PASS

Test: live order accepted when all gates pass using stub adapter
Expected: FILLED
Actual:   FILLED
Result:   PASS

Test: close order accepted when exit signal fires
Expected: FILLED
Actual:   FILLED
Result:   PASS

Live execution manager tests: 8/8 passed
```

Live order journal sample:

```text
timestamp,symbol,side,action,orderType,requestedSizeUsd,executedSizeUsd,requestedPrice,executedPrice,status,exchangeOrderId,reason,safetyGateResult
2026-06-02T14:34:53.630Z,BTC,BUY,OPEN,MARKET,10.00,10.00,65000.00000000,65000.00000000,FILLED,"STUB-1","TEST_BUY_SIGNAL","PASSED"
```

### Errors Encountered

- Initial `git status --short` failed because this working folder is not currently recognized as a Git repository by the local shell.
- The first live execution test wrote to `logs/live-execution-test`. It was adjusted to write to the required `logs/live-orders.csv` and `logs/live-orders.json` paths while preserving existing live order logs.

### Final Status

Phase 7A is complete as a safety-gated execution layer with stubbed order flow only. Real orders still cannot occur unless `BOT_MODE=live`, `LIVE_TRADING_ENABLED=true`, manual arm confirmation is present when required, credentials are configured, and all live execution safety gates pass through `LiveExecutionManager`.

## Phase 7B

### Objective

Create a TradingView visual overlay so the bot's current ICT analysis can be inspected on a chart. The overlay is visual-only and does not place trades, connect to brokers, read wallets, read API keys, or modify bot execution logic.

### Files Created

- `tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine`
- `docs/TRADINGVIEW_ICT_OVERLAY.md`

### Files Modified

- `docs/DEVLOG.md`

### What Was Built

- Pine Script v6 indicator overlay.
- Validated FVG visualization using:
  - 3-candle imbalance
  - prior liquidity sweep
  - displacement candle
  - market structure shift
  - optional premium/discount filter
  - optional UTC session filter
- IFVG visualization when a source FVG is invalidated and flipped.
- Zone midpoint lines.
- BUY/SELL selected candidate markers.
- Latest analysis table showing:
  - signal
  - zone type
  - confidence
  - score
  - expected TP profit
  - zone count
  - reason

### Important Limitation

TradingView Pine Script cannot read local bot log files such as `logs/ict-signals.json`, `logs/detected-fvgs.json`, or `logs/trades.csv`. The overlay recreates the bot's current ICT analysis rules inside TradingView rather than importing local runtime logs.

### Commands Executed

```powershell
npm.cmd run build
```

### Verification

- `npm.cmd run build` passed.
- Pine Script syntax must be verified inside TradingView Pine Editor because the local TypeScript build does not compile Pine scripts.

### Errors Encountered

- No TypeScript build errors.
- No TradingView compile result is available locally.

### Final Status

Phase 7B is complete as a TradingView Pine overlay and usage guide. The overlay is ready to paste into TradingView's Pine Editor for chart-side visual validation.

## Phase 7B - Adaptive Position Sizing Engine

### Objective

Replace fixed-dollar ICT entry sizing with a separate adaptive position sizing engine. The signal engine still decides BUY/SELL. The sizing engine decides whether the selected trade has acceptable risk/reward and how large the paper position should be.

### Files Created

- `src/risk/positionSizing.ts`
- `src/risk/positionSizingTypes.ts`
- `src/risk/testPositionSizing.ts`

### Files Modified

- `.env`
- `.env.example`
- `package.json`
- `src/bot.ts`
- `src/config.ts`
- `src/types.ts`
- `src/state.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/execution/testLiveExecutionManager.ts`
- `src/testPositionExitManager.ts`
- `docs/DEVLOG.md`

### What Was Built

- Pure adaptive position sizing module.
- Sizing config loaded from environment:
  - `TARGET_PROFIT_MIN_USD=0.50`
  - `TARGET_PROFIT_MAX_USD=1.00`
  - `MAX_RISK_PER_TRADE_USD=1.00`
  - `MIN_POSITION_USD=25`
  - `MAX_POSITION_USD=500`
- ICT entry sizing now uses selected direction, confidence, selection score, entry price, managed target price, and entry-zone stop boundary.
- Trades are rejected when risk/reward is below `1.5`.
- Accepted position size is capped so expected loss does not exceed max risk per trade.
- Confidence and selection score adjust size without overriding max position or max risk.
- Dashboard now shows target profit range, expected profit, expected loss, position size, risk/reward, and sizing averages.
- Journal now records position size, expected profit, expected loss, risk/reward ratio, confidence, and selection score.
- Session analytics now track average position size, average expected profit, average expected loss, and small/medium/large size distribution.

### Position Sizing Formula

```text
rewardDistance = abs(targetPrice - entryPrice)
riskDistance = abs(entryPrice - stopPrice)
expectedMovePercent = (rewardDistance / entryPrice) * 100
riskRewardRatio = rewardDistance / riskDistance

baseTargetProfitUsd = (TARGET_PROFIT_MIN_USD + TARGET_PROFIT_MAX_USD) / 2
rewardPct = rewardDistance / entryPrice
riskPct = riskDistance / entryPrice

rawSizeUsd = (baseTargetProfitUsd / rewardPct)
  * confidenceMultiplier
  * scoreMultiplier

riskCappedSizeUsd = min(rawSizeUsd, MAX_RISK_PER_TRADE_USD / riskPct)
recommendedPositionSizeUsd = clamp(riskCappedSizeUsd, MIN_POSITION_USD, MAX_POSITION_USD)

expectedProfitUsd = recommendedPositionSizeUsd * rewardPct
expectedLossUsd = recommendedPositionSizeUsd * riskPct
```

Confidence multiplier:

```text
confidence >= 95: 1.15
confidence >= 85: 1.00
confidence < 80:  0.75
otherwise:        0.90
```

Selection score multiplier:

```text
score >= 90: 1.10
score >= 80: 1.00
score < 70:  0.85
otherwise:   0.95
```

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run position:sizing-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 7/7 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 17/17 passed`.
- `npm.cmd run position:sizing-test` passed: `Position sizing tests: 7/7 passed`.

### Errors Encountered

- Initial sizing fixtures for risk cap and min size used scenarios that violated the hard RR/min-risk constraints. The fixtures were corrected without weakening the sizing engine.

### Final Status

Adaptive position sizing is implemented for ICT paper entries. FVG logic, IFVG logic, reaction logic, signal conversion, exchange integration, and wallet logic were not modified.

## Phase 7A.6 - Score Attribution & Predictive Analytics Engine

### Objective

Make every selected ICT candidate explainable by storing a complete score breakdown at entry time, preserving that attribution through completed trades, and generating factor-level outcome analytics.

### Files Created

- `src/analytics/scoreAttribution.ts`
- `src/analytics/scoreAttributionTypes.ts`
- `src/analytics/tradeOutcomeAnalytics.ts`
- `src/analytics/testScoreAttribution.ts`
- `logs/score-attribution-report.json`
- `logs/score-attribution-report.html`

### Files Modified

- `package.json`
- `src/bot.ts`
- `src/types.ts`
- `src/state.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/testPositionExitManager.ts`
- `docs/DEVLOG.md`

### What Was Built

- Score attribution module for selected ICT trade candidates.
- Full stored score breakdown:
  - `liquiditySweepScore`
  - `displacementScore`
  - `mssScore`
  - `fvgQualityScore`
  - `ifvgBonus`
  - `targetFitScore`
  - `reactionScore`
  - `premiumDiscountScore`
  - `sessionScore`
  - `confidenceScore`
- Attribution is attached to each BOT ENTRY position state.
- Journal writes `scoreBreakdown` and `scoreFinal` for BOT ENTRY and close events.
- Completed trade records persist the same score attribution plus win/loss, realized PnL, duration, and exit reason.
- Outcome analytics aggregate win rate and average PnL by factor.
- Predictive ranking surfaces top performing factors by win rate and average PnL.
- Dashboard now shows score component rows instead of only `score=...`, plus a `Top Factors` line from the latest generated report.

### Score Attribution Formula

Raw explanatory components are derived from the selected candidate:

```text
liquiditySweepScore = 30 when selected validated zone implies sweep passed
displacementScore   = 20 when selected validated zone implies displacement passed
mssScore            = 20 when selected validated zone implies MSS passed
fvgQualityScore     = 10
ifvgBonus           = 4 for IFVG, 0 for FVG
targetFitScore      = 25 preferred range, 15 extended target, 0 below minimum
reactionScore       = 12 confirmed reaction, otherwise partial reaction checks
premiumDiscount     = 0 unless attribution is extended with an active PD filter
sessionScore        = 0 unless attribution is extended with an active session filter
confidenceScore     = confidence * 0.45
```

Because the trade-selection engine already owns the authoritative candidate score, attribution normalizes the raw explanatory components so their stored sum equals the selected candidate final score:

```text
rawTotal = sum(rawComponents)
normalizedMultiplier = finalScore / rawTotal
componentScore = rawComponent * normalizedMultiplier
confidenceScore absorbs rounding difference
```

### Analytics Generated

- Liquidity Sweep: wins, losses, win rate, average PnL
- Displacement: wins, losses, win rate, average PnL
- MSS: wins, losses, win rate, average PnL
- FVG: wins, losses, win rate, average PnL
- IFVG: wins, losses, win rate, average PnL
- Premium/Discount: wins, losses, win rate, average PnL
- Session: wins, losses, win rate, average PnL
- Target Fit, Reaction, and Confidence are also included in the factor report.

Reports generated:

- `logs/score-attribution-report.json`
- `logs/score-attribution-report.html`

The generated live report currently has `0` attributed trades because existing completed trades were created before this attribution phase. New completed trades will populate the report automatically.

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run ict:trade-selection-test
npm.cmd run position:exit-test
npm.cmd run analytics:test
npx.cmd ts-node src/analytics/tradeOutcomeAnalytics.ts
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 8/8 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 7/7 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 17/17 passed`.
- `npm.cmd run analytics:test` passed: `Score attribution tests: 5/5 passed`.

### Errors Encountered

- Initial analytics test fixture used a `Date` for `createdAt`, but ICT zones use ISO strings. The fixture was corrected.
- Existing position test fixtures required the new `scoreAttribution: null` field.

### Final Status

Phase 7A.6 is complete. Score attribution is stored, journaled, linked to completed trade outcomes, and reportable without modifying FVG detection, IFVG detection, MSS logic, liquidity sweep logic, displacement logic, reaction engine, signal engine, position sizing logic, exchange integration, or wallet logic.

---

## Phase 4 - Better Candidate Selection: targetReachProbability Handoff Hardening

### Objective

Validate and complete the Phase 4 `targetReachProbability` handoff without re-auditing unrelated systems.

### Scope

Focused only on:

- `targetReachProbability`
- better trade ranking
- probability buckets in analytics
- new attribution and journal fields

Explicitly not changed:

- reaction logic
- target mode logic
- FVG/IFVG detection
- live trading
- Pine UI

### Existing Implementation Confirmed

The current codebase already had the core Phase 4 engine in place:

- `TradeCandidate.targetReachProbability` exists.
- Candidate ranking already prioritizes `targetReachProbability` before legacy score and confidence.
- Target reach probability already includes reaction tier, displacement score, RR fit, scalp target fit, zone freshness, and target distance penalty.
- The bot already passes per-zone target selection and stop context into candidate selection.
- Outcome analytics already include probability bucket reporting.

### Changes Made

- Added deterministic trade-selection coverage proving a higher `targetReachProbability` candidate beats a higher legacy-score candidate.
- Expanded score-attribution tests so probability fields are required in selected-candidate attribution.
- Expanded attribution pipeline tests so probability fields remain linked through completed trade outcomes.
- Added analytics coverage for generated target reach probability buckets.
- Added `targetReachProbability` and optional `reactionTier` columns to journal CSV output.
- Added `targetReachProbability` and optional `reactionTier` to journal event display.

### Files Modified

- `src/ict/testTradeSelectionEngine.ts`
- `src/analytics/testScoreAttribution.ts`
- `src/analytics/testAttributionPipeline.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `docs/DEVLOG.md`

### Ranking Behavior

Candidate ranking now has test coverage for this priority order:

```text
targetReachProbability
displacementScore
rrFitScore
reactionTierScore
legacy candidate score
confidence
```

This keeps trade direction separate from trade quality. The signal engine can still decide BUY/SELL, while selection prefers the candidate with the best probability of reaching its selected target.

### Probability Bucket Analytics

Analytics coverage now verifies `targetReachProbability` bucket generation. The expected bucket ranges are:

```text
85-100
70-84
55-69
40-54
0-39
unknown
```

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run ict:trade-selection-test
npm.cmd run analytics:test
npm.cmd run analytics:pipeline-test
npm.cmd run ict:test
npm.cmd run ict:reaction-test
npm.cmd run ict:signal-test
npm.cmd run position:exit-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 8/8 passed`.
- `npm.cmd run analytics:test` passed: `Score attribution tests: 6/6 passed`.
- `npm.cmd run analytics:pipeline-test` passed: `Attribution pipeline tests: 5/5 passed`.
- `npm.cmd run ict:test` passed: `ICT FVG/IFVG fixture tests: 7/7 passed`.
- `npm.cmd run ict:reaction-test` passed: `ICT reaction fixture tests: 11/11 passed`.
- `npm.cmd run ict:signal-test` passed: `ICT signal fixture tests: 5/5 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 17/17 passed`.

### Final Status

Phase 4 target reach probability selection is confirmed and hardened. The implementation now has focused tests for probability-first ranking, required attribution fields, completed-trade analytics linkage, and probability bucket generation without modifying protected trading logic or Pine UI.

---

## Phase 5 - Pine UI / Bot Mirror Upgrade

### Objective

Upgrade the TradingView Pine overlay so the chart explains the bot-style decision process visually:

- what candidate was selected
- what reaction tier triggered
- what target mode was used
- what target, stop, RR, probability, expected profit/loss, size, score, and confidence were seen
- why a candidate was skipped

This phase is UI and explainability only.

### Scope Guardrails

Not changed:

- TypeScript FVG detection
- TypeScript IFVG detection
- TypeScript reaction logic
- TypeScript target logic
- TypeScript `targetReachProbability`
- TypeScript position sizing formula
- live trading
- exchange integrations

### Pine UI Changes

- Added `UI_MODE` input with `MINIMAL`, `NORMAL`, and `DEBUG`.
- Added display/performance toggles:
  - `SHOW_RAW_ZONES`
  - `SHOW_REJECTED_ZONES`
  - `SHOW_SKIPS`
  - `SHOW_SELECTED`
  - `SHOW_SCORE_BREAKDOWN`
  - `SHOW_ENTRY_HIGHLIGHT`
- Added target mode input with `STRUCTURE`, `SCALP`, and `HYBRID`.
- Added Pine-side bot mirror fields for:
  - `targetReachProbability`
  - reaction tier
  - reaction winner
  - reaction score
  - selected target
  - target mode/source
  - RR
  - expected profit/loss
  - position size
  - skip reason
  - candidate ranking text

### Bot Mirror Selection

The Pine overlay now ranks visual candidates in the same priority order used by the bot selector:

```text
targetReachProbability
displacementScore
rrFitScore
reactionTierScore
legacy candidate score
confidence
```

### Labels Added

- Large `BUY BOT ENTRY` / `SELL BOT ENTRY` label for accepted entries only.
- Blue `SELECTED` label for selected candidates before entry handling.
- Gray `ENTRY SKIP` label for selected candidates that fail target/stop/sizing validation.
- Reaction tier labels for `TOUCH`, `MIDPOINT`, `BOUNDARY`, and `DISPLACEMENT`.
- Optional DEBUG score breakdown and candidate ranking label.

### Target Visualization

The overlay now draws and labels:

- entry
- target
- stop
- RR
- expected profit
- expected loss
- target mode

Target mode line colors:

- `STRUCTURE`: fuchsia
- `SCALP`: orange
- `HYBRID`: lime

### Dashboard Changes

The TradingView table now shows:

- UI mode
- current candidate
- probability
- reaction tier/winner
- target mode
- selected target
- RR
- current position
- entry
- TP/SL
- position age
- latest entry time
- latest entry probability/reaction tier
- latest skip reason
- position size
- expected profit/loss
- reason/debug state

### Files Modified

- `tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
npm.cmd run build
```

### Verification

- `npm.cmd run build` passed.
- No local Pine compiler or Pine test script exists in this repository.
- Pine syntax still must be pasted into TradingView Pine Editor for final compile validation.

### Final Status

Phase 5 Pine UI / Bot Mirror Upgrade is implemented in the overlay without modifying bot execution logic, live trading, exchange integrations, or TypeScript detection/reaction/target/position sizing engines.

---

## Phase 5B - Risk-First Position Sizing and Hard Stop Enforcement

### Objective

Make position sizing risk-first so accepted trades are sized around risking `MAX_RISK_PER_TRADE_USD` and targeting `TARGET_R_MULTIPLE`, with the sizing stop enforced as a real lifecycle exit.

### Scope Guardrails

Not changed:

- FVG detection
- IFVG detection
- reaction logic
- `targetReachProbability` logic
- Pine UI
- live trading / exchange logic

### Sizing Logic Change

Added `POSITION_SIZING_MODE` with support for:

```text
PROFIT_FIRST
RISK_FIRST
```

In `RISK_FIRST` mode:

```text
riskDistance = abs(entryPrice - stopPrice)
riskPct = riskDistance / entryPrice
positionSizeUsd = MAX_RISK_PER_TRADE_USD / riskPct
positionSizeUsd = clamp(positionSizeUsd, MIN_POSITION_USD, MAX_POSITION_USD)
expectedLossUsd = positionSizeUsd * riskPct
expectedProfitUsd = expectedLossUsd * TARGET_R_MULTIPLE
BUY target = entryPrice + riskDistance * TARGET_R_MULTIPLE
SELL target = entryPrice - riskDistance * TARGET_R_MULTIPLE
riskRewardRatio = TARGET_R_MULTIPLE
riskUtilizationPercent = expectedLossUsd / MAX_RISK_PER_TRADE_USD * 100
```

Acceptance rules:

- reject if `expectedLossUsd > MAX_RISK_PER_TRADE_USD`
- reject if `expectedProfitUsd < TARGET_PROFIT_MIN_USD`
- reject if `expectedProfitUsd > TARGET_PROFIT_MAX_USD`
- reject if `riskRewardRatio < MIN_RISK_REWARD_RATIO`
- allow under-utilized risk after max-position clamp only when the resulting expected profit still passes the configured target range
- mark `riskUtilizationWarning=true` when `riskUtilizationPercent < 50`

### Hard Stop Logic

Added `HARD_STOP_ENABLED`.

The sizing stop is stored on each opened position as `hardStopPrice` and evaluated before zone disrespect, quick profit, and time exit.

```text
LONG:  close <= hardStopPrice -> HARD_STOP_EXIT
SHORT: close >= hardStopPrice -> HARD_STOP_EXIT
```

### Dashboard / Session Stats

Dashboard now shows:

- sizing mode
- target R multiple
- expected profit
- expected loss
- risk utilization percent
- hard stop price
- resolved target price

Open-position dashboard now also shows:

- sizing mode
- risk utilization percent
- hard stop price
- target R multiple

### Journal

Trade events and completed trades now log:

- `sizingMode`
- `hardStopPrice`
- `expectedLossUsd`
- `expectedProfitUsd`
- `riskUtilizationPercent`
- `targetRMultiple`
- `positionSizeUsd`

### Config Added / Updated

Active `.env` updated to:

```text
POSITION_SIZING_MODE=RISK_FIRST
TARGET_R_MULTIPLE=1.5
TARGET_PROFIT_MIN_USD=1.00
TARGET_PROFIT_MAX_USD=1.50
MAX_RISK_PER_TRADE_USD=1.00
MIN_POSITION_USD=25
MAX_POSITION_USD=500
HARD_STOP_ENABLED=true
```

`.env.example` was updated with the same risk-first sizing and hard-stop defaults.

### Files Modified

- `src/risk/positionSizing.ts`
- `src/risk/positionSizingTypes.ts`
- `src/risk/testPositionSizing.ts`
- `src/positionExitManager.ts`
- `src/positionExitTypes.ts`
- `src/testPositionExitManager.ts`
- `src/types.ts`
- `src/config.ts`
- `src/state.ts`
- `src/bot.ts`
- `src/sessionStats.ts`
- `src/journal/types.ts`
- `src/journal/tradeJournal.ts`
- `src/execution/testLiveExecutionManager.ts`
- `.env`
- `.env.example`
- `docs/DEVLOG.md`

### Tests Added

- Risk-first sizing targets about `$1` expected loss when unclamped.
- `1.5R` target produces about `$1.50` expected profit.
- Trade rejected when max-position clamp prevents the configured profit target.
- Trade rejected when min-position clamp would exceed max risk.
- Risk-utilization warning when max-position clamp leaves risk usage below `50%`.
- LONG hard stop exits on `close <= stopPrice`.
- SHORT hard stop exits on `close >= stopPrice`.
- Hard stop is evaluated before zone disrespect and time exit.
- Completed trade logs `hardStopPrice` and `sizingMode`.

### Commands Executed

```powershell
npm.cmd run build
npm.cmd run position:sizing-test
npm.cmd run position:exit-test
npm.cmd run risk:target-modes-test
npm.cmd run ict:trade-selection-test
npm.cmd run analytics:pipeline-test
```

### Verification

- `npm.cmd run build` passed.
- `npm.cmd run position:sizing-test` passed: `Position sizing tests: 12/12 passed`.
- `npm.cmd run position:exit-test` passed: `Position exit manager tests: 21/21 passed`.
- `npm.cmd run risk:target-modes-test` passed: `Target mode tests: 8/8 passed`.
- `npm.cmd run ict:trade-selection-test` passed: `ICT trade selection fixture tests: 8/8 passed`.
- `npm.cmd run analytics:pipeline-test` passed: `Attribution pipeline tests: 5/5 passed`.

### Final Status

Phase 5B is complete. The bot can now use risk-first sizing with a real hard stop lifecycle exit, while preserving the protected ICT detection, reaction, target reach probability, Pine UI, and live exchange execution boundaries.

---

## Pine Overlay Sync - Reaction, Target Modes, Risk-First Sizing

### Objective

Update the TradingView Pine overlay to visually mirror the current bot behavior after:

- Phase 2 reaction rewrite
- Phase 3 exit target modes
- Phase 4 `targetReachProbability`
- Phase 5B risk-first position sizing and hard stop enforcement

This update is Pine UI and mirror logic only.

### Scope Guardrails

Not changed:

- TypeScript bot logic
- FVG detection
- IFVG detection
- reaction engine
- `targetReachProbability` implementation
- live trading / exchange logic
- alerts, broker execution, strategy orders, webhooks

### Inputs Added / Updated

- `POSITION_SIZING_MODE`: `RISK_FIRST` / `PROFIT_FIRST`
- `EXIT_TARGET_MODE`: `STRUCTURE` / `SCALP` / `HYBRID`
- `TARGET_R_MULTIPLE`
- `TARGET_PROFIT_MIN_USD`
- `TARGET_PROFIT_MAX_USD`
- `MAX_RISK_PER_TRADE_USD`
- `HARD_STOP_ENABLED`
- `UI_MODE`: `MINIMAL` / `NORMAL` / `DEBUG`

Defaults now mirror the Phase 5B bot configuration:

```text
POSITION_SIZING_MODE=RISK_FIRST
TARGET_R_MULTIPLE=1.5
TARGET_PROFIT_MIN_USD=1.00
TARGET_PROFIT_MAX_USD=1.50
MAX_RISK_PER_TRADE_USD=1.00
HARD_STOP_ENABLED=true
UI_MODE=NORMAL
```

### Reaction Parity

The Pine overlay now uses the Phase 2 reaction tier vocabulary:

```text
NONE = 0
TOUCH = 20
MIDPOINT = 45
BOUNDARY = 75
DISPLACEMENT = 100
```

Zone-aware reaction behavior:

- Bullish zone close above high = BUY
- Bullish zone displacement above high = strong BUY
- Bullish zone close below midpoint = SELL bias / bullish failure
- Bearish zone close below low = SELL
- Bearish zone displacement below low = strong SELL
- Bearish zone close above midpoint = BUY bias / bearish failure

### Target Mode Parity

The Pine overlay now mirrors target modes:

- `SCALP`: `entry +/- riskDistance * TARGET_R_MULTIPLE`
- `STRUCTURE`: opposing FVG/IFVG or swing fallback
- `HYBRID`: closer valid structure target when it satisfies minimum RR, otherwise scalp target

### Risk-First Sizing Parity

In `RISK_FIRST` mode, Pine uses:

```text
riskPct = abs(entry - stop) / entry
positionSizeUsd = MAX_RISK_PER_TRADE_USD / riskPct
positionSizeUsd = clamp(positionSizeUsd, MIN_POSITION_USD, MAX_POSITION_USD)
expectedLossUsd = positionSizeUsd * riskPct
expectedProfitUsd = expectedLossUsd * TARGET_R_MULTIPLE
```

The hard stop is the same structural stop used for sizing:

- BUY hard stop = selected zone low
- SELL hard stop = selected zone high

The hard stop line is drawn as the SL line and emphasized when `HARD_STOP_ENABLED=true`.

### UI Modes

`MINIMAL`:

- BUY/SELL arrow for actual accepted entries only
- short probability/RR/P-L entry label
- TP line
- SL/hard stop line

`NORMAL`:

- BUY/SELL entry marker
- probability
- reaction tier
- target mode
- RR
- expected profit/loss
- compact dashboard

`DEBUG`:

- `targetReachProbability`
- `displacementScore`
- `reactionTierScore`
- `rrFitScore`
- `zoneFreshnessScore`
- score breakdown
- skip reason
- candidate ranking

### UI Simplification

- Removed giant BOT ENTRY text blocks.
- Entry label is now compact:

```text
BUY
92%
RR 1.5
+$1.50 / -$1.00
```

- Dashboard reduced to:
  - Signal
  - Probability
  - Reaction tier
  - Target mode
  - Entry
  - TP
  - SL
  - Expected P/L
  - RR
  - Position size

- Reaction labels are limited to DEBUG mode with score breakdown enabled.
- Selected-candidate labels are optional and off by default.
- Skip labels are gray and only show when `SHOW_SKIPS=true`.

### Files Modified

- `tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine`
- `docs/DEVLOG.md`

### Commands Executed

```powershell
npm.cmd run build
```

### Verification

- `npm.cmd run build` passed.
- No local Pine compiler or Pine test runner exists in this repository.
- Pine must still be pasted into TradingView Pine Editor for final compile validation.

Manual TradingView verification steps:

1. Open TradingView on the same symbol/timeframe printed by the bot dashboard.
2. Paste `tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine` into Pine Editor.
3. Confirm the script compiles.
4. Set `UI_MODE=NORMAL`.
5. Confirm accepted entries show only compact BUY/SELL labels.
6. Confirm TP and SL/hard-stop lines draw for actual accepted entries.
7. Switch to `UI_MODE=DEBUG` and enable `SHOW_SCORE_BREAKDOWN`.
8. Confirm probability components and skip reasons only appear in DEBUG.

### Final Status

The Pine overlay is synced to the current bot behavior for reaction tiers, target modes, target reach probability display, risk-first sizing mirror, and hard stop visualization without modifying TypeScript bot execution logic.
