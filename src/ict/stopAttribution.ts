import { Candle } from '../signals/types';
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
}

export function resolveStopAttribution(input: {
  zone: IctSignalZone;
  signal: IctSignalAction;
  entryPrice: number;
  candles: readonly Candle[];
}): StopAttributionResult {
  const { zone, signal, entryPrice, candles } = input;
  const zoneSize = Math.abs(zone.high - zone.low);
  const zoneBoundaryStopPrice = zoneBoundaryStop(zone, signal);
  const stop = originStop(zone, signal, candles) ?? {
    stopPrice: zoneBoundaryStopPrice,
    stopSource: zoneBoundaryStopSource(signal),
  };
  const riskDistance = stop.stopPrice !== null
    ? Math.abs(entryPrice - stop.stopPrice)
    : null;
  const zoneBoundaryRiskDistance = zoneBoundaryStopPrice !== null
    ? Math.abs(entryPrice - zoneBoundaryStopPrice)
    : null;

  return {
    entryPrice,
    stopPrice: stop.stopPrice,
    stopSource: stop.stopSource,
    riskDistance,
    zoneSize,
    zoneBoundaryStopPrice,
    zoneBoundaryRiskDistance,
  };
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
