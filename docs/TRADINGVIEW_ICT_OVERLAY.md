# TradingView ICT FVG/IFVG Bot Analysis Overlay

File:

`tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine`

## Purpose

This Pine Script indicator lets you visually inspect the bot's current ICT analysis on TradingView.

It shows:

- validated bullish FVGs
- validated bearish FVGs
- IFVG flips after FVG invalidation
- zone midpoint lines
- compact or full zone text inside each drawn FVG/IFVG box
- FVG/IFVG boxes that stop extending after the first confirmed reaction
- selected BUY/SELL candidate markers
- fresh IFVG formation BUY/SELL markers
- visual TP target lines from opposing FVG/IFVG zones or swing highs/lows
- visual SL-to-BE state when an opposing zone appears or target is reached
- confidence
- score
- expected TP profit
- latest analysis table

## Important Limitation

TradingView Pine Script cannot read local bot files such as:

- `logs/ict-signals.json`
- `logs/detected-fvgs.json`
- `logs/detected-ifvgs.json`
- `logs/trades.csv`

So this overlay does not import the bot's live local logs.

Instead, it recreates the bot's current chart logic inside TradingView:

- raw 3-candle FVG
- prior liquidity sweep
- displacement candle
- market structure shift
- optional premium/discount
- optional UTC session filter
- reaction confirmation
- confidence
- trade candidate scoring

## How To Use

1. Open TradingView.
2. Open the chart symbol printed by the bot dashboard as `TradingView`.
   For the current `.env`, use `BINANCE:BTCUSDT`.
3. Use the `1m` timeframe when `MARKET_DATA_SOURCE=REAL_PUBLIC`, because the bot reads Binance 1-minute closed candles.
4. Open the Pine Editor.
5. Paste the contents of:

   `tradingview/ICT_FVG_IFVG_BOT_ANALYSIS_OVERLAY.pine`

6. Click `Add to chart`.

## Suggested Settings

To mirror current bot defaults:

- Liquidity sweep lookback: `5`
- Market structure lookback: `5`
- Displacement body/range minimum: `0.60`
- Displacement range multiple minimum: `1.20`
- ICT minimum confidence: `75`
- Trade fresh IFVG formation: enabled
- Position size USD: match `ORDER_SIZE_USD`
- Take profit percent: match `TAKE_PROFIT_PCT`
- Minimum expected TP profit USD: `0.50`
- Preferred TP profit range: `$0.50-$1.00`
- Target swing left/right bars: `3`
- Target fallback high/low lookback: `50`
- Active zone preview bars: `3`
- Minimum visible zone bars: `6`
- Stop zones at first reaction: enabled
- Zone text: `Compact`
- Show targets and BE stop: enabled
- Premium/discount: disabled unless you intentionally enable it
- Session filter: disabled unless you intentionally enable it

## Visual Meaning

- Green boxes: bullish validated FVG or IFVG zones.
- Red boxes: bearish validated FVG or IFVG zones.
- Compact text inside each box: zone type, direction, and midpoint.
- Full text option: zone type, direction, high, low, midpoint, and validation/flip reason.
- Dashed line: zone midpoint.
- Reacted boxes: stop at the reaction candle instead of continuing across the chart, with a minimum visible width so fast reactions remain readable.
- Gray boxes: invalidated source zones.
- BUY marker: selected bullish candidate.
- SELL marker: selected bearish candidate.
- TP line: nearest opposing bearish zone for BUY, nearest opposing bullish zone for SELL, otherwise latest confirmed swing high/low or fallback recent high/low.
- SL line: drawn at entry as a visual breakeven reference, then marked `BE` when the script detects the management condition.
- Table: latest selected analysis state.

## Target And BE Logic

For a managed BUY:

- Primary TP: nearest non-invalidated bearish FVG/IFVG above entry.
- Fallback TP: latest confirmed swing high above entry; if none exists, recent highest high from the fallback lookback.
- Opposing zone detection for BE: a new bearish FVG above entry.

For a managed SELL:

- Primary TP: nearest non-invalidated bullish FVG/IFVG below entry.
- Fallback TP: latest confirmed swing low below entry; if none exists, recent lowest low from the fallback lookback.
- Opposing zone detection for BE: a new bullish FVG below entry.

If a selected opposing-zone TP is disrespected, the overlay retargets to the swing objective and keeps the stop state at BE once that opposing area has been encountered.

## IFVG Formation Entries

With `Trade fresh IFVG formation` enabled, a close through a bearish FVG creates a bullish IFVG and can mark an immediate BUY. A close through a bullish FVG creates a bearish IFVG and can mark an immediate SELL.

The bot equivalent is `ICT_TRADE_ON_IFVG_FORMATION=true` in `.env`.

## Matching The Bot Market

The bot does not read TradingView chart candles directly. It reads the configured market data source in `.env`.

To keep the bot and indicator on the same market:

- Set `MARKET_DATA_SOURCE=REAL_PUBLIC` and `SYMBOL=BTC` for Binance BTC candles.
- Set `TRADINGVIEW_SYMBOL=BINANCE:BTCUSDT`.
- Open that TradingView symbol on the `1m` timeframe.

For NASDAQ-style symbols, use the dashboard's `TradingView` line as the chart symbol.

## Safety

This is an indicator, not a strategy.

It does not:

- place trades
- create orders
- connect to a broker
- access API keys
- access wallets
- read local bot logs
