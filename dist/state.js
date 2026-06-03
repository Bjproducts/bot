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
exports.loadState = loadState;
exports.emptyPositionState = emptyPositionState;
exports.loadOpenPositions = loadOpenPositions;
exports.saveState = saveState;
exports.saveOpenPositions = saveOpenPositions;
exports.recordDcaEntry = recordDcaEntry;
exports.resetState = resetState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STATE_FILE_PATH = path.resolve(__dirname, '../position-state.json');
const DEFAULT_STATE = {
    id: null,
    activePositionSize: 0,
    averageEntryPrice: 0,
    totalUsdInvested: 0,
    side: 'NONE',
    dcaCount: 0,
    lastDcaPrice: 0,
    openedAt: null,
    entryZoneId: null,
    entryZoneType: null,
    entryZoneHigh: null,
    entryZoneLow: null,
    entryZoneMidpoint: null,
    entryZoneDirection: null,
    entryZoneRespected: null,
    targetPrice: null,
    targetSource: null,
    targetZoneId: null,
    targetZoneType: null,
    targetZoneHigh: null,
    targetZoneLow: null,
    targetZoneDirection: null,
    targetDisrespected: null,
    stopAtBreakeven: false,
    stopMovedToBreakevenAt: null,
    hardStopPrice: null,
    hardStopEnabled: false,
    positionSizeUsd: null,
    expectedProfitUsd: null,
    expectedLossUsd: null,
    riskRewardRatio: null,
    sizingMode: null,
    riskUtilizationPercent: null,
    riskUtilizationWarning: null,
    targetRMultiple: null,
    expectedMovePercent: null,
    selectionScore: null,
    scoreAttribution: null,
};
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const data = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
            return { ...DEFAULT_STATE, ...JSON.parse(data) };
        }
    }
    catch (err) {
        console.error('Error loading position-state.json, falling back to default:', err);
    }
    return { ...DEFAULT_STATE };
}
function emptyPositionState() {
    return { ...DEFAULT_STATE };
}
function loadOpenPositions() {
    const state = loadState();
    const persistedPositions = Array.isArray(state.openPositions)
        ? state.openPositions
        : null;
    if (persistedPositions) {
        return persistedPositions
            .map(position => ({ ...DEFAULT_STATE, ...position, openPositions: undefined }))
            .filter(position => position.side !== 'NONE');
    }
    return state.side === 'NONE'
        ? []
        : [{ ...DEFAULT_STATE, ...state, openPositions: undefined }];
}
function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Error saving position-state.json:', err);
    }
}
function saveOpenPositions(positions) {
    const activePositions = positions
        .filter(position => position.side !== 'NONE')
        .map(position => ({ ...position, openPositions: undefined }));
    if (activePositions.length === 0) {
        saveState(DEFAULT_STATE);
        return;
    }
    saveState({
        ...activePositions[0],
        openPositions: activePositions,
    });
}
/**
 * Updates the state when a Dollar Cost Average (DCA) entry is executed
 */
function recordDcaEntry(currentState, fillPrice, fillAmount, usdCost, side, options = {}) {
    const oldSize = currentState.activePositionSize;
    const oldAverage = currentState.averageEntryPrice;
    // New total size is sum of sizes
    const newSize = oldSize + fillAmount;
    // Weighted average entry calculation
    const newAveragePrice = newSize > 0
        ? (oldAverage * oldSize + fillPrice * fillAmount) / newSize
        : 0;
    const newTotalUsd = currentState.totalUsdInvested + usdCost;
    const newDcaCount = currentState.dcaCount + 1;
    const updatedState = {
        id: currentState.id,
        activePositionSize: newSize,
        averageEntryPrice: newAveragePrice,
        totalUsdInvested: newTotalUsd,
        side,
        dcaCount: newDcaCount,
        lastDcaPrice: fillPrice,
        openedAt: currentState.openedAt ?? new Date().toISOString(),
        entryZoneId: currentState.entryZoneId,
        entryZoneType: currentState.entryZoneType,
        entryZoneHigh: currentState.entryZoneHigh,
        entryZoneLow: currentState.entryZoneLow,
        entryZoneMidpoint: currentState.entryZoneMidpoint,
        entryZoneDirection: currentState.entryZoneDirection,
        entryZoneRespected: currentState.entryZoneRespected,
        targetPrice: currentState.targetPrice,
        targetSource: currentState.targetSource,
        targetZoneId: currentState.targetZoneId,
        targetZoneType: currentState.targetZoneType,
        targetZoneHigh: currentState.targetZoneHigh,
        targetZoneLow: currentState.targetZoneLow,
        targetZoneDirection: currentState.targetZoneDirection,
        targetDisrespected: currentState.targetDisrespected,
        stopAtBreakeven: currentState.stopAtBreakeven,
        stopMovedToBreakevenAt: currentState.stopMovedToBreakevenAt,
        hardStopPrice: currentState.hardStopPrice,
        hardStopEnabled: currentState.hardStopEnabled,
        positionSizeUsd: currentState.positionSizeUsd,
        expectedProfitUsd: currentState.expectedProfitUsd,
        expectedLossUsd: currentState.expectedLossUsd,
        riskRewardRatio: currentState.riskRewardRatio,
        sizingMode: currentState.sizingMode,
        riskUtilizationPercent: currentState.riskUtilizationPercent,
        riskUtilizationWarning: currentState.riskUtilizationWarning,
        targetRMultiple: currentState.targetRMultiple,
        expectedMovePercent: currentState.expectedMovePercent,
        selectionScore: currentState.selectionScore,
        scoreAttribution: currentState.scoreAttribution,
    };
    if (options.persist !== false) {
        saveState(updatedState);
    }
    return updatedState;
}
/**
 * Resets the local position state to zero (e.g. after a trade is successfully exited)
 */
function resetState() {
    saveState(DEFAULT_STATE);
    return { ...DEFAULT_STATE };
}
