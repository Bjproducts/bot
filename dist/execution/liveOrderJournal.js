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
exports.LiveOrderJournal = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const LIVE_ORDERS_CSV = 'live-orders.csv';
const LIVE_ORDERS_JSON = 'live-orders.json';
const CSV_HEADER = [
    'timestamp',
    'symbol',
    'side',
    'action',
    'orderType',
    'requestedSizeUsd',
    'executedSizeUsd',
    'requestedPrice',
    'executedPrice',
    'status',
    'exchangeOrderId',
    'reason',
    'safetyGateResult',
].join(',');
class LiveOrderJournal {
    logsDir;
    csvPath;
    jsonPath;
    constructor(options = {}) {
        this.logsDir = options.logsDir ?? LOGS_DIR;
        this.csvPath = path.join(this.logsDir, LIVE_ORDERS_CSV);
        this.jsonPath = path.join(this.logsDir, LIVE_ORDERS_JSON);
        this.ensureFiles();
    }
    log(record) {
        fs.appendFileSync(this.csvPath, this.toCsvRow(record) + '\n', 'utf-8');
        const existing = this.readJson();
        existing.push(record);
        fs.writeFileSync(this.jsonPath, JSON.stringify(existing, null, 2), 'utf-8');
    }
    ensureFiles() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
        if (!fs.existsSync(this.csvPath) || fs.statSync(this.csvPath).size === 0) {
            fs.writeFileSync(this.csvPath, CSV_HEADER + '\n', 'utf-8');
        }
        if (!fs.existsSync(this.jsonPath)) {
            fs.writeFileSync(this.jsonPath, '[]', 'utf-8');
        }
    }
    readJson() {
        try {
            const raw = fs.readFileSync(this.jsonPath, 'utf-8').trim();
            return raw ? JSON.parse(raw) : [];
        }
        catch {
            return [];
        }
    }
    toCsvRow(record) {
        const safetyGateResult = record.safetyGateResult.passed
            ? 'PASSED'
            : `FAILED:${record.safetyGateResult.failures.join('|')}`;
        return [
            record.timestamp,
            record.symbol,
            record.side,
            record.action,
            record.orderType,
            record.requestedSizeUsd.toFixed(2),
            record.executedSizeUsd.toFixed(2),
            record.requestedPrice !== undefined ? record.requestedPrice.toFixed(8) : '',
            record.executedPrice !== undefined ? record.executedPrice.toFixed(8) : '',
            record.status,
            csv(record.exchangeOrderId),
            csv(record.reason),
            csv(safetyGateResult),
        ].join(',');
    }
}
exports.LiveOrderJournal = LiveOrderJournal;
function csv(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
