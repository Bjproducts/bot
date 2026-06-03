import * as fs from 'fs';
import * as path from 'path';
import { Candle } from '../signals/types';
import { FVGZone, IFVGZone, IctZoneBase } from './types';
import { detectFVGs } from './fvgDetector';
import { detectIFVGs } from './ifvgDetector';
import { evaluateReaction } from './reactionEngine';
import { IctReactionOutput, IctReactionResult } from './reactionTypes';
import { createIctSignal, DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE } from './ictSignalEngine';
import { IctSignalAction, IctSignalResult } from './ictSignalTypes';

const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_INPUT_DIR = path.join(ROOT_DIR, 'data', 'historical');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const ICT_REPLAY_REPORT_PATH = path.join(LOGS_DIR, 'ict-replay-report.json');

const REPLAY_REACTION_VOLUME = {
  enabled: true,
  lookback: 20,
  multiplier: 1.5,
  requiredForOutput: false,
};

interface NumericDistribution {
  count: number;
  min: number;
  max: number;
  average: number;
  median: number;
  p90: number;
  buckets: Record<string, number>;
}

interface DistributionSet {
  fvg: NumericDistribution;
  ifvg: NumericDistribution;
  combined: NumericDistribution;
}

interface ReactionAnalytics {
  totalZonesEvaluated: number;
  buyReactions: number;
  sellReactions: number;
  noneReactions: number;
  reactionFrequency: number;
  averageConfidence: number;
  confidenceDistribution: NumericDistribution;
  buyConfidenceDistribution: NumericDistribution;
  sellConfidenceDistribution: NumericDistribution;
  noneConfidenceDistribution: NumericDistribution;
  volumeConfirmationEnabled: boolean;
  volumeLookback: number;
  volumeMultiplier: number;
  volumeEvaluations: number;
  volumeConfirmedReactions: number;
  volumeConfirmedBuyReactions: number;
  volumeConfirmedSellReactions: number;
  volumeConfirmedNoneReactions: number;
  volumeConfirmationPassRate: number;
  volumeConfirmedReactionRate: number;
}

interface SignalTypeCounts {
  buy: number;
  sell: number;
  none: number;
}

interface SignalAnalytics {
  totalZonesEvaluated: number;
  totalBuySignals: number;
  totalSellSignals: number;
  totalNoneSignals: number;
  signalFrequency: number;
  averageSignalConfidence: number;
  confidenceDistribution: NumericDistribution;
  buyConfidenceDistribution: NumericDistribution;
  sellConfidenceDistribution: NumericDistribution;
  noneConfidenceDistribution: NumericDistribution;
  signalsByZoneType: Record<'FVG' | 'IFVG', SignalTypeCounts>;
  signalsByFVG: SignalTypeCounts;
  signalsByIFVG: SignalTypeCounts;
  rejectedByConfidenceThreshold: number;
  rejectedBecauseZoneInvalidated: number;
  minConfidence: number;
}

interface ReplayStats {
  candleCount: number;
  totalFVGs: number;
  totalIFVGs: number;
  bullishFVGs: number;
  bearishFVGs: number;
  bullishIFVGs: number;
  bearishIFVGs: number;
  filledFVGs: number;
  filledIFVGs: number;
  filledCombined: number;
  flippedFVGs: number;
  flippedIFVGs: number;
  flippedCombined: number;
  fvgFillRate: number;
  ifvgFillRate: number;
  combinedFillRate: number;
  fvgFlipRate: number;
  ifvgFlipRate: number;
  combinedFlipRate: number;
  averageFVGLifespanCandles: number;
  averageIFVGLifespanCandles: number;
  averageCombinedLifespanCandles: number;
  lifespanDistributionCandles: DistributionSet;
  lifespanDistributionMinutes: DistributionSet;
  timeToFillCandles: DistributionSet;
  timeToFillMinutes: DistributionSet;
  timeToFlipCandles: DistributionSet;
  timeToFlipMinutes: DistributionSet;
  reactionAnalytics: ReactionAnalytics;
  signalAnalytics: SignalAnalytics;
}

