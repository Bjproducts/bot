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
exports.GAP_RESET_LOG_PATH = exports.DEFAULT_MAX_GAP_SECONDS = void 0;
exports.detectCandleGap = detectCandleGap;
exports.clearIctStateForGap = clearIctStateForGap;
exports.appendGapResetEvent = appendGapResetEvent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Phase 5d: gap-detection threshold for 1-minute candles. A normal close→close
// delta is 60s; we tolerate 3 minutes (network hiccup, dashboard pause) before
// declaring the buffer stale.
exports.DEFAULT_MAX_GAP_SECONDS = 180;
exports.GAP_RESET_LOG_PATH = path.resolve(__dirname, '../../logs/gap-resets.log');
function detectCandleGap(previousCandleTimestamp, newCandleTimestamp, maxGapSeconds = exports.DEFAULT_MAX_GAP_SECONDS) {
    if (!previousCandleTimestamp) {
        return {
            gapDetected: false,
            gapSeconds: 0,
            thresholdSeconds: maxGapSeconds,
            reason: 'No previous candle — first candle in buffer',
        };
    }
    const deltaMs = newCandleTimestamp.getTime() - previousCandleTimestamp.getTime();
    const gapSeconds = Math.max(0, Math.round(deltaMs / 1000));
    const detected = gapSeconds > maxGapSeconds;
    return {
        gapDetected: detected,
        gapSeconds,
        thresholdSeconds: maxGapSeconds,
        reason: detected
            ? `Gap ${gapSeconds}s exceeds ${maxGapSeconds}s threshold`
            : `Gap ${gapSeconds}s within ${maxGapSeconds}s threshold`,
    };
}
/**
 * Phase 5d: clears every persistent ICT cache that could leak across a
 * candle-stream gap. Mutates the passed-in arrays in place so callers
 * (BotEngine) can share the same array references throughout the session.
 * Object fields (latestTradeSelection) are not mutated — the caller must
 * reassign them to null after invoking this.
 *
 * Returns counts taken BEFORE the clear, so the gap-reset event can
 * record what was discarded.
 */
function clearIctStateForGap(state) {
    const oldBufferSize = state.ictCandleBuffer.length;
    const oldZoneCount = state.latestIctZones.length;
    const oldFvgCount = state.latestIctZones.filter(z => z?.type === 'FVG').length;
    const oldIfvgCount = state.latestIctZones.filter(z => z?.type === 'IFVG').length;
    const oldCandidateCount = state.latestTradeSelection?.candidates?.length ?? 0;
    // In-place truncation preserves the bot's array references.
    state.ictCandleBuffer.length = 0;
    state.latestIctZones.length = 0;
    return { oldBufferSize, oldZoneCount, oldFvgCount, oldIfvgCount, oldCandidateCount };
}
function appendGapResetEvent(event, logPath = exports.GAP_RESET_LOG_PATH) {
    try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  !  gap-resets log write failed: ${msg}`);
    }
}
