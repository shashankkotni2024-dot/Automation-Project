// ============================================================
//   CONFIGURATION — fill in your sheet URLs below
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
    }
    // Add more source sheets here following the same pattern
  ],

  // Target spreadsheet URL (single-tab master sheet — Form1 layout)
  targetUrl: 'https://docs.google.com/spreadsheets/d/TARGET_SHEET_ID/edit',

  // Name of the single master tab in the target sheet
  targetTabName: 'Master'
};

// ============================================================
//   FORM1 HEADER (output columns in order)
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
//   HELPER — extract spreadsheet ID from a full URL or raw ID string
// ============================================================
function extractSheetId(input) {
  const cleaned = String(input)
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');   // curly double quotes

  if (cleaned.indexOf('spreadsheets') !== -1 || cleaned.indexOf('http') !== -1) {
    const match = cleaned.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error(
      'Could not find a Sheet ID in this URL: "' + cleaned + '"\n' +
      'Expected format: https://docs.google.com/spreadsheets/d/YOUR_ID/edit'
    );
    return match[1];
  }

  if (/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    return cleaned;
  }

  throw new Error(
    'Invalid Sheet ID or URL: "' + cleaned + '"\n' +
    'Paste either the full Google Sheets URL or just the ID between /d/ and /edit'
  );
}

// ============================================================
//   HELPER — find the header row index (row containing "sr no")
// ============================================================
function findHeaderRowIndex(data) {
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    for (let j = 0; j < data[i].length; j++) {
      const cell = String(data[i][j]).trim().toLowerCase().replace(/\.+$/, '');
      if (cell === 'sr no') {
        return i;
      }
    }
  }
  return -1;
}

// ============================================================
//   HELPER — build a column-name → column-index map from a header row
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
//   HELPER — safe column lookup (returns '' if column missing)
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
//   HELPER — parse Client Name and Cust ID from a Form2 column header
// ============================================================
function parseClientColumn(headerRow) {
  const pattern = /^(.+?)(?:,|\s)*\(([A-Za-z0-9]{4,15})\)/;
  
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i]).trim();
    const m = cell.match(pattern);
    if (m) {
      return {
        colIndex: i,
        clientName: m[1].replace(/^[,\s]+|[,\s]+$/g, '').trim(),
        custId: m[2].trim()
      };
    }
  }
  return null;
}

// ============================================================
//   HELPER — normalise Condition Type
// ============================================================
function normaliseConditionType(raw) {
  if (!raw) return '';
  let val = String(raw).trim().toLowerCase();
  val = val.replace(/preceeding/g, 'preceding');

  if (val.includes('subsequent')) return 'Condition Subsequent';
  if (val.includes('preceding'))  return 'Condition Preceding';

  return String(raw).trim();
}

// ============================================================
//   HELPER — normalise Covenant Type to one of 4 allowed values
// ============================================================
function normaliseCovenantType(raw) {
  if (!raw) return '';
  const val = String(raw).trim().toLowerCase();
  if (val.includes('information'))  return 'Information';
  if (val.includes('collateral'))   return 'Collateral';
  if (val.includes('financial'))    return 'Financial';
  if (val.includes('other'))        return 'Others';
  return String(raw).trim();
}

// ============================================================
//   HELPER — resolve checkbox value to readable string
// ============================================================
function resolveCheckbox(val) {
  if (val === true  || String(val).toLowerCase() === 'true')  return 'Yes';
  if (val === false || String(val).toLowerCase() === 'false') return 'No';
  return String(val).trim();
}

