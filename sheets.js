import { google } from 'googleapis';

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function getAllRows(sheetName, spreadsheetId) {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      `${sheetName}!X2:X`,
      `${sheetName}!P2:P`,
    ],
  });

  const timestamps = res.data.valueRanges[0].values || [];
  const messages = res.data.valueRanges[1].values || [];

  const rows = [];
  for (let i = 0; i < Math.max(timestamps.length, messages.length); i++) {
    rows.push({
      timestamp: timestamps[i]?.[0],
      text: messages[i]?.[0],
    });
  }
  return rows;
}

// Reads a single column (skipping the header row) and extracts Discord
// snowflake IDs from each cell. Accepts either raw IDs or <@id> mentions.
export async function getColumnValues(sheetName, spreadsheetId, column) {
  const range = `${sheetName}!${column}2:${column}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
  return rows
    .map(r => r[0])
    .filter(Boolean)
    .map(cell => {
      const match = String(cell).match(/\d{15,20}/);
      return match ? match[0] : null;
    })
    .filter(Boolean);
}