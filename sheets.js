import { google } from 'googleapis';

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function getAllRows(sheetName) {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    ranges: [
      `${sheetName}!X2:X`, // timestamps
      `${sheetName}!P2:P`, // message text
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
