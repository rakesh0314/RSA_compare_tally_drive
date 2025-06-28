const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// Load credentials
const credentials = require('./assets/secret_key.json');

// Google Sheets config
const SOURCE_SPREADSHEET_ID = '12B34rZ68BJvAfRW6LnBMTuOj-2y93tCoWFjJ_KKkJ4s';
const DEST_SPREADSHEET_ID = '19vdmS32iTys5K-sfALQXX0RrS1otgyiWZ31Riyfeuik';
const SOURCE_RANGE = 'DB!A2:W167542';
const DEST_START_CELL = 2; // Row 2

// Initialize auth client
async function authorize() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return await auth.getClient();
}

// Chunking helper
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Main function
async function transferData() {
  try {
    console.log('🔐 Authorizing...');
    const authClient = await authorize();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Step 1: Read Data
    console.log('📥 Reading data from source...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SOURCE_SPREADSHEET_ID,
      range: SOURCE_RANGE,
    });

    const data = response.data.values || [];
    console.log(`✅ Rows fetched: ${data.length}`);

    // Step 2: Clean Data (pad to 23 columns)
    const cleanedData = data.map(row => {
      const filled = row.slice();
      while (filled.length < 23) filled.push('');
      return filled;
    });
    console.log(`🧹 Cleaned data rows: ${cleanedData.length}`);

    // Step 3: Clear Destination
    console.log('🧼 Clearing destination range...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: DEST_SPREADSHEET_ID,
      range: `DB!A${DEST_START_CELL}:W`,
    });

    // Step 4: Upload in chunks
    const chunks = chunkArray(cleanedData, 15000);
    let startRow = DEST_START_CELL;

    console.log('📤 Uploading in chunks...');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const endRow = startRow + chunk.length - 1;
      const destRange = `DB!A${startRow}:W${endRow}`;
      console.log(`➡️ Uploading rows ${startRow} to ${endRow}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId: DEST_SPREADSHEET_ID,
        range: destRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: chunk,
        },
      });

      startRow = endRow + 1;
    }

    console.log('✅ All chunks uploaded successfully.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the script
transferData();
