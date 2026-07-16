(function () {
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
  function fmtDate(d) { if (!d) return '—'; return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear(); }
  function fmtINR(n) { if (n === '' || n === null || n === undefined || isNaN(n)) return '—'; return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function esc(s) { return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const ASSET_LABELS = { SUB_STD: 'Substandard asset', DA1: 'Doubtful — up to 1 year', DA2: 'Doubtful — 1 to 3 years', DA3: 'Doubtful — more than 3 years', LOSS: 'Loss asset' };
  function assetLabel(code) { return ASSET_LABELS[code] || code; }

  document.getElementById('reportDateTxt').textContent = fmtDate(new Date());

  const SEARCH_MODES = [
    { id: 'acct', label: 'Account No.', ph: 'e.g. 160835110000679' },
    { id: 'cust', label: 'Cust ID', ph: 'e.g. 700962400' },
    { id: 'mobile', label: 'Mobile No.', ph: 'e.g. 9876543210' },
    { id: 'aadhar', label: 'Aadhar No.', ph: 'e.g. 913206620914' },
    { id: 'pan', label: 'PAN', ph: 'e.g. BJAPV4204K' },
    { id: 'sb', label: 'SB No.', ph: 'e.g. 152910100005105' },
  ];
  let searchMode = 'acct';
  const pillsEl = document.getElementById('modePills');
  const searchInputEl = document.getElementById('searchInput');
  SEARCH_MODES.forEach(m => {
    const b = document.createElement('button');
    b.textContent = m.label; b.dataset.mode = m.id;
    if (m.id === searchMode) b.classList.add('active');
    b.onclick = () => {
      searchMode = m.id;
      pillsEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      searchInputEl.placeholder = m.ph;
      if (searchInputEl.value.trim()) runSearch(); else renderEmpty();
    };
    pillsEl.appendChild(b);
  });

  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearBtn');
  searchInput.addEventListener('input', () => { clearBtn.style.display = searchInput.value ? 'flex' : 'none'; });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  function clearSearch() { searchInput.value = ''; clearBtn.style.display = 'none'; renderEmpty(); }

  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) { renderEmpty(); return; }
    const mode = SEARCH_MODES.find(m => m.id === searchMode);
    document.getElementById('mainArea').innerHTML = `<div class="results-hint">Searching…</div>`;
    try {
      const res = await fetch(`/api/search?mode=${encodeURIComponent(searchMode)}&q=${encodeURIComponent(q)}`);
      if (res.status === 401) { window.location.href = '/'; return; }
      const data = await res.json();
      renderResults(data.matches || [], mode);
    } catch (e) {
      document.getElementById('mainArea').innerHTML = `<div class="no-results">Network error while searching. Check your connection and try again.</div>`;
    }
  }

  function renderEmpty() {
    const mode = SEARCH_MODES.find(m => m.id === searchMode);
    document.getElementById('mainArea').innerHTML = `
    <div class="empty-state">
      <svg class="logo-big" width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
        <path d="M3 10.5 12 4l9 6.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4.5 10.5V19a1 1 0 0 0 1 1H8v-5.2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V20h2.5a1 1 0 0 0 1-1v-8.5" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="2.5" y1="20" x2="21.5" y2="20" stroke-linecap="round"/>
      </svg>
      <h2>OTS Calculator</h2>
      <p>Search by ${esc(mode.label)} to view borrower details</p>
    </div>`;
  }

  function renderResults(matches, mode) {
    const el = document.getElementById('mainArea');
    if (!matches.length) {
      el.innerHTML = `<div class="results-hint">0 matches found</div>` +
        `<div class="no-results">` +
        `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` +
        `<div>No borrower matches that ${esc(mode.label)}.<br>Try a different value or search mode.</div></div>`;
      return;
    }
    el.innerHTML = `<div class="results-hint">${matches.length} match${matches.length > 1 ? 'es' : ''} found</div>` +
      `<div class="results-grid">` +
      matches.map(r => {
        const asset = r.asset || '';
        const npaDate = fmtDate(toDate(r.npaDate));
        return `
      <div class="result-card" data-asset="${esc(asset)}" onclick="openDetail('${esc(r.custId)}')">
        <div class="result-top">
          <div>
            <div class="result-name">${esc(r.name) || '—'}</div>
            <div class="result-acc">A/c · ${esc(r.acctNo)}</div>
            <div class="result-scheme">${esc(r.solDesc) || ''}</div>
          </div>
          ${asset ? `<span class="badge-pill ${esc(asset)}" title="${esc(assetLabel(asset))}">${esc(asset)}</span>` : ''}
        </div>
        <div class="result-grid">
          <div><div class="k">O/S Balance</div><div class="v">${fmtINR(r.outbal)}</div></div>
          <div><div class="k">NPA Date</div><div class="v">${npaDate}</div></div>
          <div><div class="k">Branch</div><div class="v">${esc(r.solDesc) || '—'}</div></div>
        </div>
        <div class="result-bottom">
          <span>Cust ID: ${esc(r.custId)}</span>
          <span class="chev" aria-hidden="true">›</span>
        </div>
      </div>`;
      }).join('') + `</div>`;
  }

  /* ---------- Detail view ---------- */
  let otsAmounts = {};
  let frozen = {};

  async function openDetail(custId) {
    let data;
    try {
      const res = await fetch(`/api/detail?custId=${encodeURIComponent(custId)}`);
      if (res.status === 401) { window.location.href = '/'; return; }
      if (!res.ok) return;
      data = await res.json();
    } catch (e) { return; }

    const { custRow, slots, prevOts } = data;
    otsAmounts = {}; frozen = {};

    document.getElementById('searchHeader').style.display = 'none';
    const footEl = document.querySelector('footer.app-foot'); if (footEl) footEl.style.display = 'none';
    document.getElementById('railLeft').classList.add('show');
    document.getElementById('railRight').classList.add('show');
    const el = document.getElementById('mainArea');
    el.innerHTML = `
    <div class="detail-head">
      <div class="detail-headrow">
        <button class="back-btn" onclick="closeDetail()" aria-label="Back to search results">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="detail-headtext">
          <h2>${esc(custRow.name) || '—'}</h2>
          <p>${esc(custRow.solDesc) || ''} · Cust ID ${esc(custRow.custId)}</p>
        </div>
        <button class="share-btn" onclick="window.print()" title="Print / Share" aria-label="Print or share this report">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </button>
      </div>
    </div>
    <div id="detailBody" style="padding-top:14px"></div>
  `;
    drawDetailBody(custRow, slots, prevOts);
    window.scrollTo({ top: 0 });
  }

  function closeDetail() {
    document.getElementById('searchHeader').style.display = '';
    document.getElementById('railLeft').classList.remove('show');
    document.getElementById('railRight').classList.remove('show');
    document.getElementById('eligibleBanner').classList.remove('show');
    const footEl = document.querySelector('footer.app-foot'); if (footEl) footEl.style.display = '';
    runSearch();
  }

  function drawDetailBody(custRow, slots, prevOts) {
    const body = document.getElementById('detailBody');
    const totalOS = slots.reduce((a, s) => a + ((s.os !== '') ? s.os : 0), 0);
    const totalDues = slots.reduce((a, s) => a + ((s.totalDues !== '') ? s.totalDues : 0), 0);
    const totalPL = slots.reduce((a, s) => a + ((s.totalPL !== '') ? s.totalPL : 0), 0);
    const totalContractualDues = slots.reduce((a, s) => a + ((s.totalContractualDues !== '') ? s.totalContractualDues : 0), 0);

    body.innerHTML = `
    <div class="card borrower-card">
      <div class="bname">${esc(custRow.name) || '—'}</div>
      <div class="baddr">${esc(custRow.addr) || '—'}</div>
      <div class="info-grid">
        <div><div class="k">Cust ID</div><div class="v">${esc(custRow.custId) || '—'}</div></div>
        <div><div class="k">Sol ID</div><div class="v">${esc(custRow.solId) || '—'}</div></div>
        <div><div class="k">Mobile</div><div class="v">${esc(custRow.phone) || '—'}</div></div>
        <div><div class="k">Aadhar</div><div class="v">${esc(custRow.aadhar) || '—'}</div></div>
        <div><div class="k">PAN</div><div class="v">${esc(custRow.pan) || '—'}</div></div>
        <div><div class="k">Branch</div><div class="v">${esc(custRow.solDesc) || '—'}</div></div>
        <div><div class="k">SB A/C</div><div class="v">${esc(custRow.sbAcct) || '—'}</div></div>
        <div><div class="k">SB Balance</div><div class="v">${fmtINR(custRow.sbBal === '' ? 0 : custRow.sbBal)}</div></div>
      </div>
      ${prevOts ? `<div class="linked-note">⏱ Previous OTS on record: ${esc(prevOts.date)} — ${esc(prevOts.amount)}</div>` : ''}
      <div class="linked-note">🔗 ${slots.length} loan account${slots.length > 1 ? 's' : ''} linked</div>
    </div>

    <div class="loans-col">
    <div class="section-label">Loan Accounts</div>
    <div class="section-sub">All accounts side-by-side · Enter OTS amount below</div>

    ${loanTableHTML(slots)}
  </div>
  `;

    window.__slots = slots;
    window.__totalDues = totalDues;
    window.__totalPL = totalPL;
    window.__totalContractualDues = totalContractualDues;
    window.__totalOS = totalOS;
    window.__custRow = custRow;
    window.__prevOts = prevOts;

    slots.forEach((s, i) => recalcLoan(i));
    recalcAggregate();

    const notEligibleAccts = slots.filter(s => s.notEligible).map(s => s.acctNo);
    const banner = document.getElementById('eligibleBanner');
    if (notEligibleAccts.length) {
      document.getElementById('eligibleBannerText').textContent =
        `Not eligible — A/c ${notEligibleAccts.map(a => esc(String(a))).join(', ')} NPA not aged 6 months`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  }

  function loanTableHTML(slots) {
    const cols = slots.map(s => `
    <th scope="col">
      <div class="lt-acc">A/c · ${esc(s.acctNo)}</div>
      <div class="lt-scheme">${esc(s.scheme) || ''}</div>
      ${s.assetCode ? `<span class="badge-pill ${esc(s.assetCode)}" title="${esc(assetLabel(s.assetCode))}">${esc(s.assetCode)}</span>` : ''}
    </th>`).join('');
    const group = (label) => `<tr class="lt-group"><td colspan="${slots.length + 1}">${label}</td></tr>`;
    const row = (label, fn, cls = '') => `<tr class="${cls}"><th scope="row" class="lt-label">${label}</th>${slots.map(s => `<td>${fn(s)}</td>`).join('')}</tr>`;
    const statRow = (label, idPrefix) => `<tr><th scope="row" class="lt-label">${label}</th>${slots.map((s, i) => `<td id="${idPrefix}-${i}">—</td>`).join('')}</tr>`;
    const otsRow = () => `<tr class="lt-ots-row"><th scope="row" class="lt-label">Settlement (OTS) Amount</th>${slots.map((s, i) => `
      <td><div class="lt-ots-cell">
        <button type="button" class="freeze-chip lt-freeze${frozen[s.acctNo] ? ' frozen' : (otsAmounts[s.acctNo] ? ' ready' : '')}" id="freezeBtn-${i}"
          onclick="toggleFreeze(${i},'${esc(String(s.acctNo))}')"
          title="${frozen[s.acctNo] ? 'Frozen — click to edit' : 'Freeze this OTS amount'}"
          aria-label="${frozen[s.acctNo] ? 'Unfreeze OTS amount' : 'Freeze OTS amount'} for account ${esc(String(s.acctNo))}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        </button>
        <span class="lt-cur">₹</span>
        <input type="number" class="lt-ots-input" id="otsInput-${i}" placeholder="0" value="${otsAmounts[s.acctNo] || ''}"
          aria-label="OTS amount for account ${esc(String(s.acctNo))}"
          oninput="onOtsInput(${i},'${esc(String(s.acctNo))}')" ${frozen[s.acctNo] ? 'disabled' : ''}>
        <span class="pct-tag" id="pctNetOs-${i}"></span>
      </div></td>`).join('')}</tr>`;
    const eligRow = slots.some(s => s.notEligible) ? `<tr><th scope="row" class="lt-label"></th>${slots.map(s => `<td>${s.notEligible ? '<span class="eligibility-warn">⚠ Not aged 6mo</span>' : ''}</td>`).join('')}</tr>` : '';

    return `
  <div class="loan-table-wrap">
  <table class="loan-table">
    <thead><tr><th scope="col" class="lt-label">Particulars</th>${cols}</tr></thead>
    <tbody>
      ${eligRow}
      ${group('Loan Terms')}
      ${row('Sanction Date', s => fmtDate(toDate(s.sanctionDate)))}
      ${row('Sanction Limit', s => fmtINR(s.sanctionLimit))}
      ${row('NPA Date', s => fmtDate(toDate(s.npaDate)))}
      ${row('O/S Balance', s => fmtINR(s.os), 'lt-strong')}
      ${group('Dues &amp; Provisioning')}
      ${row('UCI @ 8.5%', s => fmtINR(s.uci))}
      ${row('Total Dues', s => fmtINR(s.totalDues), 'lt-strong')}
      ${row('Total Contractual Dues', s => fmtINR(s.totalContractualDues), 'lt-strong lt-divider')}
      ${row('Interest Reversal', s => fmtINR(s.uri))}
      ${row('Net O/S', s => fmtINR(s.netOutstanding))}
      ${row('Provision', s => fmtINR(s.provision))}
      ${row('Total P&amp;L', s => fmtINR(s.totalPL) + (s.ratio !== '' ? ` <span class="pct-tag">${(s.ratio * 100).toFixed(1)}%</span>` : ''), 'lt-strong lt-divider')}
      ${group('Settlement &amp; Impact')}
      ${otsRow()}
      ${statRow('Total Sacrifice', 'totalSac')}
      ${statRow('Ledger Sacrifice', 'ledgerSac')}
      ${statRow('BDWO Amount', 'bdwo')}
      ${statRow('P&amp;L Impact', 'impact')}
    </tbody>
  </table>
  </div>`;
  }

  function onOtsInput(i, acctNo) {
    const v = document.getElementById('otsInput-' + i).value;
    otsAmounts[acctNo] = v;
    const btn = document.getElementById('freezeBtn-' + i);
    if (btn && !frozen[acctNo]) btn.classList.toggle('ready', v !== '' && !isNaN(parseFloat(v)));
    recalcLoan(i);
    recalcAggregate();
  }

  function toggleFreeze(i, acctNo) {
    const isFrozen = !!frozen[acctNo];
    const v = otsAmounts[acctNo];
    if (!isFrozen && (v === undefined || v === '' || isNaN(parseFloat(v)))) return;
    frozen[acctNo] = !isFrozen;
    const btn = document.getElementById('freezeBtn-' + i);
    const input = document.getElementById('otsInput-' + i);
    if (!input) return;
    if (frozen[acctNo]) {
      if (btn) { btn.classList.remove('ready'); btn.classList.add('frozen'); btn.title = 'Frozen — click to edit'; }
      input.disabled = true;
    } else {
      if (btn) { btn.classList.remove('frozen'); btn.classList.toggle('ready', v !== undefined && v !== '' && !isNaN(parseFloat(v))); btn.title = 'Freeze this OTS amount'; }
      input.disabled = false; input.focus();
    }
  }

  function recalcLoan(i) {
    const s = window.__slots[i];
    const raw = otsAmounts[s.acctNo];
    const ots = (raw === '' || raw === undefined) ? '' : parseFloat(raw);
    const totalSacEl = document.getElementById('totalSac-' + i);
    const ledgerEl = document.getElementById('ledgerSac-' + i);
    const bdwoEl = document.getElementById('bdwo-' + i);
    const impactEl = document.getElementById('impact-' + i);
    const pctEl = document.getElementById('pctNetOs-' + i);
    if (ots === '' || isNaN(ots)) {
      [totalSacEl, ledgerEl, bdwoEl, impactEl].forEach(e => e.textContent = '—');
      impactEl.classList.remove('pos', 'neg');
      if (pctEl) pctEl.textContent = '';
      return;
    }
    const totalSac = s.totalContractualDues !== '' ? s.totalContractualDues - ots : '';
    const ledgerSac = s.os !== '' ? s.os - ots : '';
    const bdwo = (ledgerSac !== '' && s.uri !== '') ? ledgerSac - s.uri : '';
    const impact = s.totalPL !== '' ? ots - s.totalPL : '';
    totalSacEl.textContent = fmtINR(totalSac);
    ledgerEl.textContent = fmtINR(ledgerSac);
    bdwoEl.textContent = fmtINR(bdwo);
    if (pctEl) pctEl.textContent = (s.netOutstanding && s.netOutstanding !== '') ? (ots / s.netOutstanding * 100).toFixed(1) + '%' : '—';
    impactEl.classList.remove('pos', 'neg');
    if (impact !== '' && !isNaN(impact)) {
      const sign = impact > 0 ? '+' : (impact < 0 ? '−' : '');
      impactEl.textContent = sign + fmtINR(Math.abs(impact)).replace('₹', '₹ ');
      impactEl.classList.add(impact > 0 ? 'pos' : (impact < 0 ? 'neg' : ''));
    } else {
      impactEl.textContent = fmtINR(impact);
    }
    impactEl.classList.remove('flash');
    void impactEl.offsetWidth;
    impactEl.classList.add('flash');
  }

  function recalcAggregate() {
    const slots = window.__slots;
    let totalOts = 0, any = false;
    slots.forEach(s => {
      const v = otsAmounts[s.acctNo];
      if (v !== undefined && v !== '' && !isNaN(parseFloat(v))) { totalOts += parseFloat(v); any = true; }
    });
    const otsTxt = any ? fmtINR(totalOts) : '—';
    const railOts = document.getElementById('railOts'); if (railOts) railOts.textContent = otsTxt;
    const railOts2 = document.getElementById('railOts2'); if (railOts2) railOts2.textContent = otsTxt;
    const railDues = document.getElementById('railDues'); if (railDues) railDues.textContent = fmtINR(window.__totalDues);
    const railPLLeft = document.getElementById('railPLLeft');
    if (railPLLeft) {
      const impact = any ? (totalOts - window.__totalPL) : '';
      railPLLeft.textContent = impact === '' ? '—' : (impact > 0 ? '+' : (impact < 0 ? '−' : '')) + fmtINR(Math.abs(impact));
      railPLLeft.classList.remove('pos', 'neg');
      if (impact !== '') { if (impact > 0) railPLLeft.classList.add('pos'); else if (impact < 0) railPLLeft.classList.add('neg'); }
    }
    const railSac = document.getElementById('railSac'); if (railSac) railSac.textContent = any ? fmtINR(window.__totalContractualDues - totalOts) : '—';
    renderPrintView();
  }

  function renderPrintView() {
    const slots = window.__slots; const custRow = window.__custRow;
    if (!slots || !custRow) return;
    const totalOS = slots.reduce((a, s) => a + ((s.os !== '') ? s.os : 0), 0);
    const totalDues = window.__totalDues;

    function otsFor(s) {
      const raw = otsAmounts[s.acctNo];
      const v = (raw === '' || raw === undefined) ? NaN : parseFloat(raw);
      return isNaN(v) ? null : v;
    }
    let totalOtsSum = 0, anyOts = false;
    slots.forEach(s => { const v = otsFor(s); if (v !== null) { totalOtsSum += v; anyOts = true; } });

    const rows = [
      ['Sanction Date', s => fmtDate(toDate(s.sanctionDate))],
      ['Sanction Limit', s => fmtINR(s.sanctionLimit)],
      ['Asset Code', s => esc(s.assetCode) || '—'],
      ['NPA Date', s => fmtDate(toDate(s.npaDate))],
      ['Days in NPA', s => s.daysNpa !== '' ? s.daysNpa.toLocaleString('en-IN') + ' days' : '—'],
      ['O/S Balance', s => fmtINR(s.os)],
      ['UCI @ 8.5%', s => fmtINR(s.uci)],
      ['Total Dues', s => fmtINR(s.totalDues)],
      ['Total Contractual Dues', s => fmtINR(s.totalContractualDues)],
      ['Interest Reversal', s => fmtINR(s.uri)],
      ['Net O/S', s => fmtINR(s.netOutstanding)],
      ['Provision', s => fmtINR(s.provision)],
      ['Total P&L', s => fmtINR(s.totalPL) + (s.ratio !== '' ? ` (${(s.ratio * 100).toFixed(1)}%)` : '')],
      ['OTS Amount', s => { const v = otsFor(s); return v === null ? '—' : fmtINR(v); }],
      ['Total Sacrifice', s => { const v = otsFor(s); return v === null ? '—' : fmtINR(s.totalContractualDues - v); }],
      ['Ledger Sacrifice', s => { const v = otsFor(s); return v === null ? '—' : fmtINR(s.os - v); }],
      ['BDWO Amount', s => { const v = otsFor(s); return v === null ? '—' : fmtINR((s.os - v) - s.uri); }],
      ['Impact on P&L', s => { const v = otsFor(s); return v === null ? '—' : fmtINR(v - s.totalPL); }],
    ];
    const tableRows = rows.map(([label, fn]) => `<tr><td class="pv-label">${label}</td>${slots.map(s => `<td>${fn(s)}</td>`).join('')}</tr>`).join('');

    document.getElementById('printArea').innerHTML = `
    <div class="pv-header">
      <div class="pv-title">UPGB OTS CALCULATOR</div>
      <div class="pv-sub">Uttar Pradesh Gramin Bank</div>
      <div class="pv-meta"><span>Report Date: ${fmtDate(new Date())}</span><span>Branch: ${esc(custRow.solDesc) || ''}</span></div>
    </div>
    <div class="pv-borrower">
      <div class="pv-name">${esc(custRow.name) || '—'}</div>
      <div class="pv-addr">${esc(custRow.addr) || '—'}</div>
      <div class="pv-info-grid">
        <div><span class="k">Cust ID</span><span class="v">${esc(custRow.custId) || '—'}</span></div>
        <div><span class="k">Sol ID</span><span class="v">${esc(custRow.solId) || '—'}</span></div>
        <div><span class="k">Mobile</span><span class="v">${esc(custRow.phone) || '—'}</span></div>
        <div><span class="k">Aadhar</span><span class="v">${esc(custRow.aadhar) || '—'}</span></div>
        <div><span class="k">PAN</span><span class="v">${esc(custRow.pan) || '—'}</span></div>
        <div><span class="k">Branch</span><span class="v">${esc(custRow.solDesc) || '—'}</span></div>
        <div><span class="k">SB A/c</span><span class="v">${esc(custRow.sbAcct) || '—'}</span></div>
        <div><span class="k">SB Balance</span><span class="v">${fmtINR(custRow.sbBal === '' ? 0 : custRow.sbBal)}</span></div>
      </div>
    </div>
    <table class="pv-table">
      <thead><tr><th>Particulars</th>${slots.map(s => `<th>${esc(s.acctNo)}</th>`).join('')}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="pv-agg">
      <div class="pv-agg-title">A G G R E G A T E&nbsp;&nbsp;T O T A L S</div>
      <div class="pv-agg-row"><span>Total O/S Balance</span><span>${fmtINR(totalOS)}</span></div>
      <div class="pv-agg-row"><span>Total Dues</span><span>${fmtINR(totalDues)}</span></div>
      <div class="pv-agg-row"><span>Total OTS Amount</span><span>${anyOts ? fmtINR(totalOtsSum) : '—'}</span></div>
      <div class="pv-agg-row"><span>Total Sacrifice</span><span>${anyOts ? fmtINR(window.__totalContractualDues - totalOtsSum) : '—'}</span></div>
    </div>
    <div class="pv-footer">Designed &amp; Developed by ALOK MITTAL · Uttar Pradesh Gramin Bank</div>
    <div class="pv-schemes">${slots.map(s => `<span>${esc(s.scheme) || ''} · ${esc(custRow.solDesc) || ''}</span>`).join('')}</div>
  `;
  }

  function toggleModal(show) { document.getElementById('modalOverlay').classList.toggle('show', show); }
  function toggleUpdateModal(show) {
    document.getElementById('updateModalOverlay').classList.toggle('show', show);
    if (!show) {
      document.getElementById('uploadStatus').innerHTML = '';
      document.getElementById('uploadSummary').innerHTML = '';
      document.getElementById('applyDataBtn').disabled = true;
      document.getElementById('fileInput').value = '';
      document.getElementById('uploadDropLabel').textContent = 'Tap to choose a file';
    }
  }
  function openUpdateModal() { toggleUpdateModal(true); }

  let __pendingFile = null;

  function handleFileUpload(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    __pendingFile = file;
    document.getElementById('uploadDropLabel').textContent = file.name;
    document.getElementById('uploadStatus').innerHTML = `<div class="upload-status info">Ready to upload — click Apply Update.</div>`;
    document.getElementById('uploadSummary').innerHTML = '';
    document.getElementById('applyDataBtn').disabled = false;
  }

  async function applyNewData() {
    if (!__pendingFile) return;
    const statusEl = document.getElementById('uploadStatus');
    const summaryEl = document.getElementById('uploadSummary');
    const btn = document.getElementById('applyDataBtn');
    btn.disabled = true;
    statusEl.innerHTML = `<div class="upload-status info">Uploading and parsing…</div>`;
    try {
      const fd = new FormData();
      fd.append('file', __pendingFile);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      statusEl.innerHTML = `<div class="upload-status ok">✔ Data updated — ${data.rowCount.toLocaleString('en-IN')} NPA rows now active.</div>` +
        (data.sciCount ? `<div class="upload-status err" style="margin-top:8px">⚠ ${data.sciCount.toLocaleString('en-IN')} account number(s) were stored in scientific notation and may be missing trailing digits.</div>` : '');
      summaryEl.innerHTML = `
        <div class="upload-summary">
          <div class="box"><div class="k">NPA rows found</div><div class="v">${data.rowCount.toLocaleString('en-IN')}</div></div>
          <div class="box"><div class="k">OLD OTS rows found</div><div class="v">${(data.oldOtsCount || 0).toLocaleString('en-IN')}</div></div>
        </div>`;
      otsAmounts = {}; frozen = {};
      renderEmpty();
      __pendingFile = null;
    } catch (e) {
      statusEl.innerHTML = `<div class="upload-status err">⚠ ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/';
  }

  function wireStaticButtons() {
    const on = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };
    on('updateDataBtn', 'click', () => openUpdateModal());
    on('aboutBtn', 'click', () => toggleModal(true));
    on('aboutCloseBtn', 'click', () => toggleModal(false));
    on('clearBtn', 'click', () => clearSearch());
    on('searchGoBtn', 'click', () => runSearch());
    on('uploadDrop', 'click', () => document.getElementById('fileInput').click());
    on('fileInput', 'change', (e) => handleFileUpload(e));
    on('updateCancelBtn', 'click', () => toggleUpdateModal(false));
    on('applyDataBtn', 'click', () => applyNewData());
    on('eligibleBanner', 'click', () => document.getElementById('eligibleBanner').classList.remove('show'));
    on('logoutBtn', 'click', () => logout());
  }

  window.openDetail = openDetail;
  window.closeDetail = closeDetail;
  window.toggleFreeze = toggleFreeze;
  window.onOtsInput = onOtsInput;

  wireStaticButtons();
  renderEmpty();
})();
