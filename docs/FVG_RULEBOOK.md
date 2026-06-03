# ICT Fair Value Gap (FVG) Rulebook

Purpose: formalize ICT Fair Value Gap concepts for later detector implementation. This document is not a complete trading strategy.

## A. Research Summary

Primary ICT source references used:

- The Inner Circle Trader, "ICT 2024 Mentorship \ How To Trade ICT FVGs Correctly \ September 16, 2024", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/HhgWGduQZQY
- The Inner Circle Trader, "What Are Fair Value Gaps in Trading and How to Use Them?", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/GFdWahZUNOw
- The Inner Circle Trader, "ICT Opening Range Theory \ 1st Presented FVG Logic", official YouTube video mirrored by Glasp summary/transcript page: https://glasp.co/youtube/Zm9Q0NDRxoY

Notes:

- ICT teaches FVGs as price-delivery inefficiencies / imbalances, used as PD Arrays.
- The strict mechanical detector is a three-candle condition.
- Trade use is not standalone. ICT usage normally requires broader context such as bias, liquidity, premium/discount, displacement, market structure, and session/time model. These context rules are marked `NEEDS_VERIFICATION` where the exact implementation threshold is not explicit enough for code.

## B. Definition

An ICT Fair Value Gap is a three-candle price imbalance where price delivery leaves a gap between candle 1 and candle 3, with candle 2 delivering aggressively between them.

ICT uses FVGs because they identify inefficient price delivery. Price may later return to rebalance, mitigate, or use the area as a PD Array for entry, continuation, or draw-on-liquidity logic.

Terminology:

- `candle1`: first candle in the three-candle sequence.
- `candle2`: middle candle, normally the displacement candle.
- `candle3`: third candle in the sequence.
- `bullish FVG`: imbalance created by upward price delivery.
- `bearish FVG`: imbalance created by downward price delivery.
- `FVG high`: upper boundary of the gap.
- `FVG low`: lower boundary of the gap.
- `consequent encroachment (CE)`: 50% level of the FVG range.

## C. Formation Rules

### Bullish FVG Formation

Strict logical rule:

```text
IF candle1.high < candle3.low
THEN bullish FVG detected
```

Zone boundaries:

```text
bullishFVG.low = candle1.high
bullishFVG.high = candle3.low
bullishFVG.CE = (bullishFVG.low + bullishFVG.high) / 2
```

Interpretation:

- The gap is the price range from `candle1.high` to `candle3.low`.
- The displacement candle is `candle2`.

### Bearish FVG Formation

Strict logical rule:

```text
IF candle1.low > candle3.high
THEN bearish FVG detected
```

Zone boundaries:

```text
bearishFVG.low = candle3.high
bearishFVG.high = candle1.low
bearishFVG.CE = (bearishFVG.low + bearishFVG.high) / 2
```

Interpretation:

- The gap is the price range from `candle3.high` to `candle1.low`.
- The displacement candle is `candle2`.

## D. Validation Rules

Strict detector validation:

```text
IF gapSize > 0
AND candle timestamps are sequential
AND candle OHLC values are valid
THEN FVG is structurally valid
```

Contextual trade validation:

```text
IF FVG exists
AND FVG aligns with current ICT directional bias
AND FVG is positioned in the expected premium/discount context
AND FVG is associated with displacement
AND price later returns into the FVG
THEN FVG may be considered for trade execution
```

Implementation status:

- `NEEDS_VERIFICATION`: exact displacement threshold for code.
- `NEEDS_VERIFICATION`: exact higher-timeframe bias rule for this bot.
- `NEEDS_VERIFICATION`: exact premium/discount dealing range to use.
- `NEEDS_VERIFICATION`: whether entry should trigger at FVG boundary, CE, full fill, or lower-timeframe confirmation.

## E. Invalidation Rules

Structural invalidation:

```text
IF bullish FVG condition candle1.high < candle3.low is false
THEN no bullish FVG exists
```

```text
IF bearish FVG condition candle1.low > candle3.high is false
THEN no bearish FVG exists
```

Trade-use invalidation:

```text
IF bullish FVG is traded as support
AND price closes below bullishFVG.low
THEN bullish FVG trade premise is invalidated or converted to bearish IFVG candidate
```

