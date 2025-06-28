const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const credentials = require('./assets/secret_key.json');

// Configuration
const CONFIG = {
    SCOPES: ['https://www.googleapis.com/auth/spreadsheets'],
    SPREADSHEET_ID: '1TtGZrIcQXDPikzgk91UL_VEjT2Rv3maEByDj0pl2Q50',
    BATCH_SIZE: 10, // Process sheets in batches
    RATE_LIMIT_DELAY: 100, // ms between requests
    MAX_RETRIES: 3,
    CHUNK_SIZE: 5000, // Rows per chunk for large datasets
    LOG_FILE: path.join(__dirname, 'logs', 'sheets-processor.log'),
    ERROR_LOG_FILE: path.join(__dirname, 'logs', 'sheets-errors.log')
};

class Logger {
    constructor() {
        this.ensureLogDirectory();
    }

    async ensureLogDirectory() {
        const logDir = path.dirname(CONFIG.LOG_FILE);
        try {
            await fs.access(logDir);
        } catch {
            await fs.mkdir(logDir, { recursive: true });
        }
    }

    async log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data: data ? JSON.stringify(data, null, 2) : null
        };

        const logLine = `[${timestamp}] ${level.toUpperCase()}: ${message}${data ? ` | Data: ${JSON.stringify(data)}` : ''}\n`;
        
        // Console output
        console.log(`[${level.toUpperCase()}] ${message}`);
        
        // File output
        const logFile = level === 'error' ? CONFIG.ERROR_LOG_FILE : CONFIG.LOG_FILE;
        try {
            await fs.appendFile(logFile, logLine);
        } catch (err) {
            console.error('Failed to write to log file:', err.message);
        }
    }

    async info(message, data) { await this.log('info', message, data); }
    async warn(message, data) { await this.log('warn', message, data); }
    async error(message, data) { await this.log('error', message, data); }
    async debug(message, data) { await this.log('debug', message, data); }
}

class RateLimiter {
    constructor(delay = 100) {
        this.delay = delay;
        this.lastRequest = 0;
    }

    async throttle() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;
        
        if (timeSinceLastRequest < this.delay) {
            await this.sleep(this.delay - timeSinceLastRequest);
        }
        