interface ReplayFileReport extends ReplayStats {
  inputPath: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface ReplayTotals extends ReplayStats {
  fileCount: number;
}

interface ReplayReport {
  generatedAt: string;
  inputPaths: string[];
  outputPath: string;
  files: ReplayFileReport[];
  totals: ReplayTotals;
}

interface ReplayFileAnalysis {
  report: ReplayFileReport;
  fvgTimings: ZoneTiming[];
  ifvgTimings: ZoneTiming[];
  fvgReactions: ZoneReactionObservation[];
  ifvgReactions: ZoneReactionObservation[];
}

interface ZoneTiming {
  type: 'FVG' | 'IFVG';
  direction: IctZoneBase['direction'];
  filled: boolean;
  flipped: boolean;
  lifespanCandles: number;
  lifespanMinutes: number;
  timeToFillCandles: number | null;
  timeToFillMinutes: number | null;
  timeToFlipCandles: number | null;
  timeToFlipMinutes: number | null;
}

interface ZoneReactionObservation {
  type: 'FVG' | 'IFVG';
  direction: IctZoneBase['direction'];
  output: IctReactionOutput;
  confidence: number;
  volumeEvaluated: boolean;
  volumeConfirmed: boolean;
  reactionResult: IctReactionResult;
  zone: FVGZone | IFVGZone;
}

interface ZoneSignalObservation {
  type: 'FVG' | 'IFVG';
  signal: IctSignalAction;
  confidence: number;
  reactionOutput: IctReactionOutput;
  reason: string;
  zoneInvalidated: boolean;
}

export function runHistoricalReplay(inputPaths: readonly string[]): ReplayReport {
  const resolvedInputs = resolveInputFiles(inputPaths);
  if (resolvedInputs.length === 0) {
    throw new Error(
      `No historical candle files found. Pass CSV/JSON files or place files in ${DEFAULT_INPUT_DIR}.`,
    );
  }

  const analyses = resolvedInputs.map(inputPath => replayFile(inputPath));
  const report: ReplayReport = {
    generatedAt: new Date().toISOString(),
    inputPaths: resolvedInputs,
    outputPath: ICT_REPLAY_REPORT_PATH,
    files: analyses.map(analysis => analysis.report),
    totals: aggregateReports(analyses),
  };

  ensureLogsDir();
  fs.writeFileSync(ICT_REPLAY_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const report = runHistoricalReplay(args);
    printReport(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ICT historical replay failed: ${message}`);
    console.error('Usage: npm run ict:replay -- <file-or-directory> [more files/directories]');
    process.exit(1);
  }
}

function replayFile(inputPath: string): ReplayFileAnalysis {
  const candles = readCandles(inputPath);
  const fvgs = detectFVGs(candles);
  const ifvgs = detectIFVGs(fvgs, candles);
  const fvgTimings = fvgs.map(zone => analyzeFVGTiming(zone, candles));
  const ifvgTimings = ifvgs.map(zone => analyzeIFVGTiming(zone, candles));
  const fvgReactions = fvgs.map(zone => analyzeFVGReaction(zone, candles));
  const ifvgReactions = ifvgs.map(zone => analyzeIFVGReaction(zone, candles));
  const stats = buildStats(candles.length, fvgs, ifvgs, fvgTimings, ifvgTimings, fvgReactions, ifvgReactions);

  return {
    report: {
      inputPath,
      startedAt: candles[0]?.timestamp.toISOString() ?? null,
      endedAt: candles[candles.length - 1]?.timestamp.toISOString() ?? null,
      ...stats,
    },
    fvgTimings,
    ifvgTimings,
    fvgReactions,
    ifvgReactions,
  };
}

function buildStats(
  candleCount: number,
  fvgs: readonly FVGZone[],
  ifvgs: readonly IFVGZone[],
  fvgTimings: readonly ZoneTiming[],
  ifvgTimings: readonly ZoneTiming[],
  fvgReactions: readonly ZoneReactionObservation[],
  ifvgReactions: readonly ZoneReactionObservation[],
): ReplayStats {
  const combinedTimings = [...fvgTimings, ...ifvgTimings];
  const combinedReactions = [...fvgReactions, ...ifvgReactions];
  const signalObservations = combinedReactions.map(reaction => signalObservation(reaction));
  const filledFVGs = fvgTimings.filter(timing => timing.filled).length;
  const filledIFVGs = ifvgTimings.filter(timing => timing.filled).length;
  const flippedFVGs = fvgTimings.filter(timing => timing.flipped).length;
  const flippedIFVGs = ifvgTimings.filter(timing => timing.flipped).length;

  return {
    candleCount,
    totalFVGs: fvgs.length,
    totalIFVGs: ifvgs.length,
    bullishFVGs: countDirection(fvgs, 'BULLISH'),
    bearishFVGs: countDirection(fvgs, 'BEARISH'),
    bullishIFVGs: countDirection(ifvgs, 'BULLISH'),
    bearishIFVGs: countDirection(ifvgs, 'BEARISH'),
    filledFVGs,
    filledIFVGs,
    filledCombined: filledFVGs + filledIFVGs,
    flippedFVGs,
    flippedIFVGs,
    flippedCombined: flippedFVGs + flippedIFVGs,
    fvgFillRate: rate(filledFVGs, fvgs.length),
    ifvgFillRate: rate(filledIFVGs, ifvgs.length),
    combinedFillRate: rate(filledFVGs + filledIFVGs, fvgs.length + ifvgs.length),
    fvgFlipRate: rate(flippedFVGs, fvgs.length),
    ifvgFlipRate: rate(flippedIFVGs, ifvgs.length),
    combinedFlipRate: rate(flippedFVGs + flippedIFVGs, fvgs.length + ifvgs.length),
    averageFVGLifespanCandles: average(fvgTimings.map(timing => timing.lifespanCandles)),
    averageIFVGLifespanCandles: average(ifvgTimings.map(timing => timing.lifespanCandles)),
    averageCombinedLifespanCandles: average(combinedTimings.map(timing => timing.lifespanCandles)),
    lifespanDistributionCandles: distributionSet(fvgTimings, ifvgTimings, 'lifespanCandles'),
    lifespanDistributionMinutes: distributionSet(fvgTimings, ifvgTimings, 'lifespanMinutes'),
    timeToFillCandles: distributionSet(fvgTimings, ifvgTimings, 'timeToFillCandles'),
    timeToFillMinutes: distributionSet(fvgTimings, ifvgTimings, 'timeToFillMinutes'),
    timeToFlipCandles: distributionSet(fvgTimings, ifvgTimings, 'timeToFlipCandles'),
    timeToFlipMinutes: distributionSet(fvgTimings, ifvgTimings, 'timeToFlipMinutes'),
    reactionAnalytics: reactionAnalytics(combinedReactions),
    signalAnalytics: signalAnalytics(signalObservations),
  };
}

function aggregateReports(analyses: readonly ReplayFileAnalysis[]): ReplayTotals {
  const reports = analyses.map(analysis => analysis.report);
  const allFvgTimings = analyses.flatMap(analysis => analysis.fvgTimings);
  const allIfvgTimings = analyses.flatMap(analysis => analysis.ifvgTimings);
  const allFvgReactions = analyses.flatMap(analysis => analysis.fvgReactions);
  const allIfvgReactions = analyses.flatMap(analysis => analysis.ifvgReactions);
  const allReactions = [...allFvgReactions, ...allIfvgReactions];
  const allSignals = allReactions.map(reaction => signalObservation(reaction));

  return {
    fileCount: analyses.length,
    candleCount: reports.reduce((sum, file) => sum + file.candleCount, 0),
    totalFVGs: reports.reduce((sum, file) => sum + file.totalFVGs, 0),
    totalIFVGs: reports.reduce((sum, file) => sum + file.totalIFVGs, 0),
    bullishFVGs: reports.reduce((sum, file) => sum + file.bullishFVGs, 0),
    bearishFVGs: reports.reduce((sum, file) => sum + file.bearishFVGs, 0),
    bullishIFVGs: reports.reduce((sum, file) => sum + file.bullishIFVGs, 0),
    bearishIFVGs: reports.reduce((sum, file) => sum + file.bearishIFVGs, 0),
    filledFVGs: allFvgTimings.filter(timing => timing.filled).length,
    filledIFVGs: allIfvgTimings.filter(timing => timing.filled).length,
    filledCombined: [...allFvgTimings, ...allIfvgTimings].filter(timing => timing.filled).length,
    flippedFVGs: allFvgTimings.filter(timing => timing.flipped).length,
    flippedIFVGs: allIfvgTimings.filter(timing => timing.flipped).length,
    flippedCombined: [...allFvgTimings, ...allIfvgTimings].filter(timing => timing.flipped).length,
    fvgFillRate: rate(allFvgTimings.filter(timing => timing.filled).length, allFvgTimings.length),
    ifvgFillRate: rate(allIfvgTimings.filter(timing => timing.filled).length, allIfvgTimings.length),
    combinedFillRate: rate(
      [...allFvgTimings, ...allIfvgTimings].filter(timing => timing.filled).length,
      allFvgTimings.length + allIfvgTimings.length,
    ),
    fvgFlipRate: rate(allFvgTimings.filter(timing => timing.flipped).length, allFvgTimings.length),
    ifvgFlipRate: rate(allIfvgTimings.filter(timing => timing.flipped).length, allIfvgTimings.length),
    combinedFlipRate: rate(
      [...allFvgTimings, ...allIfvgTimings].filter(timing => timing.flipped).length,
      allFvgTimings.length + allIfvgTimings.length,
    ),
    averageFVGLifespanCandles: average(allFvgTimings.map(timing => timing.lifespanCandles)),
    averageIFVGLifespanCandles: average(allIfvgTimings.map(timing => timing.lifespanCandles)),
    averageCombinedLifespanCandles: average(
      [...allFvgTimings, ...allIfvgTimings].map(timing => timing.lifespanCandles),
    ),
    lifespanDistributionCandles: distributionSet(allFvgTimings, allIfvgTimings, 'lifespanCandles'),
    lifespanDistributionMinutes: distributionSet(allFvgTimings, allIfvgTimings, 'lifespanMinutes'),
    timeToFillCandles: distributionSet(allFvgTimings, allIfvgTimings, 'timeToFillCandles'),
    timeToFillMinutes: distributionSet(allFvgTimings, allIfvgTimings, 'timeToFillMinutes'),
    timeToFlipCandles: distributionSet(allFvgTimings, allIfvgTimings, 'timeToFlipCandles'),
    timeToFlipMinutes: distributionSet(allFvgTimings, allIfvgTimings, 'timeToFlipMinutes'),
    reactionAnalytics: reactionAnalytics(allReactions),
    signalAnalytics: signalAnalytics(allSignals),
  };
}

function analyzeFVGTiming(zone: FVGZone, candles: readonly Candle[]): ZoneTiming {
  let fillIndex: number | null = null;
  let flipIndex: number | null = null;

  for (let i = zone.candle3Index + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;

    if (fillIndex === null && isFVGFill(zone, candle)) fillIndex = i;
    if (flipIndex === null && isFVGFlip(zone, candle)) flipIndex = i;
    if (fillIndex !== null && flipIndex !== null) break;
  }

  return zoneTiming(
    'FVG',
    zone.direction,
    zone.candle3Index,
    fillIndex,
    flipIndex,
    candles,
  );
}

function analyzeIFVGTiming(zone: IFVGZone, candles: readonly Candle[]): ZoneTiming {
  let fillIndex: number | null = null;
  let flipIndex: number | null = null;

  for (let i = zone.inversionCandleIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;

    if (fillIndex === null && isIFVGFill(zone, candle)) fillIndex = i;
    if (flipIndex === null && isIFVGFlip(zone, candle)) flipIndex = i;
    if (fillIndex !== null && flipIndex !== null) break;
  }

  return zoneTiming(
    'IFVG',
    zone.direction,
    zone.inversionCandleIndex,
    fillIndex,
    flipIndex,
    candles,
  );
}

function analyzeFVGReaction(zone: FVGZone, candles: readonly Candle[]): ZoneReactionObservation {
  return analyzeZoneReaction(
    'FVG',
    zone,
    zone.candle3Index,
    candles,
  );
}

function analyzeIFVGReaction(zone: IFVGZone, candles: readonly Candle[]): ZoneReactionObservation {
  return analyzeZoneReaction(
    'IFVG',
    zone,
    zone.inversionCandleIndex,
    candles,
  );
}

function analyzeZoneReaction(
  type: ZoneReactionObservation['type'],
  zone: FVGZone | IFVGZone,
  createdIndex: number,
  candles: readonly Candle[],
): ZoneReactionObservation {
  let latestNone: IctReactionResult | null = null;
  const reactionZone = { ...zone, invalidated: false, filled: false, flipped: false };

  for (let i = createdIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;

    const result = evaluateReaction({
      zone: reactionZone,
      candles: candles.slice(0, i + 1),
      currentPrice: candle.close,
      options: {
        volume: REPLAY_REACTION_VOLUME,
      },
    });

    if (result.output !== 'NONE') {
      return reactionObservation(type, zone, result);
    }

    latestNone = result;
  }

  if (latestNone) {
    return reactionObservation(type, zone, latestNone);
  }

  return {
    type,
    direction: zone.direction,
    output: 'NONE',
    confidence: 0,
    volumeEvaluated: false,
    volumeConfirmed: false,
    reactionResult: {
      zoneId: zone.id,
      zoneDirection: zone.direction,
      reaction: 'NO_REACTION',
      output: 'NONE',
      confidence: 0,
      currentPrice: candles[createdIndex]?.close ?? 0,
      evaluatedAt: candles[createdIndex]?.timestamp.toISOString() ?? null,
      checks: {
        returnToZone: { status: 'FAIL', passed: false, detail: 'No future candles for reaction evaluation' },
        midpointInteraction: { status: 'NOT_EVALUATED', passed: false, detail: 'Not evaluated' },
        bodyCloseConfirmation: { status: 'NOT_EVALUATED', passed: false, detail: 'Not evaluated' },
        volumeConfirmation: { status: 'NOT_EVALUATED', passed: false, detail: 'Not evaluated' },
      },
      reasons: ['No future candles for reaction evaluation'],
      reactionType: 'NONE',
      midpointResult: 'NOT_EVALUATED',
      boundaryCloseResult: 'NOT_EVALUATED',
      displacementReaction: 'NONE',
      reactionWinner: 'NONE',
      reactionScore: 0,
    },
    zone,
  };
}

function reactionObservation(
  type: ZoneReactionObservation['type'],
  zone: FVGZone | IFVGZone,
  result: IctReactionResult,
): ZoneReactionObservation {
  return {
    type,
    direction: zone.direction,
    output: result.output,
    confidence: result.confidence,
    volumeEvaluated: result.checks.volumeConfirmation.status !== 'NOT_EVALUATED',
    volumeConfirmed: result.checks.volumeConfirmation.passed,
    reactionResult: result,
    zone,
  };
}

function reactionAnalytics(observations: readonly ZoneReactionObservation[]): ReactionAnalytics {
  const buyReactions = countOutput(observations, 'BUY');
  const sellReactions = countOutput(observations, 'SELL');
  const noneReactions = countOutput(observations, 'NONE');
  const reacted = buyReactions + sellReactions;
  const volumeEvaluations = observations.filter(observation => observation.volumeEvaluated).length;
  const volumeConfirmed = observations.filter(observation => observation.volumeConfirmed);
  const volumeConfirmedReactions = volumeConfirmed.filter(observation => observation.output !== 'NONE');

  return {
    totalZonesEvaluated: observations.length,
    buyReactions,
    sellReactions,
    noneReactions,
    reactionFrequency: rate(reacted, observations.length),
    averageConfidence: average(observations.map(observation => observation.confidence)),
    confidenceDistribution: confidenceDistributionFor(observations.map(observation => observation.confidence)),
    buyConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.output === 'BUY').map(observation => observation.confidence),
    ),
    sellConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.output === 'SELL').map(observation => observation.confidence),
    ),
    noneConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.output === 'NONE').map(observation => observation.confidence),
    ),
    volumeConfirmationEnabled: REPLAY_REACTION_VOLUME.enabled,
    volumeLookback: REPLAY_REACTION_VOLUME.lookback,
    volumeMultiplier: REPLAY_REACTION_VOLUME.multiplier,
    volumeEvaluations,
    volumeConfirmedReactions: volumeConfirmedReactions.length,
    volumeConfirmedBuyReactions: volumeConfirmedReactions.filter(observation => observation.output === 'BUY').length,
    volumeConfirmedSellReactions: volumeConfirmedReactions.filter(observation => observation.output === 'SELL').length,
    volumeConfirmedNoneReactions: volumeConfirmed.filter(observation => observation.output === 'NONE').length,
    volumeConfirmationPassRate: rate(volumeConfirmed.length, volumeEvaluations),
    volumeConfirmedReactionRate: rate(volumeConfirmedReactions.length, reacted),
  };
}

function signalObservation(observation: ZoneReactionObservation): ZoneSignalObservation {
  const signal = createIctSignal({
    zone: observation.zone,
    reaction: observation.reactionResult,
    options: {
      minConfidence: DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE,
    },
  });

  return {
    type: observation.type,
    signal: signal.signal,
    confidence: signal.confidence,
    reactionOutput: signal.reactionOutput,
    reason: signal.reason,
    zoneInvalidated: observation.zone.invalidated,
  };
}

function signalAnalytics(observations: readonly ZoneSignalObservation[]): SignalAnalytics {
  const totalBuySignals = countSignal(observations, 'BUY');
  const totalSellSignals = countSignal(observations, 'SELL');
  const totalNoneSignals = countSignal(observations, 'NONE');
  const acceptedSignals = totalBuySignals + totalSellSignals;
  const fvgSignals = observations.filter(observation => observation.type === 'FVG');
  const ifvgSignals = observations.filter(observation => observation.type === 'IFVG');

  return {
    totalZonesEvaluated: observations.length,
    totalBuySignals,
    totalSellSignals,
    totalNoneSignals,
    signalFrequency: rate(acceptedSignals, observations.length),
    averageSignalConfidence: average(observations.map(observation => observation.confidence)),
    confidenceDistribution: confidenceDistributionFor(observations.map(observation => observation.confidence)),
    buyConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.signal === 'BUY').map(observation => observation.confidence),
    ),
    sellConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.signal === 'SELL').map(observation => observation.confidence),
    ),
    noneConfidenceDistribution: confidenceDistributionFor(
      observations.filter(observation => observation.signal === 'NONE').map(observation => observation.confidence),
    ),
    signalsByZoneType: {
      FVG: signalTypeCounts(fvgSignals),
      IFVG: signalTypeCounts(ifvgSignals),
    },
    signalsByFVG: signalTypeCounts(fvgSignals),
    signalsByIFVG: signalTypeCounts(ifvgSignals),
    rejectedByConfidenceThreshold: observations.filter(isConfidenceRejection).length,
    rejectedBecauseZoneInvalidated: observations.filter(observation => observation.reason === 'Zone is invalidated').length,
    minConfidence: DEFAULT_ICT_SIGNAL_MIN_CONFIDENCE,
  };
}

function signalTypeCounts(observations: readonly ZoneSignalObservation[]): SignalTypeCounts {
  return {
    buy: countSignal(observations, 'BUY'),
    sell: countSignal(observations, 'SELL'),
    none: countSignal(observations, 'NONE'),
  };
}

function isConfidenceRejection(observation: ZoneSignalObservation): boolean {
  return observation.signal === 'NONE'
    && (observation.reactionOutput === 'BUY' || observation.reactionOutput === 'SELL')
    && observation.reason.includes('below minimum');
}

function zoneTiming(
  type: ZoneTiming['type'],
  direction: IctZoneBase['direction'],
  createdIndex: number,
  fillIndex: number | null,
  flipIndex: number | null,
  candles: readonly Candle[],
): ZoneTiming {
  const terminalIndex = earliestIndex(fillIndex, flipIndex) ?? candles.length - 1;
  const lifespanCandles = Math.max(terminalIndex - createdIndex, 0);

  return {
    type,
    direction,
    filled: fillIndex !== null,
    flipped: flipIndex !== null,
    lifespanCandles,
    lifespanMinutes: minutesBetween(candles, createdIndex, terminalIndex),
    timeToFillCandles: fillIndex === null ? null : Math.max(fillIndex - createdIndex, 0),
    timeToFillMinutes: fillIndex === null ? null : minutesBetween(candles, createdIndex, fillIndex),
    timeToFlipCandles: flipIndex === null ? null : Math.max(flipIndex - createdIndex, 0),
    timeToFlipMinutes: flipIndex === null ? null : minutesBetween(candles, createdIndex, flipIndex),
  };
}

function readCandles(inputPath: string): Candle[] {
  const ext = path.extname(inputPath).toLowerCase();
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const candles = ext === '.json' ? parseJsonCandles(raw, inputPath) : parseCsvCandles(raw, inputPath);

  return candles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function parseJsonCandles(raw: string, inputPath: string): Candle[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${inputPath} must contain a JSON array of OHLCV candle objects or arrays`);
  }

  return parsed.map((row, index) => {
    if (Array.isArray(row)) {
      return candleFromArray(row, inputPath, index);
    }
    return candleFromRecord(asRecord(row, inputPath, index), inputPath, index);
  });
}

function parseCsvCandles(raw: string, inputPath: string): Candle[] {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length < 2) {
    throw new Error(`${inputPath} must contain a header row and at least one candle row`);
  }

