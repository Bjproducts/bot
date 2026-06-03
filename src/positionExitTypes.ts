export type PositionCloseReason =
  | 'TAKE_PROFIT'
  | 'MANAGED_TARGET_EXIT'
  | 'BREAKEVEN_STOP_EXIT'
  | 'QUICK_PROFIT_EXIT'
  | 'TIME_EXIT'
  | 'RISK_EXIT'
  | 'HARD_STOP_EXIT'
  | 'ENTRY_ZONE_DISRESPECT_EXIT';

export type ZoneBoundaryViolated = 'HIGH' | 'LOW';

export interface PositionExitSettings {
  takeProfitPct: number;
  profitTargetUsdMin: number;
  profitTargetUsdMax: number;
  maxPositionMinutes: number;
  maxLossUsd: number;
  useQuickProfitExit?: boolean;
}

export interface PositionExitEvaluation {
  shouldClose: boolean;
  reason: PositionCloseReason | null;
  unrealizedPnlUsd: number;
  takeProfitPrice: number;
  managedTargetPrice: number | null;
  breakevenStopPrice: number | null;
  hardStopPrice: number | null;
  quickProfitTargetMinUsd: number;
  quickProfitTargetMaxUsd: number;
  maxLossUsd: number;
  positionAgeMinutes: number | null;
  maxPositionMinutes: number;
}

export interface EntryZoneDisrespectEvaluation {
  shouldClose: boolean;
  reason: PositionCloseReason | null;
  entryZoneRespected: boolean | null;
  disrespectCandleClose: number | null;
  zoneBoundaryViolated: ZoneBoundaryViolated | null;
}

export interface HardStopEvaluation {
  shouldClose: boolean;
  reason: PositionCloseReason | null;
  hardStopPrice: number | null;
}

export interface PositionLifecycleExitEvaluation {
  shouldClose: boolean;
  reason: PositionCloseReason | null;
  hardStop: HardStopEvaluation;
  entryZoneDisrespect: EntryZoneDisrespectEvaluation;
  positionExit: PositionExitEvaluation;
}
