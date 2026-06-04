import { Candle } from '../signals/types';
import { StopModel } from '../types';
import { StopSource } from './tradeCandidateTypes';
import { IctSignalAction, IctSignalZone } from './ictSignalTypes';

export interface StopAttributionResult {
  entryPrice: number;
  stopPrice: number | null;
  stopSource: StopSource | null;
  riskDistance: number | null;
  zoneSize: number;
  zoneBoundaryStopPrice: number | null;
  zoneBoundaryRiskDistance: number | null;
  stopModel: StopModel;
  originalStopPrice: number | null;
  tightStopPrice: number | null;
  selectedStopPrice: number | null;
  stopTightened: boolean;
  stopTighteningReason: string;
}

export function resolveStopAttribution(input: {
  zone: IctSignalZone;
  signal: IctSignalAction;
  entryPrice: number;
  candles: readonly Candle[];
  stopModel?: StopModel;
}): StopAttributionResult {
  const { zone, signal, entryPrice, candles } = input;
  const stopModel = input.stopModel ?? 'ORIGIN';
  const zoneSize = Math.abs(zone.high - zone.low);
  const zoneBoundaryStopPrice = zoneBoundaryStop(zone, signal);
  const originalStop = originStop(zone, signal, candles) ?? {
    stopPrice: zoneBoundaryStopPrice,
    stopSource: zoneBoundaryStopSource(signal),
  };
  const tightStop = {
    stopPrice: zoneBoundaryStopPrice,
    stopSource: zoneBoundaryStopSource(signal),
  };
  const selected = selectStop({
    signal,
    entryPrice,
    stopModel,
    originalStop,
    tightStop,
  });
  const riskDistance = selected.stopPrice !== null
    ? Math.abs(entryPrice - selected.stopPrice)
    : null;
  const zoneBoundaryRiskDistance = zoneBoundaryStopPrice !== null
    ? Math.abs(entryPrice - zoneBoundaryStopPrice)
    : null;

  return {
    entryPrice,
    stopPrice: selected.stopPrice,
    stopSource: selected.stopSource,
    riskDistance,
    zoneSize,
    zoneBoundaryStopPrice,
    zoneBoundaryRiskDistance,
    stopModel,
    originalStopPrice: originalStop.stopPrice,
    tightStopPrice: tightStop.stopPrice,
    selectedStopPrice: selected.stopPrice,
    stopTightened: selected.stopTightened,
    stopTighteningReason: selected.reason,
  };
}

function selectStop(input: {
  signal: IctSignalAction;
  entryPrice: number;
  stopModel: StopModel;
  originalStop: { stopPrice: number | null; stopSource: StopSource | null };
  tightStop: { stopPrice: number | null; stopSource: StopSource | null };
}): {
  stopPrice: number | null;
  stopSource: StopSource | null;
  stopTightened: boolean;
  reason: string;
} {
  const { signal, entryPrice, stopModel, originalStop, tightStop } = input;
  if (stopModel === 'ORIGIN') {
    return {
      ...originalStop,
      stopTightened: false,
      reason: 'STOP_MODEL=ORIGIN uses original stop source',
    };
  }

  if (!validStopSide(signal, entryPrice, tightStop.stopPrice)) {
    return {
      ...originalStop,
      stopTightened: false,
      reason: 'TIGHT_FVG invalid because tight stop is on wrong side of entry; using original stop',
    };
  }

  if (!validStopSide(signal, entryPrice, originalStop.stopPrice)) {
    return {
      ...tightStop,
      stopTightened: false,
      reason: 'Original stop invalid; using valid TIGHT_FVG boundary stop',
    };
  }

  const tightRisk = Math.abs(entryPrice - (tightStop.stopPrice as number));
  const originalRisk = Math.abs(entryPrice - (originalStop.stopPrice as number));
  if (tightRisk <= originalRisk) {
    return {
      ...tightStop,
      stopTightened: tightRisk < originalRisk,
      reason: tightRisk < originalRisk
        ? 'TIGHT_FVG selected nearer valid FVG/IFVG invalidation boundary'
        : 'TIGHT_FVG boundary equals original stop distance',
    };
  }

  return {
    ...originalStop,
    stopTightened: false,
    reason: 'TIGHT_FVG boundary was farther than original stop; using original stop',
  };
}

function validStopSide(signal: IctSignalAction, entryPrice: number, stopPrice: number | null): boolean {
  if (stopPrice === null || !Number.isFinite(stopPrice)) return false;
  if (signal === 'BUY') return stopPrice < entryPrice;
  if (signal === 'SELL') return stopPrice > entryPrice;
  return false;
}

function originStop(
  zone: IctSignalZone,
  signal: IctSignalAction,
  candles: readonly Candle[],
): { stopPrice: number | null; stopSource: StopSource | null } | null {
  if (signal !== 'BUY' && signal !== 'SELL') return null;

  if (zone.type === 'FVG') {
    const firstCandle = candles[zone.candle1Index];
    if (!firstCandle) return null;
    return signal === 'BUY'
      ? { stopPrice: firstCandle.low, stopSource: 'firstCandleLow' }
      : { stopPrice: firstCandle.high, stopSource: 'firstCandleHigh' };
  }

  const displacementCandle = candles[zone.inversionCandleIndex];
  if (!displacementCandle) return null;
  return signal === 'BUY'
    ? { stopPrice: displacementCandle.low, stopSource: 'displacementOrigin' }
    : { stopPrice: displacementCandle.high, stopSource: 'displacementOrigin' };
}

function zoneBoundaryStop(zone: IctSignalZone, signal: IctSignalAction): number | null {
  if (signal === 'BUY') return zone.low;
  if (signal === 'SELL') return zone.high;
  return null;
}

function zoneBoundaryStopSource(signal: IctSignalAction): StopSource | null {
  if (signal === 'BUY') return 'zoneLow';
  if (signal === 'SELL') return 'zoneHigh';
  return null;
}