  const headers = splitCsvLine(lines[0]!).map(header => normalizeKey(header));
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const record: Record<string, unknown> = {};
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex];
    });
    return candleFromRecord(record, inputPath, index + 1);
  });
}

function candleFromArray(row: unknown[], inputPath: string, index: number): Candle {
  if (row.length < 6) {
    throw new Error(`${inputPath} row ${index} must have [timestamp, open, high, low, close, volume]`);
  }

  return validateCandle({
    timestamp: new Date(String(row[0])),
    open: parseNumber(row[1]),
    high: parseNumber(row[2]),
    low: parseNumber(row[3]),
    close: parseNumber(row[4]),
    volume: parseNumber(row[5]),
  }, inputPath, index);
}

function candleFromRecord(record: Record<string, unknown>, inputPath: string, index: number): Candle {
  const timestampValue = pick(record, ['timestamp', 'time', 'date', 'datetime', 'open_time']);
  return validateCandle({
    timestamp: new Date(String(timestampValue)),
    open: numberField(record, 'open'),
    high: numberField(record, 'high'),
    low: numberField(record, 'low'),
    close: numberField(record, 'close'),
    volume: numberField(record, 'volume'),
  }, inputPath, index);
}

function validateCandle(candle: Candle, inputPath: string, index: number): Candle {
  if (Number.isNaN(candle.timestamp.getTime())) {
    throw new Error(`${inputPath} row ${index} has an invalid timestamp`);
  }

  if (!isValidCandle(candle)) {
    throw new Error(`${inputPath} row ${index} has invalid OHLCV values`);
  }

  return candle;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}