// ============================================================
//   CORE — transform one Form2 sheet into an array of Form1 rows
// ============================================================
function transformSheet(sheet, sheetLabel) {
  const data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) {
    Logger.log('[SKIP] ' + sheetLabel + ' — no data found.');
    return [];
  }

  // 1. Locate header row
  const headerRowIdx = findHeaderRowIndex(data);
  if (headerRowIdx === -1) {
    Logger.log('[SKIP] ' + sheetLabel + ' — "Sr No" header row not found in first 10 rows.');
    return [];
  }

  const headerRow = data[headerRowIdx];
  const colMap    = buildColumnMap(headerRow);

  // 2. Parse client name, cust id from header column
  const clientInfo = parseClientColumn(headerRow);
  
  if (!clientInfo) {
    Logger.log('[WARN] ' + sheetLabel + ' — Could not extract Client Name/Cust ID header. Leaving these fields blank for data rows.');
  }

  const clientName    = clientInfo ? clientInfo.clientName : '';
  const custId        = clientInfo ? clientInfo.custId : '';
  const covenantColIdx = clientInfo ? clientInfo.colIndex : -1;

  // 3. Process data rows
  const outputRows = [];
  let srCounter = 1;

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];

    // Skip completely empty rows
    if (row.every(cell => String(cell).trim() === '')) continue;

    // Skip sub-header or total rows
    const srNoRaw = getCol(row, colMap, 'sr no');
    if (srNoRaw !== '' && isNaN(Number(srNoRaw)) && String(srNoRaw).trim() !== '') {
      Logger.log('[SKIP ROW] ' + sheetLabel + ' row ' + (i + 1) + ': Sr No = "' + srNoRaw + '"');
      continue;
    }

    // Extract content fields to inspect for a ghost row
    const conditionTypeRaw = getCol(row, colMap, 'condition type');
    const covenantTypeRaw = getCol(row, colMap, 'covenant type');
    const statusRaw = getCol(row, colMap, 'document status', 'doc status');
    
    const covenantValue = (covenantColIdx >= 0 && row[covenantColIdx] !== undefined)
      ? String(row[covenantColIdx]).trim()
      : '';

    // --- SAFELY UPDATED CRITICAL FILTER ---
    // If core tracking metrics are entirely unpopulated, skip it.
    // If a sheet has NO client id header (covenantColIdx === -1), we rely safely on the remaining fields.
    if (String(conditionTypeRaw).trim() === '' && 
        String(covenantTypeRaw).trim() === '' && 
        String(statusRaw).trim() === '' && 
        (covenantColIdx === -1 || covenantValue === '')) {
      continue;
    }

    const status = resolveCheckbox(statusRaw);

    // Filter out Closed cases (Only pick pending)
    if (status.trim().toLowerCase() === 'closed') {
      continue;
    }

    const conditionType = normaliseConditionType(conditionTypeRaw);
    const covenantType = normaliseCovenantType(covenantTypeRaw);
    const aging = getCol(row, colMap, 'day past due', 'days past due', 'days past due ');

    const covDueDate = getCol(row, colMap, 'cov due date', 'covenant due date');
    const closureDate = covDueDate;

    const initialDateOfDisb = getCol(row, colMap, 'initial date of disb', 'initial date of disbursement');
    const extendedDueDate = getCol(row, colMap, 'extended due date', 'extended due date ');

    const rmName       = '';
    const businessHead = '';

    // Build Form1 row layout
    const form1Row = [
      srCounter,          // Sr No (auto-increment)
      custId,             // Cust ID (will be blank if unparsed)
      clientName,         // Client Name (will be blank if unparsed)
      conditionType,      // Condition Type
      covenantType,       // Covenant Type
      covenantValue,      // Covenant
      rmName,             // RM Name
      businessHead,       // Business Head
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

  Logger.log('[OK] ' + sheetLabel + ' — ' + outputRows.length + ' pending rows extracted.');
  return outputRows;
}

// ============================================================
//   MAIN — entry point
// ============================================================
function buildMasterSheet() {
  const targetId = extractSheetId(CONFIG.targetUrl);
  const targetSS = SpreadsheetApp.openById(targetId);

  let masterSheet = targetSS.getSheetByName(CONFIG.targetTabName);
  if (!masterSheet) {
    masterSheet = targetSS.insertSheet(CONFIG.targetTabName);
    Logger.log('Created new tab: ' + CONFIG.targetTabName);
  } else {
    masterSheet.clear(); 
    Logger.log('Cleared existing tab: ' + CONFIG.targetTabName);
  }

  masterSheet.getRange(1, 1, 1, FORM1_HEADER.length).setValues([FORM1_HEADER]);

  const headerRange = masterSheet.getRange(1, 1, 1, FORM1_HEADER.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86e8');
  headerRange.setFontColor('#ffffff');
  masterSheet.setFrozenRows(1);

  let allRows      = [];
  let globalSr     = 1;
  let totalErrors  = 0;

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

    let tabs = sourceSS.getSheets();
    
    // --- EXCLUSION FILTER ---
    const tabsToSkip = ['Tab To Skip 1', 'Tab To Skip 2', 'Tab To Skip 3']; 
    
    tabs = tabs.filter(function(sheet) {
      const sheetName = sheet.getName();
      if (tabsToSkip.includes(sheetName)) {
        Logger.log('[EXCLUDE] Skipping tab: ' + sheetName);
        return false; 
      }
      return true;
    });

    tabs.forEach(function(sheet) {
      const label = sourceSS.getName() + ' → ' + sheet.getName();
      try {
        const rows = transformSheet(sheet, label);
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

  if (allRows.length > 0) {
    masterSheet.getRange(2, 1, allRows.length, FORM1_HEADER.length).setValues(allRows);
    Logger.log('✅ Done! ' + allRows.length + ' pending rows written to "' + CONFIG.targetTabName + '"');
  } else {
    Logger.log('⚠️ No pending rows were extracted from any source sheet.');
  }

  if (totalErrors > 0) {
    Logger.log('⚠️ Completed with ' + totalErrors + ' error(s). Check logs above.');
  }

  for (let c = 1; c <= FORM1_HEADER.length; c++) {
    masterSheet.autoResizeColumn(c);
  }

  SpreadsheetApp.flush();
}
