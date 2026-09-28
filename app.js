/* StockPulse front end: vanilla JS, no build step */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}

/* ---------- formatting ---------- */
const nf = (n, d = 2) => n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const inr = (n, d = 2) => n == null ? '—' : '₹' + nf(n, d);
const cr = n => n == null ? '—' : '₹' + Number(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr';
const pc = n => n == null ? '—' : nf(n, 1) + '%';
const sgn = n => n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
const sp = n => n == null ? '—' : (n > 0 ? '+' : '') + nf(n, 2) + '%';
const FMT = { x: v => nf(v, 2), n: v => nf(v, 2), inr, cr, pc, vol: v => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) };

/* ---------- state ---------- */
const S = { me: null, watch: new Set(), sym: null, timers: [], charts: null, range: '6M', marketOpen: false, last: null };
const every = (ms, fn) => S.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };
let tapeTimer = null;

/* ---------- header: auth ---------- */
function renderAuth() {
  const box = $('#auth');
  if (S.me) {
    box.innerHTML = `<span class="who">Hi, ${esc(S.me)}</span><button class="btn" id="btnOut">Log out</button>`;
    $('#btnOut').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      S.me = null; S.watch = new Set(); renderAuth(); route();
    };
  } else {
    box.innerHTML = `<button class="btn primary" id="btnIn">Log in</button>`;
    $('#btnIn').onclick = () => openAuth('login');
  }
}

let authMode = 'login';
function openAuth(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('#tabLogin').setAttribute('aria-selected', String(!reg));
  $('#tabReg').setAttribute('aria-selected', String(reg));
  $('#authTitle').textContent = reg ? 'Create your account' : 'Welcome back';
  $('#authGo').textContent = reg ? 'Create account' : 'Log in';
  $('#authFields').innerHTML = reg
    ? `<label for="fU">Username</label><input id="fU" autocomplete="username">
       <label for="fE">Email</label><input id="fE" type="email" autocomplete="email">
       <label for="fP">Password (8+ characters)</label><input id="fP" type="password" autocomplete="new-password">`
    : `<label for="fI">Username or email</label><input id="fI" autocomplete="username">
       <label for="fP">Password</label><input id="fP" type="password" autocomplete="current-password">`;
  $('#authErr').textContent = '';
  const dlg = $('#authDlg');
  if (!dlg.open) dlg.showModal();
  setTimeout(() => $('#authFields input')?.focus(), 30);
}

async function submitAuth() {
  const err = $('#authErr'); err.textContent = '';
  const btn = $('#authGo'); btn.disabled = true;
  try {
    const body = authMode === 'register'
      ? { username: $('#fU').value, email: $('#fE').value, password: $('#fP').value }
      : { identifier: $('#fI').value, password: $('#fP').value };
    const r = await api(authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(body) });
    S.me = r.user; $('#authDlg').close();
    await loadWatchSet(); renderAuth(); route();
  } catch (e) { err.textContent = e.message; }
  btn.disabled = false;
}

async function loadWatchSet() {
  if (!S.me) return;
  try { S.watch = new Set((await api('/api/watchlist')).symbols); } catch { /* ignore */ }
}

/* ---------- header: index tape ---------- */
async function loadTape() {
  try {
    const d = await api('/api/indices');
    $('#tape').innerHTML = d.indices.map(i => `
      <div class="ix"><b>${esc(i.name)}</b><span>${nf(i.price)}</span>
      <span class="${sgn(i.change_pct)}">${i.change_pct == null ? '' : sp(i.change_pct)}</span></div>`).join('') +
      `<div class="mk"><span class="dot ${d.market_open ? 'live' : ''}"></span>${d.market_open ? 'Market open' : 'Market closed'} · ${esc(d.time)}</div>`;
    S.marketOpen = d.market_open;
  } catch { /* keep the previous tape */ }
}

/* ---------- search ---------- */
const q = $('#q'), sug = $('#sug');
let sugItems = [], sugIdx = -1, qTimer = null;