function resolveInputFiles(inputPaths: readonly string[]): string[] {
  const candidates = inputPaths.length > 0 ? inputPaths : [DEFAULT_INPUT_DIR];
  const files: string[] = [];

  for (const candidate of candidates) {
    const resolved = path.resolve(ROOT_DIR, candidate);
    if (!fs.existsSync(resolved)) continue;

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      collectSupportedFiles(resolved, files);
    } else if (isSupportedCandleFile(resolved)) {
      files.push(resolved);
    }
  }

  return Array.from(new Set(files)).sort();
}

function collectSupportedFiles(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      collectSupportedFiles(entryPath, files);
    } else if (isSupportedCandleFile(entryPath)) {
      files.push(entryPath);
    }
  }
}

function distributionSet(
  fvgTimings: readonly ZoneTiming[],
  ifvgTimings: readonly ZoneTiming[],
  key: keyof Pick<
    ZoneTiming,
    | 'lifespanCandles'
    | 'lifespanMinutes'
    | 'timeToFillCandles'
    | 'timeToFillMinutes'
    | 'timeToFlipCandles'
    | 'timeToFlipMinutes'
  >,
): DistributionSet {
  const fvgValues = valuesFor(fvgTimings, key);
  const ifvgValues = valuesFor(ifvgTimings, key);
  return {
    fvg: distribution(fvgValues),
    ifvg: distribution(ifvgValues),
    combined: distribution([...fvgValues, ...ifvgValues]),
  };
}

