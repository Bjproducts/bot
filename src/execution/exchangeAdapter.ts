import {
  ExchangeAccountInfo,
  ExchangeHealth,
  ExchangePosition,
  LiveOrderRequest,
  LiveOrderResponse,
} from './exchangeTypes';

export interface ExchangeAdapter {
  readonly exchangeName: string;
  getAccountInfo(): Promise<ExchangeAccountInfo>;
  getOpenPositions(): Promise<ExchangePosition[]>;
  placeMarketOrder(request: LiveOrderRequest): Promise<LiveOrderResponse>;
  placeLimitOrder(request: LiveOrderRequest): Promise<LiveOrderResponse>;
  closePosition(request: LiveOrderRequest): Promise<LiveOrderResponse>;
  cancelOrder(orderId: string, symbol: string): Promise<LiveOrderResponse>;
  healthCheck(): Promise<ExchangeHealth>;
}

export class StubExchangeAdapter implements ExchangeAdapter {
  readonly exchangeName: string;
  private readonly openPositions: ExchangePosition[] = [];
  private orderSequence = 0;

  constructor(exchangeName: string = 'STUB') {
    this.exchangeName = exchangeName;
  }

  async getAccountInfo(): Promise<ExchangeAccountInfo> {
    return {
      exchangeName: this.exchangeName,
      accountId: 'stub-account',
      balances: { USD: 10_000 },
    };
  }

  async getOpenPositions(): Promise<ExchangePosition[]> {
    return [...this.openPositions];
  }

  async placeMarketOrder(request: LiveOrderRequest): Promise<LiveOrderResponse> {
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

  async placeLimitOrder(request: LiveOrderRequest): Promise<LiveOrderResponse> {
    return this.makeResponse(request, 'ACCEPTED', 0);
  }

  async closePosition(request: LiveOrderRequest): Promise<LiveOrderResponse> {
    const index = this.openPositions.findIndex(position => position.symbol === request.symbol);
    if (index >= 0) {
      this.openPositions.splice(index, 1);
    }
    return this.makeResponse(request, 'FILLED', request.requestedSizeUsd);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<LiveOrderResponse> {
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

  async healthCheck(): Promise<ExchangeHealth> {
    return {
      ok: true,
      message: 'Stub exchange adapter ready',
      checkedAt: new Date().toISOString(),
    };
  }

  private makeResponse(
    request: LiveOrderRequest,
    status: LiveOrderResponse['status'],
    executedSizeUsd: number,
  ): LiveOrderResponse {
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