```text
IF bearish FVG is traded as resistance
AND price closes above bearishFVG.high
THEN bearish FVG trade premise is invalidated or converted to bullish IFVG candidate
```

Implementation status:

- `NEEDS_VERIFICATION`: whether ICT-specific invalidation should require a candle body close beyond the full FVG, wick-through, or full candle body beyond the zone for this bot.

## F. Entry Rules

FVG alone is not a full strategy.

Bullish usage:

```text
IF bullish FVG is structurally valid
AND trade bias is bullish
AND price trades back into the bullish FVG
AND lower-timeframe entry confirmation occurs
THEN long entry may be considered
```

Bearish usage:

```text
IF bearish FVG is structurally valid
AND trade bias is bearish
AND price trades back into the bearish FVG
AND lower-timeframe entry confirmation occurs
THEN short entry may be considered
```

Implementation status:

- `NEEDS_VERIFICATION`: exact entry trigger.
- `NEEDS_VERIFICATION`: whether lower-timeframe confirmation is required for this bot.
- `NEEDS_VERIFICATION`: whether CE touch is required before entry.

## G. Target Rules

Typical ICT objectives:

```text
IF long entry from bullish FVG
THEN target buy-side liquidity, opposing bearish PD Array, or next inefficiency above
```

```text
IF short entry from bearish FVG
THEN target sell-side liquidity, opposing bullish PD Array, or next inefficiency below
```

Implementation status:

- `NEEDS_VERIFICATION`: exact target hierarchy for this bot.
- `NEEDS_VERIFICATION`: whether partials, CE of opposing array, or full opposing array fill should be used.

## H. Risk Rules

Bullish risk premise:

```text
IF long entry is based on bullish FVG support
THEN setup fails when price closes below the lower boundary of the bullish FVG
```

Bearish risk premise:

```text
IF short entry is based on bearish FVG resistance
THEN setup fails when price closes above the upper boundary of the bearish FVG
```

Implementation status:

- `NEEDS_VERIFICATION`: whether stop placement should use the far edge of the FVG, displacement candle extreme, swing point, or model-specific invalidation point.

## I. Machine-Readable Logic

### Data Contract

```text
Candle {
  timestamp
  open
  high
  low
  close
}

FVG {
  direction: BULLISH | BEARISH
  candle1Index
  candle2Index
  candle3Index
  low
  high
  consequentEncroachment
  status: OPEN | PARTIALLY_MITIGATED | FILLED | INVALIDATED | INVERTED
}
```

### detectBullishFVG()

```text
FUNCTION detectBullishFVG(candles, index):
  candle1 = candles[index - 2]
  candle2 = candles[index - 1]
  candle3 = candles[index]

  IF candle1 does not exist OR candle2 does not exist OR candle3 does not exist:
    RETURN null

  IF candle1.high < candle3.low:
    gapLow = candle1.high
    gapHigh = candle3.low
    RETURN FVG {
      direction: BULLISH
      candle1Index: index - 2
      candle2Index: index - 1
      candle3Index: index
      low: gapLow
      high: gapHigh
      consequentEncroachment: (gapLow + gapHigh) / 2
      status: OPEN
    }

  RETURN null
```

### detectBearishFVG()

```text
FUNCTION detectBearishFVG(candles, index):
  candle1 = candles[index - 2]
  candle2 = candles[index - 1]
  candle3 = candles[index]

  IF candle1 does not exist OR candle2 does not exist OR candle3 does not exist:
    RETURN null

  IF candle1.low > candle3.high:
    gapLow = candle3.high
    gapHigh = candle1.low
    RETURN FVG {
      direction: BEARISH
      candle1Index: index - 2
      candle2Index: index - 1
      candle3Index: index
      low: gapLow
      high: gapHigh
      consequentEncroachment: (gapLow + gapHigh) / 2
      status: OPEN
    }

  RETURN null
```

## J. Open Questions

- What exact ICT source should be treated as canonical for FVG invalidation: wick-through, close-through, or full candle body close-through?
- Which dealing range defines premium/discount for this bot?
- Which directional bias model should filter FVGs?
- Should entry be at first touch, CE, full fill, or only after lower-timeframe confirmation?
- Should the bot detect all FVGs or only displacement FVGs with a minimum candle body/range threshold?