function valuesFor(timings: readonly ZoneTiming[], key: keyof ZoneTiming): number[] {
  return timings
    .map(timing => timing[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function distribution(values: readonly number[]): NumericDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted.length > 0 ? round(sorted[0]!) : 0,
    max: sorted.length > 0 ? round(sorted[sorted.length - 1]!) : 0,
    average: average(sorted),
    median: median(sorted),
    p90: percentile(sorted, 0.9),
    buckets: bucketValues(sorted),
  };
}

function confidenceDistributionFor(values: readonly number[]): NumericDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted.length > 0 ? round(sorted[0]!) : 0,
    max: sorted.length > 0 ? round(sorted[sorted.length - 1]!) : 0,
    average: average(sorted),
    median: median(sorted),
    p90: percentile(sorted, 0.9),
    buckets: bucketConfidence(sorted),
  };
}

function bucketValues(values: readonly number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    '0': 0,
    '1': 0,
    '2-3': 0,
    '4-10': 0,
    '11-50': 0,
    '51-200': 0,
    '201+': 0,
  };

  for (const value of values) {
    if (value <= 0) buckets['0']!++;
    else if (value <= 1) buckets['1']!++;
    else if (value <= 3) buckets['2-3']!++;
    else if (value <= 10) buckets['4-10']!++;
    else if (value <= 50) buckets['11-50']!++;
    else if (value <= 200) buckets['51-200']!++;
    else buckets['201+']!++;
  }

  return buckets;
}