function showSug(items, raw) {
  sugItems = items; sugIdx = -1;
  if (!raw) { sug.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
  sug.innerHTML = items.length
    ? items.map((s, i) => `<li role="option" data-i="${i}"><b>${esc(s.symbol)}</b><span>${esc(s.name)}</span></li>`).join('')
    : `<li class="none">No match. Press Enter to try “${esc(raw.toUpperCase())}” as an NSE symbol.</li>`;
  sug.hidden = false; q.setAttribute('aria-expanded', 'true');
}
function pick(sym) {
  sug.hidden = true; q.value = ''; q.blur();
  location.hash = '#/stock/' + enc(sym);
}
function markSug() {
  [...sug.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sugIdx)));
  sug.children[sugIdx]?.scrollIntoView({ block: 'nearest' });
}
q.addEventListener('input', () => {
  clearTimeout(qTimer);
  const v = q.value.trim();
  if (!v) return showSug([], '');
  qTimer = setTimeout(async () => {
    try { const r = await api('/api/search?q=' + enc(v)); if (q.value.trim() === v) showSug(r.results, v); } catch { /* ignore */ }
  }, 160);
});
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sugIdx = Math.min(sugIdx + 1, sugItems.length - 1); markSug(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sugIdx = Math.max(sugIdx - 1, 0); markSug(); }
  else if (e.key === 'Escape') { sug.hidden = true; }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const it = sugItems[sugIdx >= 0 ? sugIdx : 0];
    const raw = q.value.trim().toUpperCase().replace(/\s+/g, '');
    if (it) pick(it.symbol); else if (/^[A-Z0-9&\-]{1,20}$/.test(raw)) pick(raw);
  }
});
sug.addEventListener('mousedown', e => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); pick(sugItems[+li.dataset.i].symbol); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) sug.hidden = true; });

