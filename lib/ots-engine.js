// Core OTS calculation engine — ported 1:1 from the original client-side calculator
// so every figure matches the source Excel workbook exactly. Runs server-side now
// so the raw NPA dataset never has to leave the server.

const C = {
  HELPER: 0, PROVISION: 1, MULTI: 2, SOL_ID: 3, SOL_DESC: 4, CUST_ID: 5, ACCT_NO: 6,
  NAME: 7, ADDR: 8, PHONE: 9, AADHAR: 10, PAN: 11, OPN_DT: 12, SCHEME: 13, SANCT_DT: 14,
  SANCT_LIM: 15, OUTBAL: 16, UNCHG: 17, URI: 18, ASSET: 19, USER_CLASS_DT: 20,
  SYS_SUBCLASS: 21, SYS_CLASS_DT: 22, NPA_DT: 23, SB_ACCT: 24, SB_BAL: 25
};
const PROV_RATES = { SUB_STD: .10, DA1: .20, DA2: .30, DA3: 1, LOSS: 1 };

const XL_EPOCH = new Date(1899, 11, 30);
function excelSerialToDate(n) { return new Date(XL_EPOCH.getTime() + n * 86400000); }
function toDate(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return excelSerialToDate(v);
  if (typeof v === 'string') {
    const m = v.split('-');
    if (m.length === 3 && m[2].length === 4) return new Date(+m[2], +m[1] - 1, +m[0]);
    const n = parseFloat(v);
    if (!isNaN(n)) return excelSerialToDate(n);
  }
  return null;
}
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function sameDate(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }

function computeUCI(os, npaDateRaw, scheme, rate) {
  rate = rate === undefined ? 8.5 : rate;
  if (!os || !npaDateRaw) return '';
  const npaDate = toDate(npaDateRaw);
  if (!npaDate) return '';
  const today = new Date();
  let anchor;
  if (scheme === 'CC004') {
    const y = npaDate.getFullYear();
    const sep24 = new Date(y, 8, 24), mar24 = new Date(y, 2, 24);
    anchor = npaDate > sep24 ? sep24 : (npaDate > mar24 ? mar24 : new Date(y - 1, 8, 24));
  } else {
    const eom = endOfMonth(npaDate);
    anchor = sameDate(npaDate, eom) ? new Date(npaDate.getFullYear(), npaDate.getMonth(), 29) : endOfMonth(new Date(npaDate.getFullYear(), npaDate.getMonth() - 1, 1));
  }
  return os * rate / 100 * (daysBetween(today, anchor) / 365);
}

function computeSlot(slot) {
  if (!slot) return null;
  const today = new Date();
  const npaDate = toDate(slot.npaDate);
  const daysNpa = npaDate ? daysBetween(today, npaDate) : '';
  const os = typeof slot.osBalance === 'number' ? slot.osBalance : '';
  const uri = typeof slot.uri === 'number' ? slot.uri : 0;
  const uci = os !== '' ? computeUCI(os, slot.npaDate, slot.scheme, 8.5) : '';
  const uci125 = os !== '' ? computeUCI(os, slot.npaDate, slot.scheme, 12.5) : '';
  const totalDues = (os !== '' && uci !== '') ? os + uci : '';
  const totalContractualDues = (os !== '' && uci125 !== '') ? os + uci125 : '';
  const netOutstanding = os !== '' ? os - uri : '';
  let provision = '';
  if (netOutstanding !== '' && PROV_RATES[slot.assetCode] !== undefined) provision = netOutstanding * PROV_RATES[slot.assetCode];
  const totalPL = (os !== '' && provision !== '') ? os - uri - provision : '';
  const eligibleCompromise = totalPL !== '' ? Math.max(0, totalPL) : '';
  const ratio = (eligibleCompromise !== '' && os) ? eligibleCompromise / os : '';
  const notEligible = (daysNpa !== '' && daysNpa <= 180);
  return { ...slot, daysNpa, os, uri, uci, uci125, totalDues, totalContractualDues, netOutstanding, provision, totalPL, eligibleCompromise, ratio, notEligible };
}

// In-memory dataset + indexes, mirroring the original client-side Maps.
class OtsStore {
  constructor() {
    this.npaRows = [];
    this.oldOtsRows = [];
    this.npaByHelper = new Map();
    this.byCustId = new Map();
    this.oldOtsByAcct = new Map();
  }

  load(data) {
    this.npaRows = (data && data.npa && data.npa.rows) || [];
    this.oldOtsRows = (data && data.oldots && data.oldots.rows) || [];
    this.npaByHelper = new Map();
    this.byCustId = new Map();
    this.oldOtsByAcct = new Map();
    for (const r of this.npaRows) {
      if (r[C.HELPER] !== '') this.npaByHelper.set(String(r[C.HELPER]), r);
      const cid = String(r[C.CUST_ID]);
      if (cid && !this.byCustId.has(cid)) this.byCustId.set(cid, r);
    }
    for (const r of this.oldOtsRows) {
      if (r[0] !== '' && !this.oldOtsByAcct.has(String(r[0]))) this.oldOtsByAcct.set(String(r[0]), { date: r[1], amount: r[2] });
    }
  }

  get rowCount() { return this.npaRows.length; }

  search(mode, q, limit = 60) {
    const needle = String(q).trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set();
    const matches = [];
    for (const r of this.npaRows) {
      const val = r[mode.col];
      if (val === '' || val === null) continue;
      if (String(val).toLowerCase().includes(needle)) {
        const cid = String(r[C.CUST_ID]);
        const key = mode.id === 'acct' ? String(r[C.ACCT_NO]) : cid;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push(r);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  lookupLoanSlot(custId, slotNo) {
    const row = this.npaByHelper.get(custId + ':' + slotNo);
    if (!row) return null;
    return {
      acctNo: row[C.ACCT_NO], scheme: row[C.SCHEME] || '', sanctionDate: row[C.SANCT_DT] || '',
      sanctionLimit: row[C.SANCT_LIM] === '' ? '' : row[C.SANCT_LIM], assetCode: row[C.ASSET] || '',
      npaDate: row[C.NPA_DT] || '', osBalance: row[C.OUTBAL] === '' ? '' : row[C.OUTBAL], uri: row[C.URI] === '' ? 0 : row[C.URI],
    };
  }

  getCustomerDetail(custId) {
    const custRow = this.byCustId.get(custId);
    if (!custRow) return null;
    const slots = [1, 2, 3, 4].map(n => {
      const s = this.lookupLoanSlot(custId, n);
      return s ? computeSlot(s) : null;
    }).filter(Boolean);
    const prevOts = this.oldOtsByAcct.get(String(custRow[C.ACCT_NO]));
    return { custRow, slots, prevOts };
  }
}

module.exports = { C, PROV_RATES, toDate, computeUCI, computeSlot, OtsStore };
