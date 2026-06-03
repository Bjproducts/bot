"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ictFixtures = exports.filledZoneFixture = exports.invalidatedZoneFixture = exports.bearishIfvgFlipFixture = exports.bullishIfvgFlipFixture = exports.noFvgFixture = exports.bearishFvgPresentFixture = exports.bullishFvgPresentFixture = void 0;
exports.bullishFvgPresentFixture = {
    name: 'bullish FVG present',
    candles: [
        candle(0, 98, 100, 95, 99),
        candle(1, 100, 105, 99, 104),
        candle(2, 104, 106, 102, 105),
    ],
};
exports.bearishFvgPresentFixture = {
    name: 'bearish FVG present',
    candles: [
        candle(0, 104, 105, 100, 101),
        candle(1, 100, 101, 95, 96),
        candle(2, 95, 98, 92, 93),
    ],
};
exports.noFvgFixture = {
    name: 'no FVG',
    candles: [
        candle(0, 100, 101, 99, 100),
        candle(1, 100, 102, 98, 101),
        candle(2, 101, 101.5, 99.5, 100.5),
    ],
};
exports.bullishIfvgFlipFixture = {
    name: 'bullish IFVG flip',
    candles: [
        candle(0, 104, 105, 100, 101),
        candle(1, 100, 101, 95, 96),
        candle(2, 95, 98, 92, 93),
        candle(3, 101, 107, 100.5, 106),
    ],
};
exports.bearishIfvgFlipFixture = {
    name: 'bearish IFVG flip',
    candles: [
        candle(0, 98, 100, 95, 99),
        candle(1, 100, 105, 99, 104),
        candle(2, 104, 106, 102, 105),
        candle(3, 99.8, 106, 99, 99.5),
    ],
};
exports.invalidatedZoneFixture = {
    name: 'invalidated zone',
    candles: [
        candle(0, 98, 100, 95, 99),
        candle(1, 100, 105, 99, 104),
        candle(2, 104, 106, 102, 105),
        candle(3, 99.5, 106, 98, 99),
    ],
};
exports.filledZoneFixture = {
    name: 'filled zone',
    candles: [
        candle(0, 98, 100, 95, 99),
        candle(1, 100, 105, 99, 104),
        candle(2, 104, 106, 102, 105),
        candle(3, 105, 106, 99.5, 100.5),
    ],
};
exports.ictFixtures = [
    exports.bullishFvgPresentFixture,
    exports.bearishFvgPresentFixture,
    exports.noFvgFixture,
    exports.bullishIfvgFlipFixture,
    exports.bearishIfvgFlipFixture,
    exports.invalidatedZoneFixture,
    exports.filledZoneFixture,
];
function candle(minute, open, high, low, close) {
    return {
        open,
        high,
        low,
        close,
        volume: 1,
        timestamp: new Date(Date.UTC(2026, 5, 1, 0, minute, 0)),
    };
}