/* ---------- router ---------- */
function route() {
  clearTimers(); S.charts = null;
  const m = location.hash.match(/^#\/stock\/(.+)$/);
  if (m) showStock(decodeURIComponent(m[1]).toUpperCase()); else showHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ======================================================================
   HOME  (Market Mood Index)
   ====================================================================== */
const MMI_COL = s => s < 30 ? '#ff6b73' : s < 50 ? '#ffb04a' : s < 70 ? '#9be36f' : '#2fdc9b';

function polar(cx, cy, r, deg) { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; }
function arc(v0, v1, r) {
  const [x0, y0] = polar(150, 150, r, 180 - v0 * 1.8), [x1, y1] = polar(150, 150, r, 180 - v1 * 1.8);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function gaugeSVG() {
  const segs = [[0, 30, '#e5484d'], [30, 50, '#f59f3a'], [50, 70, '#8bd46e'], [70, 100, '#12a672']];
  return `<svg viewBox="0 0 300 200" role="img" aria-label="Market mood gauge">
    ${segs.map(([a, b, c]) => `<path d="${arc(a + .6, b - .6, 118)}" stroke="${c}" stroke-width="24" fill="none"/>`).join('')}
    <text x="20" y="172" fill="#b9bfe8" font-size="11" text-anchor="start">Extreme fear</text>
    <text x="280" y="172" fill="#b9bfe8" font-size="11" text-anchor="end">Extreme greed</text>
    <g class="needle" id="needle" style="transform:rotate(0deg)">
      <line x1="150" y1="150" x2="48" y2="150" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      <circle cx="150" cy="150" r="10" fill="#fff"/><circle cx="150" cy="150" r="4" fill="#121a4a"/>
    </g>
    <text id="gScore" x="150" y="196" fill="#fff" font-size="40" font-weight="800" text-anchor="middle" style="font-family:var(--display)">–</text>
  </svg>`;
}

async function showHome() {
  S.sym = null;
  $('#app').innerHTML = `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <h1>Market Mood Index</h1>
      <p class="sub">A 0 to 100 score for how fearful or greedy Indian investors are right now.</p>
      <div id="gauge">${gaugeSVG()}</div>
      <div class="zone-line" id="mmiZone">Reading the market…</div>
      <p class="zone-adv" id="mmiAdv"></p>
      <div class="updated" id="mmiUpd"></div>
    </div>
    <div class="parts"><h2>What is moving the score</h2><div id="mmiParts" class="skeleton">Fetching Nifty 50 data. The first load can take about 20 seconds.</div></div>
  </div></section>
  <section class="wrap lift"><div class="grid2">
    <div class="card"><h2>Nifty 50 movers today</h2><div id="movers" class="empty">Loading…</div></div>
    <div class="card"><h2>Your watchlist</h2><div id="watch" class="empty">Loading…</div></div>
  </div></section>
  <section class="wrap section"><div class="card how">
    <h2>How the buy verdict works</h2>
    <p>Open any stock and StockPulse scores about a dozen indicators: moving averages, RSI, MACD, Stochastic, Bollinger Bands, ADX and volume. If most point up, the trend is healthy.</p>
    <p>It then finds a value zone, the area near recent support where risk is lower. It says Buy only when the trend is up and the price is close to that zone. If the price has already run, it tells you to wait for a dip.</p>
  </div></section>`;
  loadMMI(); loadMovers(); loadWatchCard();
  every(300000, loadMMI); every(60000, loadMovers); every(20000, loadWatchCard);
}

async function loadMMI() {
  try {
    const d = await api('/api/mmi');
    const needle = $('#needle'); if (!needle) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${(d.score * 1.8).toFixed(1)}deg)`; }));
    $('#gScore').textContent = Math.round(d.score);
    const z = $('#mmiZone'); z.textContent = d.zone; z.style.color = MMI_COL(d.score);
    $('#mmiAdv').textContent = d.advice;
    $('#mmiUpd').textContent = 'Updated ' + d.updated;
    const p = $('#mmiParts'); p.className = '';
    p.innerHTML = d.components.map(c => `
      <div class="part"><div class="row"><span>${esc(c.name)}</span><span>${Math.round(c.score)}</span></div>
      <div class="track"><i style="background:${MMI_COL(c.score)}" data-w="${c.score.toFixed(0)}"></i></div>
      <small>${esc(c.detail)}</small></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => p.querySelectorAll('i').forEach(i => { i.style.width = i.dataset.w + '%'; })));
  } catch (e) {
    const p = $('#mmiParts'); if (p) { p.className = 'skeleton'; p.textContent = e.message; }
    const z = $('#mmiZone'); if (z && z.textContent.startsWith('Reading')) z.textContent = 'Mood unavailable';
  }
}

function moverList(t, arr) {
  return `<h3>${t}</h3><ul class="list">${arr.map(r => `<li><a href="#/stock/${enc(r.symbol)}">${esc(r.symbol)}</a>
    <span><span class="px">${inr(r.price)}</span><span class="chip ${sgn(r.change_pct)}">${sp(r.change_pct)}</span></span></li>`).join('')}</ul>`;
}
async function loadMovers() {
  const el = $('#movers'); if (!el) return;
  try {
    const d = await api('/api/movers');
    el.className = ''; el.innerHTML = moverList('Top gainers', d.gainers) + '<div style="height:14px"></div>' + moverList('Top losers', d.losers);
  } catch (e) { el.textContent = e.message; }
}
async function loadWatchCard() {
  const el = $('#watch'); if (!el) return;
  if (!S.me) {
    el.innerHTML = `<p class="empty">Log in to save stocks and see their live prices here.</p><p><button class="btn primary" id="wlIn">Log in or sign up</button></p>`;
    $('#wlIn').onclick = () => openAuth('login'); return;
  }
  const syms = [...S.watch];
  if (!syms.length) { el.innerHTML = `<p class="empty">Nothing saved yet. Open a stock and press “Add to watchlist”.</p>`; return; }
  try {
    const d = await api('/api/quotes?symbols=' + enc(syms.join(',')));
    el.className = '';
    el.innerHTML = `<ul class="list">${d.quotes.map(r => `<li><a href="#/stock/${enc(r.symbol)}">${esc(r.symbol)}</a>
      <span><span class="px">${inr(r.price)}</span><span class="chip ${sgn(r.change_pct)}">${sp(r.change_pct)}</span></span></li>`).join('')}</ul>`;
  } catch (e) { el.textContent = e.message; }
}

