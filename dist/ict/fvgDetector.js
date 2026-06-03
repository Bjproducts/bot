"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETECTED_FVGS_PATH = void 0;
exports.detectBullishFVG = detectBullishFVG;
exports.detectBearishFVG = detectBearishFVG;
exports.detectFVGs = detectFVGs;
exports.detectAndStoreFVGs = detectAndStoreFVGs;
exports.saveDetectedFVGs = saveDetectedFVGs;
exports.loadDetectedFVGs = loadDetectedFVGs;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
exports.DETECTED_FVGS_PATH = path.join(LOGS_DIR, 'detected-fvgs.json');
function detectBullishFVG(candles, index) {
    const candle1 = candles[index - 2];
    const candle2 = candles[index - 1];
    const candle3 = candles[index];
    if (!candle1 || !candle2 || !candle3)
        return null;
    if (!isValidCandle(candle1) || !isValidCandle(candle2) || !isValidCandle(candle3))
        return null;
    if (candle1.high < candle3.low) {
        const low = candle1.high;
        const high = candle3.low;
        return {
            id: makeFvgId('BULLISH', index - 2, index - 1, index, low, high),
            type: 'FVG',
            direction: 'BULLISH',
            high,
            low,
            midpoint: midpoint(low, high),
            createdAt: candle3.timestamp.toISOString(),
            invalidated: false,
            filled: false,
            flipped: false,
            candle1Index: index - 2,
            candle2Index: index - 1,
            candle3Index: index,
        };
    }
    return null;
}
function detectBearishFVG(candles, index) {
    const candle1 = candles[index - 2];
    const candle2 = candles[index - 1];
    const candle3 = candles[index];
    if (!candle1 || !candle2 || !candle3)
        return null;
    if (!isValidCandle(candle1) || !isValidCandle(candle2) || !isValidCandle(candle3))
        return null;
    if (candle1.low > candle3.high) {
        const low = candle3.high;
        const high = candle1.low;
        return {
            id: makeFvgId('BEARISH', index - 2, index - 1, index, low, high),
            type: 'FVG',
            direction: 'BEARISH',
            high,
            low,
            midpoint: midpoint(low, high),
            createdAt: candle3.timestamp.toISOString(),
            invalidated: false,
            filled: false,
            flipped: false,
            candle1Index: index - 2,
            candle2Index: index - 1,
            candle3Index: index,
        };
    }
    return null;
}
function detectFVGs(candles) {
    const zones = [];
    for (let index = 2; index < candles.length; index++) {
        const bullish = detectBullishFVG(candles, index);
        if (bullish)
            zones.push(updateFVGState(bullish, candles));
        const bearish = detectBearishFVG(candles, index);
        if (bearish)
            zones.push(updateFVGState(bearish, candles));
    }
    return zones;
}
function detectAndStoreFVGs(candles) {
    const zones = detectFVGs(candles);
    saveDetectedFVGs(zones);
    return { zones, logPath: exports.DETECTED_FVGS_PATH };
}
function saveDetectedFVGs(zones) {
    ensureLogsDir();
    fs.writeFileSync(exports.DETECTED_FVGS_PATH, JSON.stringify(zones, null, 2), 'utf-8');
}
function loadDetectedFVGs() {
    try {
        const raw = fs.readFileSync(exports.DETECTED_FVGS_PATH, 'utf-8').trim();
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
function updateFVGState(zone, candles) {
    let filled = false;
    let invalidated = false;
    let flipped = false;
    for (let i = zone.candle3Index + 1; i < candles.length; i++) {
        const candle = candles[i];
        if (!candle || !isValidCandle(candle))
            continue;
        if (zone.direction === 'BULLISH') {
            if (candle.low <= zone.low)
                filled = true;
            if (bodyClosedBelow(candle, zone.low)) {
                invalidated = true;
                flipped = true;
            }
        }
        else {
            if (candle.high >= zone.high)
                filled = true;
            if (bodyClosedAbove(candle, zone.high)) {
                invalidated = true;
                flipped = true;
            }
        }
    }
    return { ...zone, filled, invalidated, flipped };
}
function bodyClosedBelow(candle, level) {
    return candle.open < level && candle.close < level;
}
function bodyClosedAbove(candle, level) {
    return candle.open > level && candle.close > level;
}
function isValidCandle(candle) {
    return Number.isFinite(candle.open)
        && Number.isFinite(candle.high)
        && Number.isFinite(candle.low)
        && Number.isFinite(candle.close)
        && candle.high >= candle.low
        && candle.timestamp instanceof Date
        && !Number.isNaN(candle.timestamp.getTime());
}
function midpoint(low, high) {
    return (low + high) / 2;
}
function makeFvgId(direction, candle1Index, candle2Index, candle3Index, low, high) {
    return [
        'FVG',
        direction,
        candle1Index,
        candle2Index,
        candle3Index,
        low,
        high,
    ].join(':');
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}
