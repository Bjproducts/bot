"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IctSignalAuditLog = exports.ICT_SIGNALS_JSON_PATH = exports.ICT_SIGNALS_CSV_PATH = void 0;
exports.makeIctSignalAuditRecord = makeIctSignalAuditRecord;
exports.classifyIctRejectionReason = classifyIctRejectionReason;
exports.loadIctSignalAuditRecords = loadIctSignalAuditRecords;
exports.summarizeIctSignalAudit = summarizeIctSignalAudit;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
exports.ICT_SIGNALS_CSV_PATH = path.join(LOGS_DIR, 'ict-signals.csv');
exports.ICT_SIGNALS_JSON_PATH = path.join(LOGS_DIR, 'ict-signals.json');
const CSV_HEADER = [
    'timestamp',
    'symbol',
    'price',
    'signal',
    'confidence',
    'zoneType',
    'zoneId',
    'reason',
    'accepted',
    'rejectionReason',
    'signalSource',
    'marketDataSource',
    'tradeSelectionStatus',
    'tradeSelectionReason',
    'entryPrice',
    'stopPrice',
    'riskDistance',
    'zoneSize',
    'stopSource',
    'expectedProfitAtTPUsd',
    'tradeSelectionScore',
].join(',');
const EMPTY_SUMMARY = {
    totalEvaluations: 0,
    buyCount: 0,
    sellCount: 0,
    noneCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
};
class IctSignalAuditLog {
    records;
    constructor() {
        ensureLogsDir();
        ensureCsvFile();
        this.records = loadIctSignalAuditRecords();
        this.writeJsonFile();
    }
    log(record) {
        try {
            fs.appendFileSync(exports.ICT_SIGNALS_CSV_PATH, toCsvRow(record) + '\n', 'utf-8');
            this.records.push(record);
            this.writeJsonFile();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  !  ICT signal audit log write failed: ${msg}`);
        }
    }
    writeJsonFile() {
        const file = {
            updatedAt: new Date().toISOString(),
            summary: summarizeIctSignalAudit(this.records),
            records: this.records,
        };
        fs.writeFileSync(exports.ICT_SIGNALS_JSON_PATH, JSON.stringify(file, null, 2), 'utf-8');
    }
}
exports.IctSignalAuditLog = IctSignalAuditLog;
function makeIctSignalAuditRecord(input) {
    const accepted = input.signal.signal === 'BUY' || input.signal.signal === 'SELL';
    const candidate = input.tradeCandidate;
    return {
        timestamp: input.signal.evaluatedAt,
        symbol: input.symbol,
        price: input.price,
        signal: input.signal.signal,
        confidence: input.signal.confidence,
        zoneType: input.signal.sourceZoneType,
        zoneId: input.signal.zoneId,
        reason: input.signal.reason,
        accepted,
        rejectionReason: accepted ? '' : classifyIctRejectionReason(input.signal),
        signalSource: input.signalSource,
        marketDataSource: input.marketDataSource,
        tradeSelectionStatus: candidate?.status ?? (accepted ? 'NOT_EVALUATED' : 'NOT_CANDIDATE'),
        tradeSelectionReason: candidate?.rejectionReason ?? '',
        entryPrice: candidate?.entryPrice ?? null,
        stopPrice: candidate?.stopPrice ?? null,
        riskDistance: candidate?.riskDistance ?? null,
        zoneSize: candidate?.zoneSize ?? null,
        stopSource: candidate?.stopSource ?? '',
        expectedProfitAtTPUsd: candidate?.expectedProfitAtTPUsd ?? null,
        tradeSelectionScore: candidate?.score ?? null,
    };
}
function classifyIctRejectionReason(signal) {
    if (signal.signal !== 'NONE')
        return '';
    if (/invalidated/i.test(signal.reason)) {
        return 'Invalidated zone';
    }
    if (/confidence|below minimum/i.test(signal.reason)) {
        return 'Below confidence threshold';
    }
    if (signal.reactionOutput === 'NONE') {
        return 'Missing reaction';
    }
    return signal.reason || 'Other future rejection reason';
}
function loadIctSignalAuditRecords() {
    try {
        if (!fs.existsSync(exports.ICT_SIGNALS_JSON_PATH))
            return [];
        const raw = fs.readFileSync(exports.ICT_SIGNALS_JSON_PATH, 'utf-8').trim();
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
        return Array.isArray(parsed.records) ? parsed.records : [];
    }
    catch {
        return [];
    }
}
function summarizeIctSignalAudit(records) {
    return records.reduce((summary, record) => {
        summary.totalEvaluations += 1;
        if (record.signal === 'BUY')
            summary.buyCount += 1;
        if (record.signal === 'SELL')
            summary.sellCount += 1;
        if (record.signal === 'NONE')
            summary.noneCount += 1;
        if (record.accepted) {
            summary.acceptedCount += 1;
        }
        else {
            summary.rejectedCount += 1;
        }
        return summary;
    }, { ...EMPTY_SUMMARY });
}
function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}
function ensureCsvFile() {
    const exists = fs.existsSync(exports.ICT_SIGNALS_CSV_PATH);
    const isEmpty = exists ? fs.statSync(exports.ICT_SIGNALS_CSV_PATH).size === 0 : true;
    if (!exists || isEmpty) {
        fs.writeFileSync(exports.ICT_SIGNALS_CSV_PATH, CSV_HEADER + '\n', 'utf-8');
    }
}
function toCsvRow(record) {
    return [
        record.timestamp,
        record.symbol,
        record.price.toFixed(2),
        record.signal,
        record.confidence.toFixed(2),
        record.zoneType,
        csv(record.zoneId),
        csv(record.reason),
        String(record.accepted),
        csv(record.rejectionReason),
        record.signalSource,
        csv(record.marketDataSource),
        record.tradeSelectionStatus,
        csv(record.tradeSelectionReason),
        record.entryPrice === null ? '' : record.entryPrice.toFixed(2),
        record.stopPrice === null ? '' : record.stopPrice.toFixed(2),
        record.riskDistance === null ? '' : record.riskDistance.toFixed(4),
        record.zoneSize === null ? '' : record.zoneSize.toFixed(4),
        record.stopSource,
        record.expectedProfitAtTPUsd === null ? '' : record.expectedProfitAtTPUsd.toFixed(4),
        record.tradeSelectionScore === null ? '' : record.tradeSelectionScore.toFixed(2),
    ].join(',');
}
function csv(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