/* ======================================================================
   STOCK PAGE
   ====================================================================== */
async function showStock(sym) {
  S.sym = sym; S.last = null;
  $('#app').innerHTML = `<div class="wrap state"><h2>Loading ${esc(sym)}…</h2><p>Fetching live price, fundamentals and technicals.</p></div>`;
  try {
    const d = await api('/api/stock/' + enc(sym));
    if (S.sym !== sym) return;
    S.marketOpen = d.market_open;
    $('#app').innerHTML = `<div class="wrap stock">
      <div id="sHead"></div><div id="sVerdict"></div>
      <div class="card chartcard">
        <div class="ctools">
          <div class="seg" id="rangeSeg">${['1D', '5D', '1M', '6M', '1Y', '5Y'].map(r => `<button data-r="${r}" aria-pressed="${r === S.range}">${r}</button>`).join('')}</div>
          <div class="toggles">
            <label><input type="checkbox" data-k="sma20" checked><i style="background:#ff9d1f"></i>SMA 20</label>
            <label><input type="checkbox" data-k="sma50" checked><i style="background:#2b3796"></i>SMA 50</label>
            <label><input type="checkbox" data-k="sma200" checked><i style="background:#8a4bd6"></i>SMA 200</label>
            <label><input type="checkbox" data-k="bb"><i style="background:#9aa3d6"></i>Bollinger</label>
          </div>
        </div>
        <div id="priceChart"></div>
        <div class="rsi-lbl">RSI (14): above 70 is overbought, below 30 is oversold</div>
        <div id="rsiChart"></div>
      </div>
      <div class="two"><div class="card" id="sFund"></div><div class="card" id="sTech"></div></div>
    </div>`;
    renderStock(d);
    initCharts(); loadChart();
    $('#rangeSeg').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      S.range = b.dataset.r;
      $('#rangeSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      loadChart();
    };
    document.querySelectorAll('.toggles input').forEach(cb => cb.onchange = applyToggles);
    every(5000, pollQuote);
    every(45000, async () => {
      try { const n = await api('/api/stock/' + enc(sym)); if (S.sym === sym) renderStock(n); } catch { /* keep old */ }
    });
  } catch (e) {
    $('#app').innerHTML = `<div class="wrap state"><h2>We couldn’t load ${esc(sym)}</h2><p>${esc(e.message)}</p>
      <p>Check the NSE symbol (for example RELIANCE, TCS or M&amp;M) or search by company name.</p></div>`;
  }
}

