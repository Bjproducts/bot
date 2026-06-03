import { BotConfig } from '../types';
import { ExchangeAdapter } from './exchangeAdapter';
import {
  LIVE_ARM_CONFIRMATION,
  LiveExecutionResult,
  LiveExecutionState,
  LiveOrderRequest,
  LiveOrderResponse,
  LivePositionSide,
  SafetyGateResult,
} from './exchangeTypes';
import { LiveOrderJournal } from './liveOrderJournal';

export class LiveExecutionManager {
  constructor(
    private readonly config: BotConfig,
    private readonly adapter: ExchangeAdapter,
    private readonly journal: LiveOrderJournal = new LiveOrderJournal(),
  ) {}

  async execute(
    request: LiveOrderRequest,
    state: LiveExecutionState,
  ): Promise<LiveExecutionResult> {
    const safetyGateResult = this.evaluateSafetyGates(request, state);

    if (!safetyGateResult.passed) {
      const rejectedOrder = this.makeRejectedOrder(request, safetyGateResult);
      this.journal.log({ ...rejectedOrder, safetyGateResult });
      return {
        accepted: false,
        order: rejectedOrder,
        safetyGateResult,
      };
    }

    try {
      const order = await this.submitOnce(request);
      this.journal.log({ ...order, safetyGateResult });
      return {
        accepted: true,
        order,
        safetyGateResult,
      };
    } catch (err) {
      const failedOrder = this.makeFailedOrder(request, err);
      this.journal.log({ ...failedOrder, safetyGateResult });
      return {
        accepted: false,
        order: failedOrder,
        safetyGateResult,
      };
    }
  }

  evaluateSafetyGates(
    request: LiveOrderRequest,
    state: LiveExecutionState,
  ): SafetyGateResult {
    const failures: string[] = [];

    if (this.config.botMode !== 'live') {
      failures.push('BOT_MODE_NOT_LIVE');
    }
    if (!this.config.liveTradingEnabled) {
      failures.push('LIVE_TRADING_DISABLED');
    }
    if (
      this.config.requireManualArm
      && this.config.liveArmConfirm !== LIVE_ARM_CONFIRMATION
    ) {
      failures.push('MANUAL_ARM_NOT_CONFIRMED');
    }
    if (!this.config.exchangeApiKey || !this.config.exchangeApiSecret) {
      failures.push('MISSING_API_CREDENTIALS');
    }
    if (request.requestedSizeUsd > this.config.maxLiveOrderSizeUsd) {
      failures.push('ORDER_SIZE_EXCEEDS_MAX');
    }
    if (state.dailyLivePnlUsd <= -this.config.maxDailyLossUsd) {
      failures.push('MAX_DAILY_LOSS_REACHED');
    }
    if (state.dailyLiveTrades >= this.config.maxDailyTrades) {
      failures.push('MAX_DAILY_TRADES_REACHED');
    }
    if (request.action === 'OPEN' && state.hasOpenLivePosition) {
      failures.push('DUPLICATE_OPEN_LIVE_POSITION');
    }
    if (request.side === 'SELL' && request.action === 'OPEN' && !this.config.allowShorts) {
      failures.push('SHORTS_NOT_ALLOWED');
    }
    if (request.action === 'OPEN' && !request.exitLogicPresent) {
      failures.push('EXIT_LOGIC_NOT_CONFIRMED');
    }
    if (!this.positionSideMatchesSignal(request, state)) {
      failures.push('POSITION_SIDE_MISMATCH');
    }

    return {
      passed: failures.length === 0,
      failures,
      checkedAt: new Date().toISOString(),
    };
  }

  private async submitOnce(request: LiveOrderRequest): Promise<LiveOrderResponse> {
    if (request.action === 'CLOSE') {
      return this.adapter.closePosition(request);
    }

    if (request.orderType === 'LIMIT') {
      return this.adapter.placeLimitOrder(request);
    }

    return this.adapter.placeMarketOrder(request);
  }

  private positionSideMatchesSignal(
    request: LiveOrderRequest,
    state: LiveExecutionState,
  ): boolean {
    const requestPositionSide = sideFromOrderSide(request.side);

    if (request.action === 'OPEN') {
      return requestPositionSide !== null;
    }

    return state.hasOpenLivePosition && state.openPositionSide !== undefined;
  }

  private makeRejectedOrder(
    request: LiveOrderRequest,
    safetyGateResult: SafetyGateResult,
  ): LiveOrderResponse {
    return {
      timestamp: new Date().toISOString(),
      symbol: request.symbol,
      side: request.side,
      action: request.action,
      orderType: request.orderType,
      requestedSizeUsd: request.requestedSizeUsd,
      executedSizeUsd: 0,
      requestedPrice: request.requestedPrice,
      status: 'REJECTED',
      exchangeOrderId: '',
      reason: safetyGateResult.failures.join('|') || request.reason,
    };
  }

  private makeFailedOrder(request: LiveOrderRequest, err: unknown): LiveOrderResponse {
    const message = err instanceof Error ? err.message : String(err);
    return {
      timestamp: new Date().toISOString(),
      symbol: request.symbol,
      side: request.side,
      action: request.action,
      orderType: request.orderType,
      requestedSizeUsd: request.requestedSizeUsd,
      executedSizeUsd: 0,
      requestedPrice: request.requestedPrice,
      status: 'FAILED',
      exchangeOrderId: '',
      reason: message,
    };
  }
}

function sideFromOrderSide(side: LiveOrderRequest['side']): LivePositionSide | null {
  if (side === 'BUY') return 'LONG';
  if (side === 'SELL') return 'SHORT';
  return null;
}
