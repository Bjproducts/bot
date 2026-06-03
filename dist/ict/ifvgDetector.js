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
    if (bodyClosedAbove(candle, existingFVG.high)) {
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
    if (bodyClosedBelow(candle, existingFVG.low)) {
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
                zones.push(updateIFVGState(applyParentFvgAttribution(ifvg, fvgs, candles), candles));
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
        if (zone.direction === 'BULLISH' && bodyClosedBelow(candle, zone.low)) {
            invalidated = true;
            flipped = true;
        }
        if (zone.direction === 'BEARISH' && bodyClosedAbove(candle, zone.high)) {
            invalidated = true;
            flipped = true;
        }
    }
    return { ...zone, filled, invalidated, flipped };
}
function applyParentFvgAttribution(ifvg, fvgs, candles) {
    const parent = fvgs.find(fvg => fvg.direction === ifvg.direction
        && fvg.id !== ifvg.sourceFvgId
        && ifvg.low >= fvg.low
        && ifvg.high <= fvg.high
        && parentWasRespected(fvg, candles, ifvg.inversionCandleIndex));
    if (!parent)
        return ifvg;
    return {
        ...ifvg,
        parentFvgId: parent.id,
        parentFvgRespected: true,
        confidenceOverride: 100,
        confidenceAttribution: `IFVG inside respected parent FVG ${parent.id}; confidence override 100`,
    };
}
function parentWasRespected(parent, candles, untilIndexExclusive) {
    let retracedIntoParent = false;
    for (let i = parent.candle3Index + 1; i < untilIndexExclusive; i++) {
        const candle = candles[i];
        if (!candle || !isValidCandle(candle))
            continue;
        if (parent.direction === 'BULLISH' && bodyClosedBelow(candle, parent.low))
            return false;
        if (parent.direction === 'BEARISH' && bodyClosedAbove(candle, parent.high))
            return false;
        if (candle.low <= parent.high && candle.high >= parent.low) {
            retracedIntoParent = true;
        }
    }
    return retracedIntoParent;
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
function makeIfvgId(direction, sourceFvgId, inversionCandleIndex) {
    return ['IFVG', direction, sourceFvgId, inversionCandleIndex].join(':');
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}
