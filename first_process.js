// index.js — Google Sheets Processor with improved chunking and error handling

const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const credentials = require('./assets/secret_key.json');

const CONFIG = {
    SCOPES: ['https://www.googleapis.com/auth/spreadsheets'],
    SPREADSHEET_ID: '1TtGZrIcQXDPikzgk91UL_VEjT2Rv3maEByDj0pl2Q50',
    BATCH_SIZE: 10,
    RATE_LIMIT_DELAY: 100,
    MAX_RETRIES: 3,
    CHUNK_SIZE: 3000,
    LOG_FILE: path.join(__dirname, 'logs', 'sheets-processor.log'),
    ERROR_LOG_FILE: path.join(__dirname, 'logs', 'sheets-errors.log')
};

class Logger {
    constructor() { this.ensureLogDirectory(); }
    async ensureLogDirectory() {
        const logDir = path.dirname(CONFIG.LOG_FILE);
        try { await fs.access(logDir); } catch { await fs.mkdir(logDir, { recursive: true }); }
    }
    async log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${level.toUpperCase()}: ${message}${data ? ` | Data: ${JSON.stringify(data)}` : ''}\n`;
        console.log(`[${level.toUpperCase()}] ${message}`);
        const logFile = level === 'error' ? CONFIG.ERROR_LOG_FILE : CONFIG.LOG_FILE;
        try { await fs.appendFile(logFile, logLine); } catch (err) { console.error('Log file write error:', err.message); }
    }
    async info(m, d) { await this.log('info', m, d); }
    async warn(m, d) { await this.log('warn', m, d); }
    async error(m, d) { await this.log('error', m, d); }
    async debug(m, d) { await this.log('debug', m, d); }
}

class RateLimiter {
    constructor(delay = 100) { this.delay = delay; this.lastRequest = 0; }
    async throttle() {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequest;
        if (timeSinceLast < this.delay) await this.sleep(this.delay - timeSinceLast);
        this.lastRequest = Date.now();
    }
    sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
}

class SheetsProcessor {
    constructor() {
        this.logger = new Logger();
        this.rateLimiter = new RateLimiter(CONFIG.RATE_LIMIT_DELAY);
        this.service = null;
        this.processedCount = 0;
        this.errorCount = 0;
        this.startTime = Date.now();
    }

    async initialize() {
        const auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: CONFIG.SCOPES
        });
        this.service = google.sheets({ version: 'v4', auth });
        await this.logger.info("Google Sheets service initialized");
    }

    async retryOperation(operation, maxRetries = CONFIG.MAX_RETRIES) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.rateLimiter.throttle();
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
                    await this.logger.warn(`Attempt ${attempt} failed`, { error: error.message });
                    await this.rateLimiter.sleep(delay);
                }
            }
        }
        throw lastError;
    }

    async getConfigurationData() {
        await this.logger.info("Fetching configuration data...");
        return await this.retryOperation(async () => {
            const result = await this.service.spreadsheets.values.get({
                spreadsheetId: CONFIG.SPREADSHEET_ID,
                range: "'COSTDATA_DB'!C2:F"
            });
            return result.data.values || [];
        });
    }

    async processSheetData(spreadsheetId, range) {
        return await this.retryOperation(async () => {
            const result = await this.service.spreadsheets.values.get({ spreadsheetId, range });
            return result.data.values || [];
        });
    }

    async updateDestination(destinationSpreadsheetId, destinationRange, data) {
        await this.retryOperation(async () => {
            await this.service.spreadsheets.values.clear({ spreadsheetId: destinationSpreadsheetId, range: destinationRange });
        });
        await this.retryOperation(async () => {
            await this.service.spreadsheets.values.update({
                spreadsheetId: destinationSpreadsheetId,
                range: destinationRange,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: data }
            });
        });
    }

    async updateDestinationInChunks(destinationSpreadsheetId, destinationRange, data) {
        if (data.length <= CONFIG.CHUNK_SIZE) return await this.updateDestination(destinationSpreadsheetId, destinationRange, data);

        await this.logger.info("Processing large dataset in chunks", { totalRows: data.length });
        await this.retryOperation(async () => {
            await this.service.spreadsheets.values.clear({ spreadsheetId: destinationSpreadsheetId, range: destinationRange });
        });

        for (let i = 0; i < data.length; i += CONFIG.CHUNK_SIZE) {
            const chunk = data.slice(i, i + CONFIG.CHUNK_SIZE);
            const chunkNumber = Math.floor(i / CONFIG.CHUNK_SIZE) + 1;
            await this.logger.info(`Uploading chunk ${chunkNumber}`, { rows: chunk.length });
            try {
                await this.retryOperation(async () => {
                    if (i === 0) {
                        await this.service.spreadsheets.values.update({
                            spreadsheetId: destinationSpreadsheetId,
                            range: destinationRange,
                            valueInputOption: "USER_ENTERED",
                            requestBody: { values: chunk }
                        });
                    } else {
                        await this.service.spreadsheets.values.append({
                            spreadsheetId: destinationSpreadsheetId,
                            range: destinationRange,
                            valueInputOption: "USER_ENTERED",
                            requestBody: { values: chunk }
                        });
                    }
                });
                await this.rateLimiter.sleep(1000); // throttle between chunks
            } catch (error) {
                await this.logger.error(`Chunk ${chunkNumber} failed`, { error: error.message });
                throw error;
            }
        }
    }

    cleanData(data) {
        if (!data || data.length === 0) return [];
        let cleaned = data.filter(row => row.some(cell => cell !== '' && cell != null));
        return cleaned.map(row => row.map(cell => (cell === '' || cell == null) ? 0 : cell));
    }

    logProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = this.processedCount / elapsed;
        console.log(`Progress: ${this.processedCount} processed, ${this.errorCount} errors, ${elapsed.toFixed(1)}s elapsed, ${rate.toFixed(2)} sheets/sec`);
    }

    async processBatch(batch, batchIndex) {
        await this.logger.info(`Processing batch ${batchIndex + 1} with ${batch.length} items`);
        const batchResults = [];

        const results = await Promise.allSettled(batch.map(async row => {
            const [rSpreadsheetId, rRange, dSpreadsheetId, dRange] = row;
            try {
                const rData = await this.processSheetData(rSpreadsheetId, rRange);
                if (!rData.length) return [];
                const sourceUrl = `https://docs.google.com/spreadsheets/d/${rSpreadsheetId}`;
                this.processedCount++;
                return rData.map(r => [...r, sourceUrl]);
            } catch (error) {
                this.errorCount++;
                await this.logger.error(`Error processing sheet ${rSpreadsheetId}`, { error: error.message });
                return [];
            }
        }));

        for (const result of results) {
            if (result.status === 'fulfilled') batchResults.push(...result.value);
        }

        return batchResults;
    }

    async run() {
        try {
            await this.initialize();
            const rows = await this.getConfigurationData();
            if (!rows.length) return await this.logger.warn("No configuration data found");

            let finalData = [];
            for (let i = 0; i < rows.length; i += CONFIG.BATCH_SIZE) {
                const batch = rows.slice(i, i + CONFIG.BATCH_SIZE);
                const batchIndex = Math.floor(i / CONFIG.BATCH_SIZE);
                const batchResults = await this.processBatch(batch, batchIndex);
                finalData.push(...batchResults);
                this.logProgress();
            }

            finalData = this.cleanData(finalData);
            const [,,,, lastDestSheet, lastDestRange] = rows[rows.length - 1];
            if (finalData.length > CONFIG.CHUNK_SIZE) {
                await this.updateDestinationInChunks(lastDestSheet, lastDestRange, finalData);
            } else {
                await this.updateDestination(lastDestSheet, lastDestRange, finalData);
            }
            await this.logger.info("✅ Process completed");
        } catch (error) {
            await this.logger.error("Process failed", { error: error.message });
        }
    }
}

(async function main() {
    const processor = new SheetsProcessor();
    process.on('unhandledRejection', async (reason) => {
        await processor.logger.error('Unhandled Rejection', { reason });
        process.exit(1);
    });
    process.on('uncaughtException', async (error) => {
        await processor.logger.error('Uncaught Exception', { error: error.message });
        process.exit(1);
    });
    await processor.run();
})();
