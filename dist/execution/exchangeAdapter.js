"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StubExchangeAdapter = void 0;
class StubExchangeAdapter {
    exchangeName;
    openPositions = [];
    orderSequence = 0;
    constructor(exchangeName = 'STUB') {
        this.exchangeName = exchangeName;
    }
    async getAccountInfo() {
        return {
            exchangeName: this.exchangeName,
            accountId: 'stub-account',
            balances: { USD: 10_000 },
        };
    }
    async getOpenPositions() {
        return [...this.openPositions];
    }
    async placeMarketOrder(request) {
        const response = this.makeResponse(request, 'FILLED', request.requestedSizeUsd);
        if (request.action === 'OPEN') {
            this.openPositions.push({
                symbol: request.symbol,
                side: request.side === 'BUY' ? 'LONG' : 'SHORT',
                sizeUsd: request.requestedSizeUsd,
                avgEntryPrice: request.requestedPrice,
            });
        }
        return response;
    }
    async placeLimitOrder(request) {
        return this.makeResponse(request, 'ACCEPTED', 0);
    }
    async closePosition(request) {
        const index = this.openPositions.findIndex(position => position.symbol === request.symbol);
        if (index >= 0) {
            this.openPositions.splice(index, 1);
        }
        return this.makeResponse(request, 'FILLED', request.requestedSizeUsd);
    }
    async cancelOrder(orderId, symbol) {
        return {
            timestamp: new Date().toISOString(),
            symbol,
            side: 'BUY',
            action: 'CLOSE',
            orderType: 'LIMIT',
            requestedSizeUsd: 0,
            executedSizeUsd: 0,
            status: 'CANCELED',
            exchangeOrderId: orderId,
            reason: 'STUB_CANCEL',
        };
    }
    async healthCheck() {
        return {
            ok: true,
            message: 'Stub exchange adapter ready',
            checkedAt: new Date().toISOString(),
        };
    }
    makeResponse(request, status, executedSizeUsd) {
        this.orderSequence++;
        return {
            timestamp: new Date().toISOString(),
            symbol: request.symbol,
            side: request.side,
            action: request.action,
            orderType: request.orderType,
            requestedSizeUsd: request.requestedSizeUsd,
            executedSizeUsd,
            requestedPrice: request.requestedPrice,
            executedPrice: request.requestedPrice ?? 0,
            status,
            exchangeOrderId: `STUB-${this.orderSequence}`,
            reason: request.reason,
        };
    }
}
exports.StubExchangeAdapter = StubExchangeAdapter;
