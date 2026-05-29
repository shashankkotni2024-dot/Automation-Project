// ============================================================
//  CONFIGURATION — fill in your sheet URLs below
// ============================================================
const CONFIG = {
  // Each entry = one source spreadsheet that contains Form2-style tabs.
  // Add as many source sheets as you need.
  sources: [
    {
      url: 'https://docs.google.com/spreadsheets/d/SOURCE_SHEET_ID_1/edit',
      // Leave tabNames empty [] to process ALL tabs in this spreadsheet
      // OR list specific tab names to process only those tabs
      tabNames: []  // e.g. ['Sheet1', 'Sheet2'] or [] for all tabs
    },
    {
      url: 'https://docs.google.com/spreadsheets/d/SOURCE_SHEET_ID_2/edit',
      tabNames: []
    }
    // Add more source sheets here following the same pattern
  ],

  // Target spreadsheet URL (single-tab master sheet — Form1 layout)
  targetUrl: 'https://docs.google.com/spreadsheets/d/TARGET_SHEET_ID/edit',

  // Name of the single master tab in the target sheet
  targetTabName: 'Master'
};

// ============================================================
//  FORM1 HEADER (output columns in order)
// ============================================================
const FORM1_HEADER = [
  'Sr No',
  'Cust ID',
  'Client Name',
  'Condition Type',
  'Covenant Type',
  'Covenant',
  'RM Name',
  'Business Head',
  'Initial Date of Disb',
  'Cov Due date',
  'Extended Due Date',
  'Aging (Days)',
  'Status',
  'Closure Date'
];

// ============================================================
//  HELPER — extract spreadsheet ID from a full URL or raw ID string
//  Accepts:
//    - Full URL:  https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0
//    - Raw ID:    ABC123xyz_-fooBar  (no slashes, no dots)
//  Also strips accidental whitespace and smart/curly quotes.
// ============================================================
function extractSheetId(input) {
  // Sanitize: trim whitespace and strip smart/curly quotes
  const cleaned = String(input)
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');   // curly double quotes

  // If it looks like a full URL, extract the ID portion
  if (cleaned.indexOf('spreadsheets') !== -1 || cleaned.indexOf('http') !== -1) {
    const match = cleaned.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error(
      'Could not find a Sheet ID in this URL: "' + cleaned + '"\n' +
      'Expected format: https://docs.google.com/spreadsheets/d/YOUR_ID/edit'
    );
    return match[1];
  }

  // Otherwise treat the whole string as a raw ID
  if (/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    return cleaned;
  }

  throw new Error(
    'Invalid Sheet ID or URL: "' + cleaned + '"\n' +
    'Paste either the full Google Sheets URL or just the ID between /d/ and /edit'
  );
}

// ============================================================
//  HELPER — find the header row index (row containing "sr no")
//  Returns the 0-based index in the data array, or -1 if not found
// ============================================================
function findHeaderRowIndex(data) {
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    for (let j = 0; j < data[i].length; j++) {
      // Match "sr no" or "sr no." (with optional trailing dot/space)
      const cell = String(data[i][j]).trim().toLowerCase().replace(/\.+$/, '');
      if (cell === 'sr no') {
        return i;
      }
    }
  }
  return -1;
}

// ============================================================
//  HELPER — build a column-name → column-index map from a header row
//  Keys are lowercased + trimmed for resilient matching
// ============================================================
function buildColumnMap(headerRow) {
  const map = {};
  headerRow.forEach(function(cell, idx) {
    const key = String(cell).trim().toLowerCase();
    if (key) map[key] = idx;
  });
  return map;
}

// ============================================================
//  HELPER — safe column lookup (returns '' if column missing)
// ============================================================
function getCol(row, colMap, ...keys) {
  for (const key of keys) {
    const idx = colMap[key.toLowerCase()];
    if (idx !== undefined && row[idx] !== undefined) {
      return row[idx];
    }
  }
  return '';
}

// ============================================================
//  HELPER — parse Client Name and Cust ID from a Form2 column header
//
//  Form2 header pattern (one of the data columns):
//    "GH2 Solar Limited, (10021147) WCDL- 20 Crs"
//    i.e.  <Client Name>,<space>(<CustID>)<space><Covenant/facility>
//
//  There is a COMMA between the client name and the opening bracket.
//  Regex captures:
//    - everything before ", (" as the Client Name
//    - digits inside () as the Cust ID
//  Covenant column in Form1 is left EMPTY (not sourced from Form2).
// ============================================================
function parseClientColumn(headerRow) {
  // Regex: name ends just before ", (" — comma + optional space + open bracket
  // Cust ID inside brackets: alphanumeric (letters + digits), 4–15 chars
  // e.g. "GH2 Solar Limited, (10021147) WCDL- 20 Crs"
  //      "Acme Corp, (ABC123X) OD- 50 Crs"
  const pattern = /^(.+?),\s*\(([A-Za-z0-9]{4,15})\)/;
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i]).trim();
    const m = cell.match(pattern);
    if (m) {
      return {
        colIndex: i,
        clientName: m[1].trim(),
        custId: m[2].trim()
      };
    }
  }
  return null;
}

