const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs').promises;
const path = require('path');

// === CONFIGURATION ===
const SERVICE_ACCOUNT_FILE = './assets/secret_key.json';
const SOURCE_SPREADSHEET_ID = '12B34rZ68BJvAfRW6LnBMTuOj-2y93tCoWFjJ_KKkJ4s';
const DEST_SPREADSHEET_ID = '1-1DL80M1Ta--Oc2i7AIcaq4-ZznZF6D6O5MzdsQIevw';
const SOURCE_RANGE = 'DB!A2:AE161581';
const DEST_START_ROW = 2;
const DEST_SHEET = 'DB';
const DATE_COLUMN_INDEX = 0; // Assuming date is in column A (index 0)
const FILTER_DATE = '2024-04-01'; // Optional: adjust as needed

// === AUTHENTICATION ===
async function authorize() {
    const credentials = require(SERVICE_ACCOUNT_FILE);
    const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

// === READ DATA ===
async function readSourceData(sheets) {
    console.log('📥 Reading data from source...');
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SOURCE_SPREADSHEET_ID,
        range: SOURCE_RANGE,
    });
    const rows = res.data.values || [];
    console.log(`✅ Rows fetched: ${rows.length}`);
    return rows;
}

// === FILTER / CLEAN DATA ===
function filterAndCleanData(rows) {
    console.log('📅 Filtering by date...');
    const filtered = rows.filter(row => {
        const date = row[DATE_COLUMN_INDEX];
        return date && new Date(date) >= new Date(FILTER_DATE);
    });
    console.log(`✅ Rows after filtering: ${filtered.length}`);

    const cleaned = filtered
        .filter(row => row.some(cell => cell !== '' && cell != null))
        .map(row => row.map(cell => (cell === '' || cell == null) ? 0 : cell));

    console.log(`🧹 Cleaned data rows: ${cleaned.length}`);
    return cleaned;
}

// === CLEAR DESTINATION RANGE ===
async function clearDestinationRange(sheets, range) {
    console.log('🧼 Clearing destination range...');
    await sheets.spreadsheets.values.clear({
        spreadsheetId: DEST_SPREADSHEET_ID,
        range: range
    });
}

// === WRITE DATA ===
async function writeData(sheets, range, data) {
    console.log(`📤 Writing ${data.length} rows...`);
    await sheets.spreadsheets.values.update({
        spreadsheetId: DEST_SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: data }
    });
    console.log('✅ Write complete');
}

// === MAIN FUNCTION ===
async function main() {
    try {
        console.log('🔐 Authorizing...');
        const sheets = await authorize();

        const rows = await readSourceData(sheets);
        const cleanedData = filterAndCleanData(rows);

        const DEST_END_ROW = DEST_START_ROW + cleanedData.length - 1;
        const DEST_RANGE = `${DEST_SHEET}!A${DEST_START_ROW}:AE${DEST_END_ROW}`;

        await clearDestinationRange(sheets, DEST_RANGE);
        await writeData(sheets, DEST_RANGE, cleanedData);

    } catch (err) {
        console.error('❌ ERROR:', err.message || err);
    }
}

main();
