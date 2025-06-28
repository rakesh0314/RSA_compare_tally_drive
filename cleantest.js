const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const credentials = require('./assets/secret_key.json');

const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function testClear() {
    const spreadsheetId = '1TtGZrIcQXDPikzgk91UL_VEjT2Rv3maEByDj0pl2Q50';
    const range = 'DB!A2:T'; // adjust if needed
    try {
        const res = await sheets.spreadsheets.values.clear({ spreadsheetId, range });
        console.log("Clear success", res.data);
    } catch (e) {
        console.error("Clear failed", e.message);
    }
}

testClear();