// ============================================================
//  HELPER — normalise Condition Type
//  Fixes "preceeding" → "preceding" and standardises casing
// ============================================================
function normaliseConditionType(raw) {
  if (!raw) return '';
  let val = String(raw).trim().toLowerCase();

  // Fix common misspelling
  val = val.replace(/preceeding/g, 'preceding');

  if (val.includes('subsequent')) return 'Condition Subsequent';
  if (val.includes('preceding'))  return 'Condition Preceding';

  // Return title-cased original if it doesn't match known types
  return String(raw).trim();
}

// ============================================================
//  HELPER — normalise Covenant Type to one of 4 allowed values
// ============================================================
function normaliseCovenantType(raw) {
  if (!raw) return '';
  const val = String(raw).trim().toLowerCase();
  if (val.includes('information'))  return 'Information';
  if (val.includes('collateral'))   return 'Collateral';
  if (val.includes('financial'))    return 'Financial';
  if (val.includes('other'))        return 'Others';
  return String(raw).trim(); // keep original if unrecognised
}

// ============================================================
//  HELPER — resolve checkbox value to readable string
//  Google Sheets checkboxes come in as TRUE/FALSE booleans
// ============================================================
function resolveCheckbox(val) {
  if (val === true  || String(val).toLowerCase() === 'true')  return 'Yes';
  if (val === false || String(val).toLowerCase() === 'false') return 'No';
  return String(val).trim();
}

// ============================================================
//  CORE — transform one Form2 sheet into an array of Form1 rows
// ============================================================
function transformSheet(sheet, sheetLabel) {
  const data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) {
    Logger.log('[SKIP] ' + sheetLabel + ' — no data');
    return [];
  }

  // 1. Locate header row
  const headerRowIdx = findHeaderRowIndex(data);
  if (headerRowIdx === -1) {
    Logger.log('[SKIP] ' + sheetLabel + ' — "Sr No" header row not found in first 10 rows');
    return [];
  }

  const headerRow = data[headerRowIdx];
  const colMap    = buildColumnMap(headerRow);

  // 2. Parse client name, cust id, covenant from the special column header
  const clientInfo = parseClientColumn(headerRow);
  if (!clientInfo) {
    Logger.log('[WARN] ' + sheetLabel + ' — could not find client/cust-id column. Client Name and Cust ID will be empty.');
  }

  const clientName    = clientInfo ? clientInfo.clientName : '';
  const custId        = clientInfo ? clientInfo.custId     : '';
  const covenantColIdx = clientInfo ? clientInfo.colIndex   : -1;
  // Covenant value comes from the data rows under the client column header

  // 3. Process each data row (skip header row and any rows before it)
  const outputRows = [];
  let srCounter = 1;

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];

    // Skip completely empty rows
    if (row.every(cell => String(cell).trim() === '')) continue;

    // Skip sub-header or total rows (if Sr No cell is non-numeric text)
    const srNoRaw = getCol(row, colMap, 'sr no');
    if (srNoRaw !== '' && isNaN(Number(srNoRaw)) && String(srNoRaw).trim() !== '') {
      // Could be a repeated header or section label — skip
      Logger.log('[SKIP ROW] ' + sheetLabel + ' row ' + (i + 1) + ': Sr No = "' + srNoRaw + '"');
      continue;
    }

    // --- Map Form2 columns → Form1 columns ---

    // Condition Type (with spelling correction)
    const conditionTypeRaw = getCol(row, colMap,
      'condition type');
    const conditionType = normaliseConditionType(conditionTypeRaw);

    // Covenant Type (normalised to 4 allowed values)
    const covenantTypeRaw = getCol(row, colMap,
      'covenant type');
    const covenantType = normaliseCovenantType(covenantTypeRaw);

    // Checker Status (checkbox) → not in Form1 directly; 
    // Form2 "Document status" → Form1 "Status"
    const statusRaw = getCol(row, colMap,
      'document status', 'doc status');
    // Checker status is a checkbox — resolve it but we don't output it separately
    // (not a Form1 field). We use Document status for "Status".
    const status = resolveCheckbox(statusRaw);

    // Aging (Days) — Form2: "Day Past Due" / "Days Past Due"
    // Copy as-is (including negatives)
    const aging = getCol(row, colMap,
      'day past due', 'days past due', 'days past due ');

    // Cov Due date — Form2: "Cov Due date"
    const covDueDate = getCol(row, colMap,
      'cov due date', 'covenant due date');

    // Closure Date — mapped FROM "Cov Due date" per requirement
    // (covenant due date in form2 = closure date in form1)
    const closureDate = covDueDate;

    // Initial Date of Disb
    const initialDateOfDisb = getCol(row, colMap,
      'initial date of disb', 'initial date of disbursement');

    // Extended Due Date
    const extendedDueDate = getCol(row, colMap,
      'extended due date', 'extended due date ');

    // RM Name and Business Head — not in Form2, leave blank
    const rmName       = '';
    const businessHead = '';

    // Covenant — data cell in the client column for this row
    const covenantValue = (covenantColIdx >= 0 && row[covenantColIdx] !== undefined)
      ? String(row[covenantColIdx]).trim()
      : '';

    // Build Form1 row in column order
    const form1Row = [
      srCounter,          // Sr No (auto-increment across all sheets)
      custId,             // Cust ID
      clientName,         // Client Name
      conditionType,      // Condition Type
      covenantType,       // Covenant Type
      covenantValue,      // Covenant — from data rows under client column
      rmName,             // RM Name (blank)
      businessHead,       // Business Head (blank)
      initialDateOfDisb,  // Initial Date of Disb
      covDueDate,         // Cov Due date
      extendedDueDate,    // Extended Due Date
      aging,              // Aging (Days)
      status,             // Status
      closureDate         // Closure Date
    ];

    outputRows.push(form1Row);
    srCounter++;
  }

  Logger.log('[OK] ' + sheetLabel + ' — ' + outputRows.length + ' rows extracted');
  return outputRows;
}

