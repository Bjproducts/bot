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
exports.buildSizingRejectionRecord = buildSizingRejectionRecord;
exports.appendSizingRejection = appendSizingRejection;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_LOG_PATH = path.resolve(__dirname, '../../logs/sizing-rejections.log');
function buildSizingRejectionRecord(sizing, context) {
    return {
        timestamp: context.timestamp ?? new Date().toISOString(),
        symbol: context.symbol,
        signalSource: context.signalSource,
        side: context.side,
        signal: sizing.signal,
        entryPrice: sizing.entryPrice,
        stopPrice: sizing.stopPrice,
        resolvedTargetPrice: sizing.resolvedTargetPrice,
        riskDistance: sizing.riskDistance,
        rewardDistance: sizing.rewardDistance,
        riskRewardRatio: sizing.riskRewardRatio,
        positionSizeUsd: sizing.recommendedPositionSizeUsd,
        expectedProfitUsd: sizing.expectedProfitUsd,
        expectedLossUsd: sizing.expectedLossUsd,
        targetProfitMinUsd: context.targetProfitMinUsd,
        targetProfitMaxUsd: context.targetProfitMaxUsd,
        maxRiskPerTradeUsd: context.maxRiskPerTradeUsd,
        maxPositionUsd: context.maxPositionUsd,
        rejectionReason: sizing.rejectionReason,
        sizingMode: sizing.sizingMode,
        targetRMultiple: sizing.targetRMultiple,
    };
}
function appendSizingRejection(sizing, context, logPath = DEFAULT_LOG_PATH) {
    if (sizing.status !== 'REJECTED')
        return null;
    const record = buildSizingRejectionRecord(sizing, context);
    try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  !  sizing-rejections log write failed: ${msg}`);
    }
    return record;
}
