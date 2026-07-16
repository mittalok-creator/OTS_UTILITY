// Parses an uploaded .xlsx workbook or a daily "e-AB NPA AC WISE" CSV export into
// the internal 26-column NPA row layout. Ported from the original client-side logic.

const XLSX = require('xlsx');

function normalizeCell(v) {
  if (v instanceof Date) {
    return String(v.getUTCDate()).padStart(2, '0') + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') + '-' + v.getUTCFullYear();
  }
  if (v === undefined || v === null) return '';
  return v;
}
function findSheet(wb, candidates) {
  const names = wb.SheetNames;
  for (const cand of candidates) {
    const hit = names.find(n => n.toLowerCase().replace(/[\s_]/g, '') === cand);
    if (hit) return hit;
  }
  return null;
}
function normHeader(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function looksScientific(s) { return /^[0-9]+(\.[0-9]+)?e\+?\d+$/i.test(String(s).trim()); }
function expandSci(s) { const n = Number(s); if (!isFinite(n)) return String(s).trim(); return BigInt(Math.round(n)).toString(); }

function parseCSV(text) {
  const rows = []; let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function mapDailyCsvToNpa(csvRows) {
  const header = csvRows[0].map(normHeader);
  const idx = (name) => header.indexOf(normHeader(name));
  const iSol = idx('sol'), iBranch = idx('branch'), iAcct = idx('accountno'), iCust = idx('customerid'),
    iScheme = idx('schemecode'), iName = idx('accountname'), iBal = idx('balanceamount'),
    iNpaDate = idx('accountnpadate'), iSba = idx('sbaaccbalance'), iCategory = idx('category'),
    iSanctDt = idx('sanctiondate'), iLimit = idx('limit'), iMobile = idx('mobileno'), iInttRev = idx('inttrev');
  if (iAcct < 0 || iCust < 0 || iCategory < 0) {
    throw new Error('Unrecognized CSV layout — expected columns like "Account No", "Customer ID", "Category".');
  }
  let sciCount = 0;
  const slotCounter = new Map();
  const outRows = [];
  for (let r = 1; r < csvRows.length; r++) {
    const row = csvRows[r];
    if (!row || row.length < 3) continue;
    const acctRaw = (row[iAcct] || '').trim();
    if (!acctRaw) continue;
    let acctNo = acctRaw;
    if (looksScientific(acctRaw)) { acctNo = expandSci(acctRaw); sciCount++; }
    const custId = (row[iCust] || '').trim();
    const slot = (slotCounter.get(custId) || 0) + 1;
    slotCounter.set(custId, slot);
    let sbAcct = '', sbBal = '';
    const sbaRaw = row[iSba] || '';
    if (sbaRaw.includes('->')) {
      const parts = sbaRaw.split('->');
      sbAcct = parts[0].trim();
      sbBal = parseFloat(parts[1]) || 0;
    }
    const cat = (row[iCategory] || '').trim();
    const npaDate = (row[iNpaDate] || '').trim();
    const out = new Array(26).fill('');
    out[0] = custId + ':' + slot; out[2] = slot; out[3] = (row[iSol] || '').trim(); out[4] = (row[iBranch] || '').trim();
    out[5] = custId; out[6] = acctNo; out[7] = (row[iName] || '').trim();
    out[9] = (row[iMobile] || '').trim();
    out[13] = (row[iScheme] || '').trim(); out[14] = (row[iSanctDt] || '').trim();
    out[15] = parseFloat(row[iLimit]) || 0; out[16] = parseFloat(row[iBal]) || 0;
    out[18] = (iInttRev >= 0 && row[iInttRev] !== '' && row[iInttRev] !== undefined) ? (parseFloat(row[iInttRev]) || 0) : '';
    out[19] = cat; out[20] = npaDate; out[21] = cat; out[22] = npaDate; out[23] = npaDate;
    out[24] = sbAcct; out[25] = sbBal;
    outRows.push(out);
  }
  return { rows: outRows, sciCount };
}

function parseUploadedFile(buffer, filename) {
  const isCsv = /\.csv$/i.test(filename);

  if (isCsv) {
    const csvRows = parseCSV(buffer.toString('utf8'));
    const { rows, sciCount } = mapDailyCsvToNpa(csvRows);
    if (!rows.length) throw new Error('No account rows found in this file.');
    return {
      npa: { headers: [], rows },
      oldots: { headers: ['Account Number', 'Date', 'Amount'], rows: [] },
      sciCount,
      rowCount: rows.length,
    };
  }

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const npaSheetName = findSheet(wb, ['npa']);
  if (!npaSheetName) {
    throw new Error('No sheet named "NPA" found in this workbook. Rename the master sheet to "NPA" and try again.');
  }
  const npaWs = wb.Sheets[npaSheetName];
  const npaRaw = XLSX.utils.sheet_to_json(npaWs, { header: 1, raw: true, defval: '' });
  const npaRows = npaRaw.slice(1)
    .filter(r => r[6] !== '' && r[6] !== undefined && r[6] !== null)
    .map(r => {
      const row = [];
      for (let i = 0; i < 26; i++) row.push(normalizeCell(r[i]));
      return row;
    });

  let oldOtsRows = [];
  const oldOtsSheetName = findSheet(wb, ['oldots']);
  if (oldOtsSheetName) {
    const oldWs = wb.Sheets[oldOtsSheetName];
    const oldRaw = XLSX.utils.sheet_to_json(oldWs, { header: 1, raw: true, defval: '' });
    oldOtsRows = oldRaw.slice(1)
      .filter(r => r[0] !== '' && r[0] !== undefined && r[0] !== null)
      .map(r => [normalizeCell(r[0]), normalizeCell(r[1]), normalizeCell(r[2])]);
  }

  return {
    npa: { headers: [], rows: npaRows },
    oldots: { headers: ['Account Number', 'Date', 'Amount'], rows: oldOtsRows },
    sciCount: 0,
    rowCount: npaRows.length,
    oldOtsCount: oldOtsRows.length,
  };
}

module.exports = { parseUploadedFile };
