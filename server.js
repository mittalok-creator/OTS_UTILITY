const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const { C, toDate, OtsStore } = require('./lib/ots-engine');
const { parseUploadedFile } = require('./lib/parse-upload');

const APP_PASSPHRASE = process.env.APP_PASSPHRASE;
const SESSION_SECRET = process.env.SESSION_SECRET;
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'npa-data.json');

if (!APP_PASSPHRASE || !SESSION_SECRET) {
  console.error('Missing APP_PASSPHRASE or SESSION_SECRET. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const store = new OtsStore();
if (fs.existsSync(DATA_FILE)) {
  try {
    store.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    console.log(`Loaded ${store.rowCount} NPA rows from disk.`);
  } catch (e) {
    console.error('Failed to load persisted data file:', e.message);
  }
}

const SEARCH_MODES = [
  { id: 'acct', label: 'Account No.', col: C.ACCT_NO },
  { id: 'cust', label: 'Cust ID', col: C.CUST_ID },
  { id: 'mobile', label: 'Mobile No.', col: C.PHONE },
  { id: 'aadhar', label: 'Aadhar No.', col: C.AADHAR },
  { id: 'pan', label: 'PAN', col: C.PAN },
  { id: 'sb', label: 'SB No.', col: C.SB_ACCT },
];

const app = express();
app.set('trust proxy', 1); // needed behind Render/Railway/any reverse proxy for secure cookies to work
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  name: 'upgb.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
  },
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

// ---------- Auth routes ----------
app.post('/api/login', loginLimiter, (req, res) => {
  const { passphrase } = req.body || {};
  if (typeof passphrase === 'string' && safeEqual(passphrase, APP_PASSPHRASE)) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect passphrase' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- Static public assets (no PII in any of these) ----------
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
app.get('/service-worker.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'service-worker.js')));

// ---------- Pages ----------
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/app');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});
app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'app.html'));
});

// ---------- Data API (all require auth) ----------
app.get('/api/state', requireAuth, (req, res) => {
  res.json({ loaded: store.rowCount > 0, rowCount: store.rowCount, reportDate: new Date().toISOString() });
});

function toResultCard(row) {
  return {
    custId: String(row[C.CUST_ID]),
    acctNo: String(row[C.ACCT_NO]),
    name: row[C.NAME] || '',
    solDesc: row[C.SOL_DESC] || '',
    asset: row[C.ASSET] || '',
    outbal: row[C.OUTBAL],
    npaDate: row[C.NPA_DT],
  };
}

app.get('/api/search', requireAuth, (req, res) => {
  const modeId = req.query.mode;
  const q = req.query.q;
  const mode = SEARCH_MODES.find(m => m.id === modeId);
  if (!mode) return res.status(400).json({ error: 'Invalid search mode' });
  if (!q || !String(q).trim()) return res.json({ matches: [] });
  const rows = store.search(mode, q, 60);
  res.json({ matches: rows.map(toResultCard) });
});

app.get('/api/detail', requireAuth, (req, res) => {
  const custId = String(req.query.custId || '');
  const detail = store.getCustomerDetail(custId);
  if (!detail) return res.status(404).json({ error: 'Not found' });
  const { custRow, slots, prevOts } = detail;
  res.json({
    custRow: {
      custId: custRow[C.CUST_ID], solId: custRow[C.SOL_ID], name: custRow[C.NAME], addr: custRow[C.ADDR],
      phone: custRow[C.PHONE], aadhar: custRow[C.AADHAR], pan: custRow[C.PAN], solDesc: custRow[C.SOL_DESC],
      sbAcct: custRow[C.SB_ACCT], sbBal: custRow[C.SB_BAL],
    },
    slots,
    prevOts: prevOts || null,
  });
});

// ---------- Data upload (admin-style, still just needs the shared passphrase session) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const parsed = parseUploadedFile(req.file.buffer, req.file.originalname);
    store.load(parsed);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ npa: parsed.npa, oldots: parsed.oldots }));
    res.json({ ok: true, rowCount: parsed.rowCount, oldOtsCount: parsed.oldOtsCount || 0, sciCount: parsed.sciCount || 0 });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`UPGB OTS webapp listening on port ${PORT}`));
