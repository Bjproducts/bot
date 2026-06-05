import { PositionState } from './types';
import { calculateUnrealizedPnl } from './positionExitManager';

export interface BreakEvenManagementConfig {
  breakevenTriggerProfitUsd: number;
}

export interface PartialCloseManagementConfig {
  partialCloseEnabled: boolean;
  partialCloseTriggerProfitUsd: number;
  partialCloseLockProfitUsd: number;
  partialCloseMaxFraction?: number;
}

export interface PartialClosePlan {
  shouldClosePartial: boolean;
  unrealizedProfitAtClose: number;
  partialCloseFraction: number;
  originalSize: number;
  closedSize: number;
  remainingSize: number;
  realizedPartialPnlUsd: number;
}

export interface OppositeSignalProtectionPlan {
  action: 'NONE' | 'CLOSE_FOR_PROFIT' | 'CLOSE_FOR_RISK';
  unrealizedPnlUsd: number;
  activeStopBefore: number | null;
  protectionReason: string;
}

export function shouldActivateDollarBreakeven(
  position: PositionState,
  currentPrice: number,
  config: BreakEvenManagementConfig,
): boolean {
  if (position.side === 'NONE' || position.stopAtBreakeven) return false;
  return calculateUnrealizedPnl(position, currentPrice) >= config.breakevenTriggerProfitUsd - 1e-9;
}

export function activateDollarBreakeven(
  position: PositionState,
  currentPrice: number,
  activationTime: Date,
): PositionState {
  const activationIso = activationTime.toISOString();
  return {
    ...position,
    stopAtBreakeven: true,
    stopMovedToBreakevenAt: activationIso,
    breakevenActivationPrice: currentPrice,
    breakevenActivationTime: activationIso,
  };
}

export function planPartialClose(
  position: PositionState,
  currentPrice: number,
  config: PartialCloseManagementConfig,
): PartialClosePlan {
  const unrealizedProfitAtClose = calculateUnrealizedPnl(position, currentPrice);
  if (
    position.side === 'NONE'
    || !config.partialCloseEnabled
    || position.partialCloseDone
    || unrealizedProfitAtClose < config.partialCloseTriggerProfitUsd - 1e-9
    || unrealizedProfitAtClose <= 0
    || position.activePositionSize <= 0
  ) {
    return noPartialClose(unrealizedProfitAtClose, position.activePositionSize);
  }

  const partialCloseFraction = clamp(
    config.partialCloseLockProfitUsd / unrealizedProfitAtClose,
    0,
    config.partialCloseMaxFraction ?? 1,
  );
  if (partialCloseFraction <= 0) {
    return noPartialClose(unrealizedProfitAtClose, position.activePositionSize);
  }

  const originalSize = position.activePositionSize;
  const closedSize = originalSize * partialCloseFraction;
  const remainingSize = Math.max(0, originalSize - closedSize);
  const realizedPartialPnlUsd = unrealizedProfitAtClose * partialCloseFraction;

  return {
    shouldClosePartial: true,
    unrealizedProfitAtClose,
    partialCloseFraction,
    originalSize,
    closedSize,
    remainingSize,
    realizedPartialPnlUsd,
  };
}

export function applyPartialClose(
  position: PositionState,
  currentPrice: number,
  closeTime: Date,
  plan: PartialClosePlan,
): PositionState {
  if (!plan.shouldClosePartial) return position;

  const remainingFraction = 1 - plan.partialCloseFraction;
  const closeTimeIso = closeTime.toISOString();

  return {
    ...position,
    activePositionSize: plan.remainingSize,
    totalUsdInvested: position.totalUsdInvested * remainingFraction,
    positionSizeUsd: position.positionSizeUsd !== null
      ? position.positionSizeUsd * remainingFraction
      : position.positionSizeUsd,
    expectedProfitUsd: position.expectedProfitUsd !== null
      ? position.expectedProfitUsd * remainingFraction
      : position.expectedProfitUsd,
    expectedLossUsd: position.expectedLossUsd !== null
      ? position.expectedLossUsd * remainingFraction
      : position.expectedLossUsd,
    stopAtBreakeven: true,
    stopMovedToBreakevenAt: position.stopMovedToBreakevenAt ?? closeTimeIso,
    breakevenActivationPrice: position.breakevenActivationPrice ?? currentPrice,
    breakevenActivationTime: position.breakevenActivationTime ?? closeTimeIso,
    partialCloseDone: true,
    partialClosePrice: currentPrice,
    partialCloseTime: closeTimeIso,
    partialCloseFraction: plan.partialCloseFraction,
    realizedPartialPnlUsd: position.realizedPartialPnlUsd + plan.realizedPartialPnlUsd,
    remainingSizeAfterPartial: plan.remainingSize,
  };
}

export function getActiveStopPrice(position: PositionState): number | null {
  const breakevenStop = position.stopAtBreakeven ? position.averageEntryPrice : null;
  if (breakevenStop === null) return position.hardStopPrice;
  if (position.hardStopPrice === null) return breakevenStop;

  if (position.side === 'LONG') {
    return Math.max(breakevenStop, position.hardStopPrice);
  }

  if (position.side === 'SHORT') {
    return Math.min(breakevenStop, position.hardStopPrice);
  }

  return breakevenStop;
}

export function planOppositeSignalProtection(
  position: PositionState,
  currentPrice: number,
  newSignalSide: 'LONG' | 'SHORT',
  maxRiskPerTradeUsd: number,
): OppositeSignalProtectionPlan {
  const unrealizedPnlUsd = calculateUnrealizedPnl(position, currentPrice);
  const activeStopBefore = getActiveStopPrice(position);
  if (position.side === 'NONE' || position.side === newSignalSide) {
    return noOppositeProtection(unrealizedPnlUsd, activeStopBefore);
  }

  if (unrealizedPnlUsd <= -Math.abs(maxRiskPerTradeUsd)) {
    return {
      action: 'CLOSE_FOR_RISK',
      unrealizedPnlUsd,
      activeStopBefore,
      protectionReason: `Opposite accepted signal while loss exceeded $${Math.abs(maxRiskPerTradeUsd).toFixed(2)} cap`,
    };
  }

  if (unrealizedPnlUsd > 0) {
    return {
      action: 'CLOSE_FOR_PROFIT',
      unrealizedPnlUsd,
      activeStopBefore,
      protectionReason: 'Opposite accepted signal while position was profitable; closing profit before reversal.',
    };
  }

  return {
    action: 'NONE',
    unrealizedPnlUsd,
    activeStopBefore,
    protectionReason: 'Opposite accepted signal but position was not profitable and loss was below cap',
  };
}

function noPartialClose(
  unrealizedProfitAtClose: number,
  size: number,
): PartialClosePlan {
  return {
    shouldClosePartial: false,
    unrealizedProfitAtClose,
    partialCloseFraction: 0,
    originalSize: size,
    closedSize: 0,
    remainingSize: size,
    realizedPartialPnlUsd: 0,
  };
}

function noOppositeProtection(
  unrealizedPnlUsd: number,
  activeStopBefore: number | null,
): OppositeSignalProtectionPlan {
  return {
    action: 'NONE',
    unrealizedPnlUsd,
    activeStopBefore,
    protectionReason: 'No opposite-side active position',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