        this.lastRequest = Date.now();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
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
        try {
            await this.logger.info("Initializing Google Sheets service...");
            
            const auth = new JWT({
                email: credentials.client_email,
                key: credentials.private_key,
                scopes: CONFIG.SCOPES,
            });

            this.service = google.sheets({ version: 'v4', auth });
            await this.logger.info("Google Sheets service initialized successfully");
            
        } catch (error) {
            await this.logger.error("Failed to initialize service", { error: error.message });
            throw error;
        }
    }

    async retryOperation(operation, maxRetries = CONFIG.MAX_RETRIES) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.rateLimiter.throttle();
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt === maxRetries) {
                    break;
                }

                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, { 
                    error: error.message 
                });
                await this.rateLimiter.sleep(delay);
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
            const result = await this.service.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: range
            });
            return result.data.values || [];
        });
    }

    async logToSheet(spreadsheetId, message, isError = false) {
        const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const logData = [[nowStr, message]];
        
        try {
            await this.retryOperation(async () => {
                await this.service.spreadsheets.values.append({
                    spreadsheetId: spreadsheetId,
                    range: "'S_LOG'!A2:B",
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: logData
                    }
                });
            });
        } catch (error) {
            await this.logger.error("Failed to log to sheet", { 
                spreadsheetId, 
                message, 
                error: error.message 
            });
        }
    }

    async processBatch(batch, batchIndex) {
        await this.logger.info(`Processing batch ${batchIndex + 1} with ${batch.length} items`);
        
        const batchResults = [];
        const batchPromises = batch.map(async (row, index) => {
            const [rSpreadsheetId, rRange, dSpreadsheetId, dRange] = row;
            const sourceUrl = `https://docs.google.com/spreadsheets/d/${rSpreadsheetId}`;
            
            try {
                const rData = await this.processSheetData(rSpreadsheetId, rRange);
                
                if (rData.length === 0) {
                    await this.logger.info(`Skipped empty sheet: ${rSpreadsheetId}, range: ${rRange}`);
                    return [];
                }

                const dataWithUrl = rData.map(dataRow => [...dataRow, sourceUrl]);
                this.processedCount++;
                
                await this.logger.info(`Processed ${dataWithUrl.length} rows from sheet ${rSpreadsheetId}`);
                return dataWithUrl;

            } catch (error) {
                this.errorCount++;
                await this.logger.error(`Error processing sheet ${rSpreadsheetId}`, { 
                    error: error.message,
                    range: rRange 
                });
                
                // Log error to destination sheet
                await this.logToSheet(dSpreadsheetId, error.message, true);
                return [];
            }
        });

        const results = await Promise.allSettled(batchPromises);
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                batchResults.push(...result.value);
            } else {
                this.logger.error(`Batch item ${index} failed`, { error: result.reason?.message });
            }
        });

        return batchResults;
    }

    cleanData(data) {
        if (!data || data.length === 0) return [];
        
        // Remove completely empty rows
        let cleanedData = data.filter(row => {
            return row.some(cell => cell !== '' && cell !== null && cell !== undefined);
        });
        
        // Replace empty strings with 0 and handle null/undefined values
        cleanedData = cleanedData.map(row => {
            return row.map(cell => {
                if (cell === '' || cell === null || cell === undefined) {
                    return 0;
                }
                return cell;
            });
        });
        
        return cleanedData;
    }

    async updateDestinationInChunks(destinationSpreadsheetId, destinationRange, data) {
        if (data.length <= CONFIG.CHUNK_SIZE) {
            return await this.updateDestination(destinationSpreadsheetId, destinationRange, data);
        }

        await this.logger.info(`Processing large dataset in chunks`, { 
            totalRows: data.length, 
            chunkSize: CONFIG.CHUNK_SIZE 
        });

        // Clear destination first
        await this.retryOperation(async () => {
            await this.service.spreadsheets.values.clear({
                spreadsheetId: destinationSpreadsheetId,
                range: destinationRange
            });
        });

        // Process in chunks
        for (let i = 0; i < data.length; i += CONFIG.CHUNK_SIZE) {
            const chunk = data.slice(i, i + CONFIG.CHUNK_SIZE);
            const chunkNumber = Math.floor(i / CONFIG.CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(data.length / CONFIG.CHUNK_SIZE);
            
            await this.logger.info(`Uploading chunk ${chunkNumber}/${totalChunks} (${chunk.length} rows)`);
            
            await this.retryOperation(async () => {
                if (i === 0) {
                    // First chunk - update
                    await this.service.spreadsheets.values.update({
                        spreadsheetId: destinationSpreadsheetId,
                        range: destinationRange,
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: chunk }
                    });
                } else {
                    // Subsequent chunks - append
                    await this.service.spreadsheets.values.append({
                        spreadsheetId: destinationSpreadsheetId,
                        range: destinationRange,
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: chunk }
                    });
                }
            });
        }
    }

    async updateDestination(destinationSpreadsheetId, destinationRange, data) {
        await this.retryOperation(async () => {
            await this.service.spreadsheets.values.clear({
                spreadsheetId: destinationSpreadsheetId,
                range: destinationRange
            });
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

    logProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = this.processedCount / elapsed;
        
        console.log(`Progress: ${this.processedCount} processed, ${this.errorCount} errors, ${elapsed.toFixed(1)}s elapsed, ${rate.toFixed(2)} sheets/sec`);
    }

    async run() {
        try {
            await this.initialize();
            
            const rows = await this.getConfigurationData();
            await this.logger.info(`Found ${rows.length} sheets to process`);

            if (rows.length === 0) {
                await this.logger.warn("No configuration data found");
                return;
            }

            let finalData = [];

            // Process in batches to manage memory and API limits
            for (let i = 0; i < rows.length; i += CONFIG.BATCH_SIZE) {
                const batch = rows.slice(i, i + CONFIG.BATCH_SIZE);
                const batchIndex = Math.floor(i / CONFIG.BATCH_SIZE);
                
                const batchResults = await this.processBatch(batch, batchIndex);
                finalData.push(...batchResults);
                
                this.logProgress();
                
                // Memory management for large datasets
                if (finalData.length > CONFIG.CHUNK_SIZE * 2) {
                    await this.logger.info("Processing intermediate data to manage memory");
                    // Process and clear some data if needed
                }
            }

            // Clean up the data
            finalData = this.cleanData(finalData);
            await this.logger.info(`Final dataset contains ${finalData.length} rows`);

            // Update destination sheet
            if (rows.length > 0) {
                const lastRow = rows[rows.length - 1];
                const destinationSpreadsheetId = lastRow[2];
                const destinationRange = lastRow[3];

                await this.logger.info("Updating destination sheet...");
                
                if (finalData.length > CONFIG.CHUNK_SIZE) {
                    await this.updateDestinationInChunks(destinationSpreadsheetId, destinationRange, finalData);
                } else {
                    await this.updateDestination(destinationSpreadsheetId, destinationRange, finalData);
                }

                // Log success
                await this.logToSheet(destinationSpreadsheetId, "Done");
                await this.logger.info("✅ Process completed successfully");
            }

            const totalTime = (Date.now() - this.startTime) / 1000;
            await this.logger.info("Final Statistics", {
                processedSheets: this.processedCount,
                errors: this.errorCount,
                totalRows: finalData.length,
                totalTime: `${totalTime.toFixed(2)}s`,
                averageRate: `${(this.processedCount / totalTime).toFixed(2)} sheets/sec`
            });

        } catch (error) {
            await this.logger.error("Process failed", { error: error.message, stack: error.stack });
            
            // Try to log error to the last known destination
            try {
                const rows = await this.getConfigurationData();
                if (rows.length > 0) {
                    const lastRow = rows[rows.length - 1];
                    await this.logToSheet(lastRow[2], `FINAL ERROR: ${error.message}`, true);
                }
            } catch (logError) {
                await this.logger.error("Failed to log final error to sheet", { error: logError.message });
            }
            
            throw error;
        }
    }
}

// Main execution
async function main() {
    const processor = new SheetsProcessor();
    
    process.on('unhandledRejection', async (reason, promise) => {
        await processor.logger.error('Unhandled Rejection', { reason: reason?.message, promise });
        process.exit(1);
    });

    process.on('uncaughtException', async (error) => {
        await processor.logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
        process.exit(1);
    });

    try {
        await processor.run();
        process.exit(0);
    } catch (error) {
        console.error('Application failed:', error.message);
        process.exit(1);
    }
}

// Run the application
if (require.main === module) {
    main();
}

module.exports = { SheetsProcessor, Logger };