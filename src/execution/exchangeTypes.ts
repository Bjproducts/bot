export const LIVE_ARM_CONFIRMATION = 'I_UNDERSTAND_REAL_MONEY_RISK';

export type LiveOrderSide = 'BUY' | 'SELL';
export type LivePositionSide = 'LONG' | 'SHORT';
export type LiveOrderAction = 'OPEN' | 'CLOSE';
export type LiveOrderType = 'MARKET' | 'LIMIT';
export type LiveOrderStatus = 'ACCEPTED' | 'REJECTED' | 'FILLED' | 'CANCELED' | 'FAILED';

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase?: string;
}

export interface ExchangeAccountInfo {
  exchangeName: string;
  accountId?: string;
  balances?: Record<string, number>;
  raw?: unknown;
}

export interface ExchangePosition {
  symbol: string;
  side: LivePositionSide;
  sizeUsd: number;
  avgEntryPrice?: number;
  unrealizedPnlUsd?: number;
  raw?: unknown;
}

export interface ExchangeHealth {
  ok: boolean;
  message: string;
  checkedAt: string;
}

export interface LiveOrderRequest {
  symbol: string;
  side: LiveOrderSide;
  action: LiveOrderAction;
  orderType: LiveOrderType;
  requestedSizeUsd: number;
  requestedPrice?: number;
  reason: string;
  signalId?: string;
  exitLogicPresent?: boolean;
}

export interface LiveOrderResponse {
  timestamp: string;
  symbol: string;
  side: LiveOrderSide;
  action: LiveOrderAction;
  orderType: LiveOrderType;
  requestedSizeUsd: number;
  executedSizeUsd: number;
  requestedPrice?: number;
  executedPrice?: number;
  status: LiveOrderStatus;
  exchangeOrderId: string;
  reason: string;
  raw?: unknown;
}

export interface SafetyGateResult {
  passed: boolean;
  failures: string[];
  checkedAt: string;
}

export interface LiveExecutionState {
  dailyLiveTrades: number;
  dailyLivePnlUsd: number;
  hasOpenLivePosition: boolean;
  openPositionSide?: LivePositionSide;
}

export interface LiveExecutionResult {
  accepted: boolean;
  order: LiveOrderResponse;
  safetyGateResult: SafetyGateResult;
}
