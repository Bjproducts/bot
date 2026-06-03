import * as fs from 'fs';
import * as path from 'path';
import { PositionSizingResult } from './positionSizingTypes';

const DEFAULT_LOG_PATH = path.resolve(__dirname, '../../logs/sizing-rejections.log');

export interface SizingRejectionRecord {
  timestamp: string;
  symbol: string;
  signalSource: string;
  side: 'LONG' | 'SHORT';
  signal: 'BUY' | 'SELL';
  entryPrice: number;
  stopPrice: number;
  resolvedTargetPrice: number;
  riskDistance: number;
  rewardDistance: number;
  riskRewardRatio: number;
  positionSizeUsd: number;
  expectedProfitUsd: number;
  expectedLossUsd: number;
  targetProfitMinUsd: number;
  targetProfitMaxUsd: number;
  maxRiskPerTradeUsd: number;
  maxPositionUsd: number;
  rejectionReason: string;
  sizingMode: string;
  targetRMultiple: number;
}

export interface SizingRejectionContext {
  symbol: string;
  signalSource: string;
  side: 'LONG' | 'SHORT';
  targetProfitMinUsd: number;
  targetProfitMaxUsd: number;
  maxRiskPerTradeUsd: number;
  maxPositionUsd: number;
  timestamp?: string;
}

export function buildSizingRejectionRecord(
  sizing: PositionSizingResult,
  context: SizingRejectionContext,
): SizingRejectionRecord {
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

export function appendSizingRejection(
  sizing: PositionSizingResult,
  context: SizingRejectionContext,
  logPath: string = DEFAULT_LOG_PATH,
): SizingRejectionRecord | null {
  if (sizing.status !== 'REJECTED') return null;
  const record = buildSizingRejectionRecord(sizing, context);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  !  sizing-rejections log write failed: ${msg}`);
  }
  return record;
}
