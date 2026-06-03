# ICT Inversion Fair Value Gap (IFVG) Rulebook

Purpose: formalize ICT Inversion Fair Value Gap concepts for later detector implementation. This document is not a complete trading strategy.

## A. Research Summary

Primary ICT source references used:

- The Inner Circle Trader, "ICT 2024 Mentorship \ How To Trade ICT FVGs Correctly \ September 16, 2024", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/HhgWGduQZQY
- The Inner Circle Trader, "What Are Fair Value Gaps in Trading and How to Use Them?", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/GFdWahZUNOw
- The Inner Circle Trader, "ICT Opening Range Theory \ 1st Presented FVG Logic", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/Zm9Q0NDRxoY

Notes:

- IFVG depends on an existing FVG.
- The strict concept is a failed FVG whose role inverts after price violates it.
- A bearish FVG can become a bullish IFVG.
- A bullish FVG can become a bearish IFVG.
- Exact confirmation language varies in public summaries. This rulebook uses body-close-through as the strict default and marks the ambiguity for verification.

## B. Definition

An ICT Inversion Fair Value Gap is a previously identified FVG that fails to hold its original role and then inverts into the opposite role.

Role inversion:

- A bearish FVG that is violated upward becomes a bullish IFVG and may act as support on retest.
- A bullish FVG that is violated downward becomes a bearish IFVG and may act as resistance on retest.

ICT uses IFVGs to identify a change in price delivery state. The original imbalance is not treated as a normal FVG after violation; it becomes an inverted PD Array that can be used for continuation or reversal context.

## C. Formation Rules

### Bullish IFVG Formation

Strict logical rule:

```text
IF existingFVG.direction == BEARISH
AND candle.close > existingFVG.high
THEN bullish IFVG detected
```

Zone boundaries:

```text
bullishIFVG.low = existingFVG.low
bullishIFVG.high = existingFVG.high
bullishIFVG.CE = existingFVG.CE
```

Interpretation:

- The bearish FVG failed as resistance.
- The same zone is retained.
- The zone's role inverts to bullish support.

### Bearish IFVG Formation

Strict logical rule:

```text
IF existingFVG.direction == BULLISH
AND candle.close < existingFVG.low
THEN bearish IFVG detected
```

Zone boundaries:

```text
bearishIFVG.low = existingFVG.low
bearishIFVG.high = existingFVG.high
bearishIFVG.CE = existingFVG.CE
```

Interpretation:

- The bullish FVG failed as support.
- The same zone is retained.
- The zone's role inverts to bearish resistance.

Implementation status:

- `NEEDS_VERIFICATION`: whether violation must be candle close beyond the FVG boundary, full candle body through the entire FVG, or wick-through. For detector safety, use close beyond the far boundary until confirmed.

## D. Validation Rules

Strict detector validation:

```text
IF original FVG exists
AND original FVG has not already been invalidated by a later rule
AND price closes beyond the far boundary opposite the original FVG role
THEN IFVG is structurally valid
```

Bullish trade validation:

```text
IF bullish IFVG exists
AND trade bias is bullish
AND price returns down into the IFVG
AND the IFVG holds as support
AND lower-timeframe confirmation occurs
THEN bullish IFVG may be considered tradable
```

Bearish trade validation:

```text
IF bearish IFVG exists
AND trade bias is bearish
AND price returns up into the IFVG
AND the IFVG holds as resistance
AND lower-timeframe confirmation occurs
THEN bearish IFVG may be considered tradable
```

Implementation status:

- `NEEDS_VERIFICATION`: exact lower-timeframe confirmation.
- `NEEDS_VERIFICATION`: exact directional bias requirement.
- `NEEDS_VERIFICATION`: whether liquidity sweep, market structure shift, or displacement is mandatory before IFVG entry.

## E. Invalidation Rules

Bullish IFVG invalidation:

```text
IF IFVG.direction == BULLISH
AND candle.close < IFVG.low
THEN bullish IFVG invalidated
```

Bearish IFVG invalidation:

```text
IF IFVG.direction == BEARISH
AND candle.close > IFVG.high
THEN bearish IFVG invalidated
```

Implementation status:

- `NEEDS_VERIFICATION`: whether invalidation should use candle close beyond boundary, wick-through, or full candle body beyond the zone.

## F. Entry Rules

Bullish IFVG entry premise:

