import * as fs from 'fs';
import * as path from 'path';
import { PositionState } from './types';

const STATE_FILE_PATH = path.resolve(__dirname, '../position-state.json');

const DEFAULT_STATE: PositionState = {
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
  breakevenActivationPrice: null,
  breakevenActivationTime: null,
  hardStopPrice: null,
  hardStopEnabled: false,
  stopPrice: null,
  stopSource: null,
  stopRiskDistance: null,
  stopZoneSize: null,
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

export function loadState(): PositionState {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const data = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading position-state.json, falling back to default:', err);
  }
  return { ...DEFAULT_STATE };
}

export function emptyPositionState(): PositionState {
  return { ...DEFAULT_STATE };
}

export function loadOpenPositions(): PositionState[] {
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

export function saveState(state: PositionState): void {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving position-state.json:', err);
  }
}

export function saveOpenPositions(positions: readonly PositionState[]): void {
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
export function recordDcaEntry(
  currentState: PositionState,
  fillPrice: number,
  fillAmount: number,
  usdCost: number,
  side: 'LONG' | 'SHORT',
  options: { persist?: boolean } = {},
): PositionState {
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

  const updatedState: PositionState = {
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
    breakevenActivationPrice: currentState.breakevenActivationPrice,
    breakevenActivationTime: currentState.breakevenActivationTime,
    hardStopPrice: currentState.hardStopPrice,
    hardStopEnabled: currentState.hardStopEnabled,
    stopPrice: currentState.stopPrice,
    stopSource: currentState.stopSource,
    stopRiskDistance: currentState.stopRiskDistance,
    stopZoneSize: currentState.stopZoneSize,
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
export function resetState(): PositionState {
  saveState(DEFAULT_STATE);
  return { ...DEFAULT_STATE };
}
