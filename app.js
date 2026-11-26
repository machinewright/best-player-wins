import { roundShape, slotsNeeded, circleSchedule, bracketOrder } from './src/sim.js';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};
const pct = x => `${Math.round(100 * x)}%`;

// ---------- inputs (mirrored in the URL hash so a setup can be shared) ----------
const inputs = { n: $('#n'), p: $('#p'), draw: $('#draw'), seeding: $('#seeding'), tables: $('#tables'), mins: $('#mins'), hours: $('#hours') };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k, inp] of Object.entries(inputs)) if (h.has(k)) inp.value = h.get(k);
}
function writeHash(st) {
  const h = new URLSearchParams();
  for (const k of Object.keys(inputs)) if (inputs[k].value !== '') h.set(k, inputs[k].value);
  history.replaceState(null, '', '#' + h.toString());
}
function state() {
  const n = Math.max(3, Math.min(64, Math.round(+inputs.n.value || 16)));
  const p = (+inputs.p.value) / 100;
  const tablesRaw = Math.round(+inputs.tables.value);
  const tables = tablesRaw >= 1 ? tablesRaw : Math.floor(n / 2);
  const mins = Math.max(1, +inputs.mins.value || 20);
  const hours = inputs.hours.value === '' ? null : Math.max(0, +inputs.hours.value);
  return { n, p, draw: +inputs.draw.value, seeding: inputs.seeding.value, tables, mins, hours };
}

function feel(p) {
  if (p < 0.6) return 'barely better than a coin flip: a game with lots of luck, or a very even group';
  if (p < 0.7) return 'a small edge: luck decides many games';
  if (p < 0.8) return 'a clear favourite who still loses often';
  if (p < 0.9) return 'wins most of the time';
  if (p < 0.96) return 'almost always wins';
  return 'nearly never loses to an average player';
}