```text
IF bearish FVG becomes bullish IFVG
AND price retests the IFVG from above
AND IFVG holds as support
AND bullish confirmation occurs
THEN long entry may be considered
```

Bearish IFVG entry premise:

```text
IF bullish FVG becomes bearish IFVG
AND price retests the IFVG from below
AND IFVG holds as resistance
AND bearish confirmation occurs
THEN short entry may be considered
```

Implementation status:

- `NEEDS_VERIFICATION`: exact definition of "holds as support/resistance".
- `NEEDS_VERIFICATION`: whether entry is at boundary touch, CE, lower-timeframe market structure shift, or displacement candle close.

## G. Target Rules

Bullish IFVG target premise:

```text
IF long entry from bullish IFVG
THEN target buy-side liquidity, opposing bearish PD Array, or next inefficiency above
```

Bearish IFVG target premise:

```text
IF short entry from bearish IFVG
THEN target sell-side liquidity, opposing bullish PD Array, or next inefficiency below
```

Implementation status:

- `NEEDS_VERIFICATION`: exact target selection hierarchy.
- `NEEDS_VERIFICATION`: whether IFVG targets differ from normal FVG targets in this bot's model.

## H. Risk Rules

Bullish IFVG risk premise:

```text
IF long entry is based on bullish IFVG support
THEN setup fails when price closes below IFVG.low
```

Bearish IFVG risk premise:

```text
IF short entry is based on bearish IFVG resistance
THEN setup fails when price closes above IFVG.high
```

Implementation status:

- `NEEDS_VERIFICATION`: whether stop should be beyond IFVG far edge, retest swing, or model-specific invalidation candle.

## I. Machine-Readable Logic

### Data Contract

```text
IFVG {
  direction: BULLISH | BEARISH
  sourceFVGId
  inversionCandleIndex
  low
  high
  consequentEncroachment
  status: ACTIVE | RETESTED | INVALIDATED
}
```

### detectBullishIFVG()

```text
FUNCTION detectBullishIFVG(existingFVG, candle, candleIndex):
  IF existingFVG does not exist:
    RETURN null

  IF existingFVG.direction != BEARISH:
    RETURN null

  IF candle.close > existingFVG.high:
    RETURN IFVG {
      direction: BULLISH
      sourceFVGId: existingFVG.id
      inversionCandleIndex: candleIndex
      low: existingFVG.low
      high: existingFVG.high
      consequentEncroachment: existingFVG.consequentEncroachment
      status: ACTIVE
    }

  RETURN null
```

### detectBearishIFVG()

```text
FUNCTION detectBearishIFVG(existingFVG, candle, candleIndex):
  IF existingFVG does not exist:
    RETURN null

  IF existingFVG.direction != BULLISH:
    RETURN null

  IF candle.close < existingFVG.low:
    RETURN IFVG {
      direction: BEARISH
      sourceFVGId: existingFVG.id
      inversionCandleIndex: candleIndex
      low: existingFVG.low
      high: existingFVG.high
      consequentEncroachment: existingFVG.consequentEncroachment
      status: ACTIVE
    }

  RETURN null
```

### Retest State Logic

```text
FUNCTION updateIFVGRetestState(ifvg, candle):
  IF ifvg.direction == BULLISH
  AND candle.low <= ifvg.high
  AND candle.high >= ifvg.low:
    ifvg.status = RETESTED

  IF ifvg.direction == BEARISH
  AND candle.high >= ifvg.low
  AND candle.low <= ifvg.high:
    ifvg.status = RETESTED

  RETURN ifvg
```

### Invalidation State Logic

```text
FUNCTION updateIFVGInvalidationState(ifvg, candle):
  IF ifvg.direction == BULLISH
  AND candle.close < ifvg.low:
    ifvg.status = INVALIDATED

  IF ifvg.direction == BEARISH
  AND candle.close > ifvg.high:
    ifvg.status = INVALIDATED

  RETURN ifvg
```

## J. Open Questions

- Is the canonical ICT IFVG trigger a close beyond the far boundary, a full body through the whole FVG, or any wick violation?
- Should an FVG be allowed to become an IFVG after it has already been fully filled/mitigated?
- Does this bot require a liquidity sweep before IFVG validation?
- Does this bot require a market structure shift before entry from IFVG?
- Should IFVG retest require touch of boundary, CE, or full zone penetration?
- Which timeframe should create IFVGs and which timeframe should execute entries?
