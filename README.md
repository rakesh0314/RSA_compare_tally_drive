**Comparison of Tally and Drive Data to Google Sheets**

This Node.js utility reads financial or inventory data from Tally, aggregates file metadata from Google Drive, and writes the consolidated results into a Google Sheets spreadsheet. It can be used to automate reporting, dashboards, and data synchronization workflows between on-premise accounting systems (Tally) and cloud storage.

---

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [Project Structure](#project-structure)
7. [Environment Variables](#environment-variables)
8. [Scripts](#scripts)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)
11. [License](#license)

---

## Features

* **Tally Data Extraction**: Connects to Tally via XML or ODBC to pull ledger entries, inventory, and other financial data.
* **Google Drive Metadata**: Scans specified Drive folders to collect file details (name, type, size, created/modified dates).
* **Google Sheets Integration**: Writes and updates rows in Google Sheets, creating new tabs or updating existing ones.
* **Scheduling & Automation**: Easily integrate with cron jobs or serverless functions to run periodic syncs.
* **Error Handling & Logging**: Built-in logging for monitoring failures or mismatches between data sources.

---

## Prerequisites

* **Node.js** v14.x or higher
* **npm** v6.x or higher (or Yarn)
* A running **Tally** instance (Tally.ERP 9 or TallyPrime)
* **Google Cloud** project with:

  * Google Drive API enabled
  * Google Sheets API enabled
  * Service account credentials JSON file

---

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/tally-drive-to-sheets.git
   cd tally-drive-to-sheets
   ```

2. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

---

## Configuration

1. **Google API Credentials**

   * Place your service account JSON file under `config/` (e.g., `config/google-credentials.json`).
2. **Environment Variables**

   * Create a `.env` file in the project root (see [Environment Variables](#environment-variables)).
3. **Tally Connection**

   * Update the `tallyConfig` section in `config/default.js`:

     ```js
     module.exports = {
       tallyConfig: {
         host: 'localhost',
         port: 9000,
         company: 'MyCompanyName',
         xmlPath: '/tally' // or ODBC DSN
       },
       // ...
     }
     ```
4. **Drive Folders**

   * Specify folder IDs in the same config file under `driveFolders`.

---

## Usage

* **One-time run**:

  ```bash
  npm start
  ```

* **Custom script** (e.g., only Tally):

  ```bash
  node scripts/fetchTally.js
  ```

* **Schedule with cron**:

  ```cron
  0 * * * * /usr/bin/node /path/to/project/index.js >> /var/log/tally-sync.log 2>&1
  ```

---

## Project Structure

```bash
├── config/
│   ├── default.js         # Default configuration for Tally and Drive
│   └── google-credentials.json  # Service account key
├── scripts/
│   ├── fetchTally.js      # Fetches and formats Tally data
│   ├── fetchDrive.js      # Reads Drive metadata
│   └── syncSheets.js      # Writes to Google Sheets
├── src/
│   ├── tallyClient.js     # Tally API client
│   ├── driveClient.js     # Google Drive helper
│   ├── sheetsClient.js    # Google Sheets helper
│   └── logger.js          # Winston or other logger
├── .env
├── package.json
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and update:

```env
# Google Service Account
GOOGLE_APPLICATION_CREDENTIALS=config/google-credentials.json

# Google Sheets
SHEET_ID=your_google_sheet_id_here

# Tally
TALLY_HOST=localhost
TALLY_PORT=9000
TALLY_COMPANY=MyCompanyName

# Drive
DRIVE_FOLDER_IDS=folderId1,folderId2
```

---

## Scripts

| Command          | Description                                   |
| ---------------- | --------------------------------------------- |
| `npm start`      | Run full sync (Tally + Drive → Sheets)        |
| `npm run tally`  | Fetch and log Tally data only                 |
| `npm run drive`  | Fetch and log Drive folders metadata only     |
| `npm run sheets` | Sync existing formatted JSON to Google Sheets |

---

## Troubleshooting

* **Invalid credentials**:

  * Ensure `GOOGLE_APPLICATION_CREDENTIALS` path is correct and service account has Drive & Sheets scopes.
* **Tally connection errors**:

  * Verify Tally is running and XML/ODBC is enabled on the specified port.
* **Rate limits**:

  * Implement exponential backoff in `driveClient.js` and `sheetsClient.js`.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/YourFeature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/YourFeature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See `LICENSE` for details.