function bucketConfidence(values: readonly number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    '0': 0,
    '1-25': 0,
    '26-50': 0,
    '51-75': 0,
    '76-100': 0,
  };

  for (const value of values) {
    if (value <= 0) buckets['0']!++;
    else if (value <= 25) buckets['1-25']!++;
    else if (value <= 50) buckets['26-50']!++;
    else if (value <= 75) buckets['51-75']!++;
    else buckets['76-100']!++;
  }

  return buckets;
}

function isFVGFill(zone: FVGZone, candle: Candle): boolean {
  return zone.direction === 'BULLISH'
    ? candle.low <= zone.low
    : candle.high >= zone.high;
}

function isFVGFlip(zone: FVGZone, candle: Candle): boolean {
  return zone.direction === 'BULLISH'
    ? candle.close < zone.low
    : candle.close > zone.high;
}

function isIFVGFill(zone: IFVGZone, candle: Candle): boolean {
  return candle.low <= zone.high && candle.high >= zone.low;
}

function isIFVGFlip(zone: IFVGZone, candle: Candle): boolean {
  return zone.direction === 'BULLISH'
    ? candle.close < zone.low
    : candle.close > zone.high;
}

function printReport(report: ReplayReport): void {
  const totals = report.totals;

  console.log('ICT historical replay complete');
  console.log(`Files processed: ${totals.fileCount}`);
  console.log(`Report: ${report.outputPath}`);
  console.log(`Total candles: ${totals.candleCount}`);
  console.log(`Total FVGs: ${totals.totalFVGs}`);
  console.log(`Bullish FVGs: ${totals.bullishFVGs}`);
  console.log(`Bearish FVGs: ${totals.bearishFVGs}`);
  console.log(`Total IFVGs: ${totals.totalIFVGs}`);
  console.log(`Bullish IFVGs: ${totals.bullishIFVGs}`);
  console.log(`Bearish IFVGs: ${totals.bearishIFVGs}`);
  console.log(`Combined fill rate: ${formatPercent(totals.combinedFillRate)}`);
  console.log(`Combined flip rate: ${formatPercent(totals.combinedFlipRate)}`);
  console.log(`Average FVG lifespan: ${formatNumber(totals.averageFVGLifespanCandles)} candles`);
  console.log(`Average IFVG lifespan: ${formatNumber(totals.averageIFVGLifespanCandles)} candles`);
  console.log(`Average combined lifespan: ${formatNumber(totals.averageCombinedLifespanCandles)} candles`);
  console.log(`Lifespan distribution: ${formatDistribution(totals.lifespanDistributionCandles.combined)} candles`);
  console.log(`Time-to-fill distribution: ${formatDistribution(totals.timeToFillCandles.combined)} candles`);
  console.log(`Time-to-flip distribution: ${formatDistribution(totals.timeToFlipCandles.combined)} candles`);
  console.log(`BUY reactions: ${totals.reactionAnalytics.buyReactions}`);
  console.log(`SELL reactions: ${totals.reactionAnalytics.sellReactions}`);
  console.log(`NONE reactions: ${totals.reactionAnalytics.noneReactions}`);
  console.log(`Reaction frequency: ${formatPercent(totals.reactionAnalytics.reactionFrequency)}`);
  console.log(`Average reaction confidence: ${formatNumber(totals.reactionAnalytics.averageConfidence)}`);
  console.log(`Confidence distribution: ${formatDistribution(totals.reactionAnalytics.confidenceDistribution)}`);
  console.log(`Volume-confirmed reactions: ${totals.reactionAnalytics.volumeConfirmedReactions}`);
  console.log(`Volume confirmation pass rate: ${formatPercent(totals.reactionAnalytics.volumeConfirmationPassRate)}`);
  console.log(`BUY signals: ${totals.signalAnalytics.totalBuySignals}`);
  console.log(`SELL signals: ${totals.signalAnalytics.totalSellSignals}`);
  console.log(`NONE signals: ${totals.signalAnalytics.totalNoneSignals}`);
  console.log(`Signal frequency: ${formatPercent(totals.signalAnalytics.signalFrequency)}`);
  console.log(`Average signal confidence: ${formatNumber(totals.signalAnalytics.averageSignalConfidence)}`);
  console.log(`Signal confidence distribution: ${formatDistribution(totals.signalAnalytics.confidenceDistribution)}`);
  console.log(`Signals rejected by confidence: ${totals.signalAnalytics.rejectedByConfidenceThreshold}`);
  console.log(`Signals rejected by invalidated zone: ${totals.signalAnalytics.rejectedBecauseZoneInvalidated}`);
}

function isSupportedCandleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.csv' || ext === '.json';
}

function asRecord(value: unknown, inputPath: string, index: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${inputPath} row ${index} must be an object`);
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    normalized[normalizeKey(key)] = recordValue;
  }
  return normalized;
}

function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  return parseNumber(record[normalizeKey(key)]);
}

function parseNumber(value: unknown): number {
  return typeof value === 'number' ? value : parseFloat(String(value));
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isValidCandle(candle: Candle): boolean {
  return Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && Number.isFinite(candle.volume)
    && candle.high >= candle.low
    && candle.timestamp instanceof Date
    && !Number.isNaN(candle.timestamp.getTime());
}

function countDirection(zones: readonly IctZoneBase[], direction: IctZoneBase['direction']): number {
  return zones.filter(zone => zone.direction === direction).length;
}

function countOutput(observations: readonly ZoneReactionObservation[], output: IctReactionOutput): number {
  return observations.filter(observation => observation.output === output).length;
}

function countSignal(observations: readonly ZoneSignalObservation[], signal: IctSignalAction): number {
  return observations.filter(observation => observation.signal === signal).length;
}

function earliestIndex(...indexes: Array<number | null>): number | null {
  const validIndexes = indexes.filter((index): index is number => typeof index === 'number');
  return validIndexes.length > 0 ? Math.min(...validIndexes) : null;
}

function minutesBetween(candles: readonly Candle[], fromIndex: number, toIndex: number): number {
  const from = candles[fromIndex];
  const to = candles[toIndex];
  if (!from || !to) return 0;
  return round((to.timestamp.getTime() - from.timestamp.getTime()) / 60_000);
}

function rate(count: number, total: number): number {
  return total > 0 ? round((count / total) * 100) : 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return round((values[mid - 1]! + values[mid]!) / 2);
  }
  return round(values[mid]!);
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.ceil(values.length * p) - 1);
  return round(values[index]!);
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

function formatDistribution(distributionValue: NumericDistribution): string {
  return `count=${distributionValue.count} min=${formatNumber(distributionValue.min)} median=${formatNumber(distributionValue.median)} p90=${formatNumber(distributionValue.p90)} max=${formatNumber(distributionValue.max)}`;
}

function formatNumber(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}
