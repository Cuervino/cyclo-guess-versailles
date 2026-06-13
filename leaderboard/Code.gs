// Google Apps Script for the cyclo-guess-versailles leaderboard.
// Bind this to a Google Sheet that has a tab named "scores" with a header row:
//   A: timestamp   B: name   C: score
//
// Deploy: Deploy > New deployment > type "Web app",
//   - Execute as: Me
//   - Who has access: Anyone
// Copy the resulting /exec URL into the app's VITE_LEADERBOARD_URL.

const SHEET_NAME = "scores";

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

// Read: returns the top scores. Supports JSONP via ?callback=fn (used by the app).
function doGet(e) {
  const rows = sheet_().getDataRange().getValues();
  const data = rows
    .slice(1) // drop header
    .filter((r) => r[1] !== "" || r[2] !== "")
    .map((r) => ({ ts: r[0], name: String(r[1]), score: Number(r[2]) || 0 }));
  data.sort((a, b) => b.score - a.score);

  const payload = JSON.stringify({ scores: data.slice(0, 100) });
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + "(" + payload + ")").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(payload).setMimeType(
    ContentService.MimeType.JSON
  );
}

// Write: appends one score row.
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const name = String(body.name || "Anonyme").slice(0, 30);
  const score = Number(body.score) || 0;
  sheet_().appendRow([new Date(), name, score]);
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true })
  ).setMimeType(ContentService.MimeType.JSON);
}