// ---------- formats on offer ----------
function formatsFor(st) {
  const { n } = st;
  const L = Math.max(1, Math.ceil(Math.log2(n)));
  const fits = k => st.hours === null || timeOf(roundShape('swiss', n, { rounds: k }), st) <= st.hours * 60;
  let more = Math.min(n - 1, L + 2);
  if (st.hours !== null) { // as many Swiss rounds as fit (at least L+1, at most n-1)
    let k = L + 1; while (k + 1 <= n - 1 && fits(k + 1)) k++;
    more = Math.min(n - 1, Math.max(L + 1, k));
  }
  const moreWhat = st.hours !== null && fits(more) ? 'The most Swiss rounds that fit your time.'
    : `The same with ${more - L === 1 ? 'one extra round' : more - L === 2 ? 'two extra rounds' : `${more - L} extra rounds`}.`;
  const list = [
    { key: 'ko', fn: 'knockout', opts: {}, name: 'Knockout', what: 'Lose once and you’re out.' },
    { key: 'de', fn: 'doubleElim', opts: {}, name: 'Double elimination', what: 'Lose twice and you’re out. Players who lose once drop into a second bracket and can still win.' },
    { key: 'sw1', fn: 'swiss', opts: { rounds: L }, name: `Swiss, ${L} round${L > 1 ? 's' : ''}`, what: 'Everyone plays every round, against someone on the same score so far. Nobody is knocked out. This many rounds is the usual rule of thumb.' },
  ];
  if (more > L) list.push({ key: 'sw2', fn: 'swiss', opts: { rounds: more }, name: `Swiss, ${more} rounds`, what: moreWhat });
  if (n >= 6) list.push({ key: 'gr', fn: 'groupsKnockout', opts: { groupSize: 4, adv: 2 }, name: 'Groups, then knockout', what: 'Groups of about four play everyone in their group; the top two of each group go into a knockout.' });
  list.push({ key: 'rr', fn: 'roundRobin', opts: {}, name: 'Round robin', what: 'Everyone plays everyone once. Most points wins.' });
  for (const f of list) {
    f.shape = roundShape(f.fn, n, f.opts);
    f.rounds = f.shape.length;
    f.games = f.shape.reduce((a, b) => a + b, 0);
    f.minutes = timeOf(f.shape, st);
    f.fits = st.hours === null || f.minutes <= st.hours * 60;
  }
  return list;
}
const timeOf = (shape, st) => slotsNeeded(shape, st.tables) * st.mins;
function hm(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

// ---------- results ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let jobId = 0, rows = new Map(), lastState = null, lastFormats = [];

function render(st) {
  lastState = st;
  $('#p-out').textContent = `${Math.round(st.p * 100)}%`;
  $('#p-feel').textContent = feel(st.p);
  $('#tables').placeholder = String(Math.floor(st.n / 2));
  const fmts = formatsFor(st);
  lastFormats = fmts;
  $('#chance').textContent = `Drawing a name from a hat, your best player would win ${pct(1 / st.n)} of the time. A tournament should do much better than that.`;
  const list = $('#results'); list.textContent = '';
  rows = new Map();
  for (const f of fmts) {
    const bar = el('div', { class: 'bar' }, el('i'));
    const big = el('span', { class: 'big', text: '…' }), err = el('span', { class: 'err' });
    const row = el('li', { class: 'row' + (f.fits ? '' : ' nofit') },
      el('div', { class: 'head' }, el('strong', { text: f.name }), el('span', {}, big, err)),
      bar,
      el('p', { class: 'what', text: f.what }),
      el('p', { class: 'facts' }));
    row.querySelector('.facts').textContent = factsLine(f, null, st);
    rows.set(f.key, { row, bar, big, err, f });
    list.append(row);
  }
  $('#takeaway').textContent = 'Playing each format a few thousand times…';
  jobId++;
  const { lo: swissMin, hi: swissMax } = swissRange(st.n);
  worker.postMessage({ id: jobId, n: st.n, p: st.p, draw: st.draw, seeding: st.seeding, runs: 4000,
    formats: fmts.map(({ key, fn, opts }) => ({ key, fn, opts })), swissMin, swissMax });
  swissData = []; drawSwiss();
  renderSchedule();
}

function factsLine(f, r, st) {
  const parts = [];
  if (r) parts.push(`A top-3 player wins ${pct(r.pTop3)}.`);
  if (f.fn === 'knockout') parts.push('Every first-round loser plays only one game.');
  else if (r) parts.push(`Every player gets at least ${r.minGames} game${r.minGames === 1 ? '' : 's'}.`);
  parts.push(`${f.games} games${f.fn === 'doubleElim' ? ' at most' : ''} in ${f.rounds} rounds: about ${hm(f.minutes)} on ${st.tables} table${st.tables === 1 ? '' : 's'}${f.fits ? '' : ', more than the time you have'}.`);
  return parts.join(' ');
}

const results = new Map();
worker.onmessage = e => {
  const m = e.data; if (m.id !== jobId) return;
  if (m.type === 'format') {
    const R = rows.get(m.key); if (!R) return;
    results.set(m.key, m.r);
    R.big.textContent = pct(m.r.pBest);
    R.err.textContent = `±${Math.max(1, Math.round(200 * m.r.seBest))}`;
    R.err.title = 'margin of error (95%) from 4,000 simulated tournaments, in percentage points';
    R.bar.firstChild.style.width = (100 * m.r.pBest) + '%';
    R.bar.setAttribute('role', 'img');
    R.bar.setAttribute('aria-label', `${R.f.name}: the best player wins ${pct(m.r.pBest)}`);
    R.row.querySelector('.facts').textContent = factsLine(R.f, m.r, lastState);
    if ([...rows.keys()].every(k => results.has(k) && rows.get(k))) takeaway();
  } else if (m.type === 'swiss') { swissData = m.swiss; drawSwiss(); }
};

function takeaway() {
  const st = lastState;
  const got = lastFormats.map(f => ({ f, r: results.get(f.key) })).filter(x => x.r);
  if (got.length < lastFormats.length) return;
  const ko = got.find(x => x.f.key === 'ko');
  const ok = got.filter(x => x.f.fits);
  const best = ok.slice().sort((a, b) => b.r.pBest - a.r.pBest)[0];
  if (!ok.length) {
    const quick = got.slice().sort((a, b) => a.f.minutes - b.f.minutes)[0];
    $('#takeaway').textContent = `None of these fits in ${hm(st.hours * 60)} with ${st.tables} table${st.tables === 1 ? '' : 's'}. The quickest format (${quick.f.name.toLowerCase()}) needs about ${hm(quick.f.minutes)}; more tables or shorter games would help.`;
    rows.forEach(R => R.row.classList.remove('pick'));
    return;
  }
  let t = `In a knockout, your best player wins ${pct(ko.r.pBest)} of the time. `;
  if (best.f.key === 'ko') t += st.hours !== null ? 'Within your time, nothing does better.' : '';
  else t += `${st.hours !== null ? 'Of the formats that fit your time, ' : 'Of these, '}${best.f.name.toLowerCase()} does best: ${pct(best.r.pBest)}, with ${best.f.rounds} rounds instead of ${ko.f.rounds}.`;
  $('#takeaway').textContent = t;
  rows.forEach(R => { R.row.classList.toggle('pick', R.f.key === best.f.key); });
}

// ---------- Swiss rounds chart ----------
// From the usual number of rounds up to 8 more (never more than n - 1, when everyone has met everyone).
function swissRange(n) { const L = Math.max(1, Math.ceil(Math.log2(n))); return { lo: Math.min(L, n - 1), hi: Math.min(n - 1, L + 8) }; }
let swissData = [];
function drawSwiss() {
  const svg = $('#swiss-chart'), tbody = $('#swiss-table tbody');
  const st = lastState; if (!st) return;
  const { lo: minK, hi: maxK } = swissRange(st.n);
  const W = Math.round(Math.max(320, Math.min(640, svg.clientWidth || 640))), H = W < 480 ? 230 : 260, m = { l: 40, r: 12, t: 14, b: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x = k => m.l + (k - minK) / Math.max(1, maxK - minK) * (W - m.l - m.r);
  const y = v => m.t + (1 - v) * (H - m.t - m.b);
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  svg.textContent = '';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(mk('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
    const t = mk('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); t.textContent = pct(v); svg.append(t);
  }
  for (let k = minK; k <= maxK; k++) {
    const t = mk('text', { x: x(k), y: H - m.b + 18, 'text-anchor': 'middle', class: 'tick' }); t.textContent = k; svg.append(t);
  }
  const xl = mk('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end', class: 'axis' }); xl.textContent = 'number of Swiss rounds'; svg.append(xl);
  const ml = mk('text', { x: x(minK), y: H - 2, 'text-anchor': 'start', class: 'tick' }); ml.textContent = '↑ the usual number'; svg.append(ml);
  const rr = results.get('rr');
  if (rr) {
    svg.append(mk('line', { x1: m.l, x2: W - m.r, y1: y(rr.pBest), y2: y(rr.pBest), class: 'ref' }));
    const t = mk('text', { x: W - m.r, y: y(rr.pBest) - 6, 'text-anchor': 'end', class: 'tick' }); t.textContent = `round robin (${st.n % 2 ? st.n : st.n - 1} rounds): ${pct(rr.pBest)}`; svg.append(t);
  }
  if (swissData.length) {
    svg.append(mk('path', { d: swissData.map((d, i) => `${i ? 'L' : 'M'}${x(d.k)},${y(d.p)}`).join(''), class: 'line' }));
    for (const d of swissData) {
      const g = mk('g', { class: 'pt', tabindex: 0 });
      g.append(mk('circle', { cx: x(d.k), cy: y(d.p), r: 4.5 }));
      g.append(mk('circle', { cx: x(d.k), cy: y(d.p), r: 14, class: 'hit' }));
      const tip = mk('title', {}); tip.textContent = `${d.k} round${d.k > 1 ? 's' : ''}: the best player wins ${pct(d.p)}`; g.append(tip);
      svg.append(g);
    }
  }
  tbody.textContent = '';
  for (const d of swissData) tbody.append(el('tr', {}, el('td', { text: d.k }), el('td', { text: pct(d.p) })));
  const total = maxK - minK + 1;
  $('#swiss-status').textContent = swissData.length < total ? `Computing… ${swissData.length} of ${total}` : '';
}

// ---------- schedule ----------
function names(n) {
  const given = $('#names').value.split('\n').map(s => s.trim()).filter(Boolean);
  return Array.from({ length: n }, (_, i) => given[i] || `Player ${i + 1}`);
}
function renderSchedule() {
  const st = lastState; if (!st) return;
  const kind = $('#sched-kind').value, out = $('#schedule'); out.textContent = '';
  const nm = names(st.n);
  if (kind === 'rr') {
    const sched = circleSchedule(st.n);
    sched.forEach((round, r) => {
      const playing = new Set(round.flat());
      const sitting = nm.filter((_, i) => !playing.has(i));
      const waves = Math.ceil(round.length / st.tables);
      const sec = el('section', { class: 'round' }, el('h4', { text: `Round ${r + 1}` }));
      const ol = el('ol');
      round.forEach(([a, b], k) => {
        const wave = Math.floor(k / st.tables), table = (k % st.tables) + 1;
        ol.append(el('li', { text: `${waves > 1 ? `Wave ${wave + 1}, ` : ''}table ${table}: ${nm[a]} – ${nm[b]}` }));
      });
      sec.append(ol);
      if (sitting.length) sec.append(el('p', { class: 'note', text: `Sits out: ${sitting.join(', ')}` }));
      out.append(sec);
    });
  } else {
    let m = 1; while (m < st.n) m *= 2;
    const order = bracketOrder(m);
    const sec = el('section', { class: 'round' }, el('h4', { text: 'First round (list your players strongest first; the top seeds get the byes)' }));
    const ol = el('ol');
    for (let k = 0; k < m; k += 2) {
      const a = order[k], b = order[k + 1];
      const A = a <= st.n ? `${nm[a - 1]} (${a})` : null, B = b <= st.n ? `${nm[b - 1]} (${b})` : null;
      ol.append(el('li', { text: A && B ? `${A} – ${B}` : `${A || B}: bye` }));
    }
    sec.append(ol);
    sec.append(el('p', { class: 'note', text: 'Winners of neighbouring matches meet in the next round: 1st vs 2nd match, 3rd vs 4th, and so on.' }));
    out.append(sec);
  }
}

// ---------- wiring ----------
let timer = 0;
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => { results.clear(); const st = state(); writeHash(st); render(st); }, 200);
}
for (const inp of Object.values(inputs)) inp.addEventListener('input', changed);
$('#names').addEventListener('input', renderSchedule);
$('#sched-kind').addEventListener('change', renderSchedule);
$('#print').addEventListener('click', () => window.print());
readHash();
render(state());
let lastW = 0;
addEventListener('resize', () => { const w = $('#swiss-chart').clientWidth; if (Math.abs(w - lastW) > 40) { lastW = w; drawSwiss(); } });
