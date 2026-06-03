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
exports.DETECTED_IFVGS_PATH = void 0;
exports.detectBullishIFVG = detectBullishIFVG;
exports.detectBearishIFVG = detectBearishIFVG;
exports.detectIFVGs = detectIFVGs;
exports.detectAndStoreIFVGs = detectAndStoreIFVGs;
exports.saveDetectedIFVGs = saveDetectedIFVGs;
exports.loadDetectedIFVGs = loadDetectedIFVGs;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
exports.DETECTED_IFVGS_PATH = path.join(LOGS_DIR, 'detected-ifvgs.json');
function detectBullishIFVG(existingFVG, candle, candleIndex) {
    if (existingFVG.direction !== 'BEARISH')
        return null;
    if (!isValidCandle(candle))
        return null;
    if (candle.close > existingFVG.high) {
        return {
            id: makeIfvgId('BULLISH', existingFVG.id, candleIndex),
            type: 'IFVG',
            direction: 'BULLISH',
            sourceFvgId: existingFVG.id,
            inversionCandleIndex: candleIndex,
            high: existingFVG.high,
            low: existingFVG.low,
            midpoint: existingFVG.midpoint,
            createdAt: candle.timestamp.toISOString(),
            invalidated: false,
            filled: false,
            flipped: false,
        };
    }
    return null;
}
function detectBearishIFVG(existingFVG, candle, candleIndex) {
    if (existingFVG.direction !== 'BULLISH')
        return null;
    if (!isValidCandle(candle))
        return null;
    if (candle.close < existingFVG.low) {
        return {
            id: makeIfvgId('BEARISH', existingFVG.id, candleIndex),
            type: 'IFVG',
            direction: 'BEARISH',
            sourceFvgId: existingFVG.id,
            inversionCandleIndex: candleIndex,
            high: existingFVG.high,
            low: existingFVG.low,
            midpoint: existingFVG.midpoint,
            createdAt: candle.timestamp.toISOString(),
            invalidated: false,
            filled: false,
            flipped: false,
        };
    }
    return null;
}
function detectIFVGs(fvgs, candles) {
    const zones = [];
    const seenSourceFvgs = new Set();
    for (const fvg of fvgs) {
        if (seenSourceFvgs.has(fvg.id))
            continue;
        for (let i = fvg.candle3Index + 1; i < candles.length; i++) {
            const candle = candles[i];
            if (!candle)
                continue;
            const ifvg = fvg.direction === 'BEARISH'
                ? detectBullishIFVG(fvg, candle, i)
                : detectBearishIFVG(fvg, candle, i);
            if (ifvg) {
                zones.push(updateIFVGState(ifvg, candles));
                seenSourceFvgs.add(fvg.id);
                break;
            }
        }
    }
    return zones;
}
function detectAndStoreIFVGs(fvgs, candles) {
    const zones = detectIFVGs(fvgs, candles);
    saveDetectedIFVGs(zones);
    return { zones, logPath: exports.DETECTED_IFVGS_PATH };
}
function saveDetectedIFVGs(zones) {
    ensureLogsDir();
    fs.writeFileSync(exports.DETECTED_IFVGS_PATH, JSON.stringify(zones, null, 2), 'utf-8');
}
function loadDetectedIFVGs() {
    try {
        const raw = fs.readFileSync(exports.DETECTED_IFVGS_PATH, 'utf-8').trim();
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
function updateIFVGState(zone, candles) {
    let filled = false;
    let invalidated = false;
    let flipped = false;
    for (let i = zone.inversionCandleIndex + 1; i < candles.length; i++) {
        const candle = candles[i];
        if (!candle || !isValidCandle(candle))
            continue;
        const tradesIntoZone = candle.low <= zone.high && candle.high >= zone.low;
        if (tradesIntoZone)
            filled = true;
        if (zone.direction === 'BULLISH' && candle.close < zone.low) {
            invalidated = true;
            flipped = true;
        }
        if (zone.direction === 'BEARISH' && candle.close > zone.high) {
            invalidated = true;
            flipped = true;
        }
    }
    return { ...zone, filled, invalidated, flipped };
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
function makeIfvgId(direction, sourceFvgId, inversionCandleIndex) {
    return ['IFVG', direction, sourceFvgId, inversionCandleIndex].join(':');
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}