function renderStock(d) {
  const q_ = d.quote, v = d.verdict, f = d.fundamentals, t = d.tech;
  const wl = S.watch.has(d.symbol);
  $('#sHead').innerHTML = `<div class="head">
    <div>
      <h1>${esc(d.name)}</h1>
      <div class="meta"><span class="chip flat">NSE: ${esc(d.symbol)}</span>
        ${f.sector ? `<span>${esc(f.sector)}${f.industry ? ' · ' + esc(f.industry) : ''}</span>` : ''}
        <span><span class="dot ${d.market_open ? 'live' : ''}"></span> ${d.market_open ? 'Live' : 'Market closed, showing last close'}</span>
        <button class="star" id="wlBtn" aria-pressed="${wl}">${wl ? '★ In watchlist' : '☆ Add to watchlist'}</button></div>
    </div>
    <div class="pricebox">
      <div class="price" id="livePrice">${inr(q_.price)}</div>
      <div class="chg ${sgn(q_.change)}" id="liveChg">${q_.change > 0 ? '+' : ''}${nf(q_.change)} (${sp(q_.change_pct)})</div>
      <div class="meta" style="justify-content:flex-end">
        <span>Day ${inr(q_.day_low)} – ${inr(q_.day_high)}</span><span>52W ${inr(t.low52)} – ${inr(t.high52)}</span></div>
    </div></div>`;
  $('#wlBtn').onclick = toggleWatch;

  const px = q_.price;
  const lo = Math.min(v.stop_loss, px) * 0.995, hi = Math.max(v.target, px) * 1.005;
  const pos = x => ((x - lo) / (hi - lo) * 100);
  $('#sVerdict').innerHTML = `<div class="card verdict">
    <div class="v-left ${v.tone}">
      <div class="lbl">Verdict at ${inr(px)}</div>
      <div class="act">${esc(v.action)}</div>
      <p>${esc(v.headline)}</p>
      <ul>${v.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
    <div class="v-right">
      <h3>Price zone</h3>
      <p class="hint">${v.in_zone ? 'The price is inside or close to the value zone.' : 'The price is above the value zone.'}
        ${v.risk_reward ? ` Risk to reward from here is about 1 : ${nf(v.risk_reward, 1)}.` : ''}</p>
      <div class="zbar" role="img" aria-label="Buy zone, stop-loss, target and current price">
        <div class="band" style="left:${pos(v.zone_low)}%;width:${Math.max(pos(v.zone_high) - pos(v.zone_low), 1)}%"></div>
        <div class="mk stop bot" style="left:${pos(v.stop_loss)}%"><span>Stop ${inr(v.stop_loss, 0)}</span></div>
        <div class="mk now top" style="left:${pos(px)}%"><span>Now ${inr(px, 0)}</span></div>
        <div class="mk tgt bot" style="left:${pos(v.target)}%"><span>Target ${inr(v.target, 0)}</span></div>
      </div>
      <div class="kv3">
        <div><small>Buy zone</small><b>${inr(v.zone_low, 0)} – ${inr(v.zone_high, 0)}</b></div>
        <div><small>Stop-loss</small><b>${inr(v.stop_loss)}</b></div>
        <div><small>Target</small><b>${inr(v.target)}</b></div>
      </div>
    </div></div>`;

  /* fundamentals */
  const F = [
    ['P/E ratio', f.pe, 'x', 'Price you pay for each ₹1 of yearly profit. Compare it with similar companies.'],
    ['Forward P/E', f.forward_pe, 'x', 'P/E using expected profits for the next year.'],
    ['P/B ratio', f.pb, 'x', 'Price compared with the company’s book value per share.'],
    ['EPS (TTM)', f.eps, 'inr', 'Profit per share over the last 12 months.'],
    ['Book value', f.book_value, 'inr', 'Net assets per share.'],
    ['EBITDA', f.ebitda, 'cr', 'Operating profit before interest, tax, depreciation and amortisation.'],
    ['EV / EBITDA', f.ev_ebitda, 'x', 'What the whole business costs compared with its operating profit.'],
    ['Market cap', f.market_cap, 'cr', 'Total value of all shares.'],
    ['Revenue', f.revenue, 'cr', 'Sales over the last 12 months.'],
    ['Net profit', f.net_income, 'cr', 'Profit after all costs over the last 12 months.'],
    ['Free cash flow', f.free_cash_flow, 'cr', 'Cash left after running the business and investing in it.'],
    ['ROE', f.roe, 'pc', 'Return on equity: profit earned on shareholders’ money.'],
    ['ROA', f.roa, 'pc', 'Return on assets.'],
    ['Net margin', f.profit_margin, 'pc', 'Share of sales that becomes profit.'],
    ['Operating margin', f.operating_margin, 'pc', 'Share of sales left after operating costs.'],
    ['Revenue growth', f.revenue_growth, 'pc', 'Latest yearly change in sales.'],
    ['Earnings growth', f.earnings_growth, 'pc', 'Latest yearly change in profit.'],
    ['Debt / Equity', f.debt_to_equity, 'n', 'Borrowings compared with shareholders’ money. Lower is safer.'],
    ['Current ratio', f.current_ratio, 'n', 'Ability to pay short-term bills. Above 1 is comfortable.'],
    ['Dividend yield', f.dividend_yield, 'pc', 'Yearly dividend as a percentage of the price.'],
    ['Beta', f.beta, 'n', 'How much the stock swings compared with the market. 1 means it moves with it.'],
    ['Volume', q_.volume, 'vol', 'Shares traded in the latest session.'],
  ];
  $('#sFund').innerHTML = `<h2>Fundamentals <span class="chip ${d.fundamental_view === 'Strong' ? 'buy' : d.fundamental_view === 'Weak' ? 'sell' : 'neutral'}" style="vertical-align:middle;font-family:var(--body)">${esc(d.fundamental_view)}</span></h2>
    <div class="fgrid">${F.map(([l, val, ty, tip]) => `<div><small title="${esc(tip)}">${l}</small><b>${val == null ? '—' : FMT[ty](val)}</b></div>`).join('')}</div>
    ${d.fundamental_notes.length ? `<ul class="fnotes">${d.fundamental_notes.map(n => `<li class="${n.tone}">${esc(n.text)}</li>`).join('')}</ul>` : ''}`;

  /* technicals */
  const sm = d.summary, tot = sm.buy + sm.sell + sm.neutral || 1;
  const groups = {};
  d.signals.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
  const L = d.levels;
  $('#sTech').innerHTML = `<h2>Technical indicators</h2>
    <div class="sumbar"><i style="width:${sm.sell / tot * 100}%;background:var(--down)"></i><i style="width:${sm.neutral / tot * 100}%;background:#c9cee3"></i><i style="width:${sm.buy / tot * 100}%;background:var(--up)"></i></div>
    <div class="sumtxt"><span class="down">${sm.sell} sell</span><span>${sm.neutral} neutral</span><span class="up">${sm.buy} buy</span></div>
    <table class="tech">${Object.entries(groups).map(([g, rows]) => `<tr><th colspan="3">${esc(g)}</th></tr>` +
      rows.map(s => `<tr><td>${esc(s.name)}<span class="note">${esc(s.note)}</span></td><td>${nf(s.value)}</td>
      <td><span class="chip ${s.signal}">${s.signal === 'buy' ? 'Buy' : s.signal === 'sell' ? 'Sell' : 'Neutral'}</span></td></tr>`).join('')).join('')}</table>
    <h3 style="margin-top:18px">Support and resistance</h3>
    <div class="levels">${[['S2', L.s2], ['S1', L.s1], ['Pivot', L.pivot], ['R1', L.r1], ['R2', L.r2]].map(([k, x]) => `<div><small>${k}</small><b>${inr(x, 1)}</b></div>`).join('')}</div>`;
}