// ============================================================
//  MAIN — entry point; run this function from the Apps Script editor
// ============================================================
function buildMasterSheet() {
  // --- Open target sheet ---
  const targetId = extractSheetId(CONFIG.targetUrl);
  const targetSS = SpreadsheetApp.openById(targetId);

  let masterSheet = targetSS.getSheetByName(CONFIG.targetTabName);
  if (!masterSheet) {
    masterSheet = targetSS.insertSheet(CONFIG.targetTabName);
    Logger.log('Created new tab: ' + CONFIG.targetTabName);
  } else {
    masterSheet.clear();            // wipes contents + formatting for a clean slate
    Logger.log('Cleared existing tab: ' + CONFIG.targetTabName);
  }

  // Write header row
  masterSheet.getRange(1, 1, 1, FORM1_HEADER.length).setValues([FORM1_HEADER]);

  // Style header row
  const headerRange = masterSheet.getRange(1, 1, 1, FORM1_HEADER.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');
  headerRange.setFontColor('#ffffff');
  masterSheet.setFrozenRows(1);

  let allRows      = [];
  let globalSr     = 1;
  let totalErrors  = 0;

  // --- Iterate over each source spreadsheet ---
  CONFIG.sources.forEach(function(source, srcIdx) {
    let sourceId, sourceSS;
    try {
      sourceId = extractSheetId(source.url);
      sourceSS = SpreadsheetApp.openById(sourceId);
    } catch (e) {
      Logger.log('[ERROR] Source #' + (srcIdx + 1) + ' could not be opened: ' + e.message);
      totalErrors++;
      return;
    }

    // Determine which tabs to process
    let tabs;
    if (source.tabNames && source.tabNames.length > 0) {
      // Process only specified tabs
      tabs = source.tabNames.map(function(name) {
        const s = sourceSS.getSheetByName(name);
        if (!s) {
          Logger.log('[ERROR] Tab "' + name + '" not found in source #' + (srcIdx + 1));
          totalErrors++;
        }
        return s;
      }).filter(Boolean);
    } else {
      // Process ALL tabs in the spreadsheet
      tabs = sourceSS.getSheets();
    }

    tabs.forEach(function(sheet) {
      const label = sourceSS.getName() + ' → ' + sheet.getName();
      try {
        const rows = transformSheet(sheet, label);
        // Re-number Sr No globally across all sheets
        rows.forEach(function(row) {
          row[0] = globalSr++;
          allRows.push(row);
        });
      } catch (e) {
        Logger.log('[ERROR] ' + label + ': ' + e.message);
        totalErrors++;
      }
    });
  });

  // --- Write all rows to master sheet ---
  if (allRows.length > 0) {
    masterSheet.getRange(2, 1, allRows.length, FORM1_HEADER.length).setValues(allRows);
    Logger.log('✅ Done! ' + allRows.length + ' rows written to "' + CONFIG.targetTabName + '"');
  } else {
    Logger.log('⚠️ No data rows were extracted from any source sheet.');
  }

  if (totalErrors > 0) {
    Logger.log('⚠️ Completed with ' + totalErrors + ' error(s). Check logs above for details.');
  }

  // Auto-resize columns for readability
  for (let c = 1; c <= FORM1_HEADER.length; c++) {
    masterSheet.autoResizeColumn(c);
  }

  SpreadsheetApp.flush();
}
