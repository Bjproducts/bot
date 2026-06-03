"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveExecutionManager = void 0;
const exchangeTypes_1 = require("./exchangeTypes");
const liveOrderJournal_1 = require("./liveOrderJournal");
class LiveExecutionManager {
    config;
    adapter;
    journal;
    constructor(config, adapter, journal = new liveOrderJournal_1.LiveOrderJournal()) {
        this.config = config;
        this.adapter = adapter;
        this.journal = journal;
    }
    async execute(request, state) {
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
        }
        catch (err) {
            const failedOrder = this.makeFailedOrder(request, err);
            this.journal.log({ ...failedOrder, safetyGateResult });
            return {
                accepted: false,
                order: failedOrder,
                safetyGateResult,
            };
        }
    }
    evaluateSafetyGates(request, state) {
        const failures = [];
        if (this.config.botMode !== 'live') {
            failures.push('BOT_MODE_NOT_LIVE');
        }
        if (!this.config.liveTradingEnabled) {
            failures.push('LIVE_TRADING_DISABLED');
        }
        if (this.config.requireManualArm
            && this.config.liveArmConfirm !== exchangeTypes_1.LIVE_ARM_CONFIRMATION) {
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
    async submitOnce(request) {
        if (request.action === 'CLOSE') {
            return this.adapter.closePosition(request);
        }
        if (request.orderType === 'LIMIT') {
            return this.adapter.placeLimitOrder(request);
        }
        return this.adapter.placeMarketOrder(request);
    }
    positionSideMatchesSignal(request, state) {
        const requestPositionSide = sideFromOrderSide(request.side);
        if (request.action === 'OPEN') {
            return requestPositionSide !== null;
        }
        return state.hasOpenLivePosition && state.openPositionSide !== undefined;
    }
    makeRejectedOrder(request, safetyGateResult) {
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
    makeFailedOrder(request, err) {
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
exports.LiveExecutionManager = LiveExecutionManager;
function sideFromOrderSide(side) {
    if (side === 'BUY')
        return 'LONG';
    if (side === 'SELL')
        return 'SHORT';
    return null;
}