async function toggleWatch() {
  if (!S.me) return openAuth('login');
  const sym = S.sym, on = S.watch.has(sym);
  try {
    await api('/api/watchlist/' + enc(sym), { method: on ? 'DELETE' : 'POST' });
    on ? S.watch.delete(sym) : S.watch.add(sym);
    const b = $('#wlBtn');
    b.setAttribute('aria-pressed', String(!on)); b.textContent = on ? '☆ Add to watchlist' : '★ In watchlist';
  } catch (e) { alert(e.message); }
}

/* ---------- live quote polling ---------- */
async function pollQuote() {
  const sym = S.sym; if (!sym) return;
  try {
    const q_ = await api('/api/quote/' + enc(sym));
    if (S.sym !== sym) return;
    const pEl = $('#livePrice'), cEl = $('#liveChg'); if (!pEl) return;
    const old = parseFloat(pEl.dataset.p || '0'); pEl.dataset.p = q_.price;
    pEl.textContent = inr(q_.price);
    cEl.className = 'chg ' + sgn(q_.change);
    cEl.textContent = `${q_.change > 0 ? '+' : ''}${nf(q_.change)} (${sp(q_.change_pct)})`;
    if (old && old !== q_.price) {
      pEl.classList.remove('flash-up', 'flash-down'); void pEl.offsetWidth;
      pEl.classList.add(q_.price > old ? 'flash-up' : 'flash-down');
    }
    const C = S.charts;
    if (C && S.last && S.marketOpen) {
      S.last = { ...S.last, high: Math.max(S.last.high, q_.price), low: Math.min(S.last.low, q_.price), close: q_.price };
      C.candle.update(S.last);
    }
  } catch { /* transient errors are fine */ }
}

/* ---------- charts ---------- */
function initCharts() {
  const base = {
    autoSize: true,
    layout: { background: { color: '#ffffff' }, textColor: '#666f96', fontFamily: 'Figtree, system-ui, sans-serif' },
    grid: { vertLines: { color: '#eef0f7' }, horzLines: { color: '#eef0f7' } },
    rightPriceScale: { borderColor: '#e0e4f0' },
    timeScale: { borderColor: '#e0e4f0', rightOffset: 4 },
    crosshair: { mode: 0 },
  };
  const chart = LightweightCharts.createChart($('#priceChart'), base);
  const candle = chart.addCandlestickSeries({ upColor: '#0f9d68', downColor: '#dc3348', borderVisible: false, wickUpColor: '#0f9d68', wickDownColor: '#dc3348' });
  const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const ln = (color, w = 2, style = 0) => chart.addLineSeries({ color, lineWidth: w, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const sma20 = ln('#ff9d1f'), sma50 = ln('#2b3796'), sma200 = ln('#8a4bd6'), bbu = ln('#9aa3d6', 1, 2), bbl = ln('#9aa3d6', 1, 2);

  const rsiChart = LightweightCharts.createChart($('#rsiChart'), { ...base, timeScale: { ...base.timeScale, visible: false }, rightPriceScale: { borderColor: '#e0e4f0', scaleMargins: { top: 0.12, bottom: 0.12 } } });
  const rsi = rsiChart.addLineSeries({ color: '#2b3796', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  rsi.createPriceLine({ price: 70, color: '#dc3348', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
  rsi.createPriceLine({ price: 30, color: '#0f9d68', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });

  let syncing = false;
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && !syncing) { syncing = true; rsiChart.timeScale().setVisibleLogicalRange(r); syncing = false; } });
  S.charts = { chart, rsiChart, candle, vol, sma20, sma50, sma200, bbu, bbl, rsi };
  applyToggles();
}

function applyToggles() {
  const C = S.charts; if (!C) return;
  const on = k => document.querySelector(`.toggles input[data-k="${k}"]`)?.checked;
  C.sma20.applyOptions({ visible: on('sma20') }); C.sma50.applyOptions({ visible: on('sma50') });
  C.sma200.applyOptions({ visible: on('sma200') });
  C.bbu.applyOptions({ visible: on('bb') }); C.bbl.applyOptions({ visible: on('bb') });
}

async function loadChart() {
  const sym = S.sym, rng = S.range, C = S.charts; if (!C) return;
  try {
    const d = await api(`/api/chart/${enc(sym)}?range=${rng}`);
    if (S.sym !== sym || S.range !== rng || S.charts !== C) return;
    const ws = a => a.map(p => p.value == null ? { time: p.time } : p);
    C.chart.applyOptions({ timeScale: { timeVisible: d.intraday, secondsVisible: false } });
    C.candle.setData(d.candles);
    C.vol.setData(d.volume.map(v => ({ time: v.time, value: v.value, color: v.up ? 'rgba(15,157,104,.35)' : 'rgba(220,51,72,.35)' })));
    C.sma20.setData(ws(d.sma20)); C.sma50.setData(ws(d.sma50)); C.sma200.setData(ws(d.sma200));
    C.bbu.setData(ws(d.bb_up)); C.bbl.setData(ws(d.bb_lo)); C.rsi.setData(ws(d.rsi));
    S.last = d.candles[d.candles.length - 1];
    C.chart.timeScale().fitContent();
  } catch (e) {
    const el = $('#priceChart'); if (el) el.insertAdjacentHTML('afterbegin', `<p class="empty" style="padding:20px">${esc(e.message)}</p>`);
  }
}

/* ---------- boot ---------- */
$('#tabLogin').onclick = () => openAuth('login');
$('#tabReg').onclick = () => openAuth('register');
$('#authGo').onclick = submitAuth;
$('#authDlg').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submitAuth(); });

(async function boot() {
  try { S.me = (await api('/api/me')).user; } catch { /* logged out */ }
  await loadWatchSet();
  renderAuth();
  loadTape(); tapeTimer = setInterval(() => { if (!document.hidden) loadTape(); }, 15000);
  route();
})();
