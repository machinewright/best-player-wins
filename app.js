import { roundShape, slotsNeeded, circleSchedule, bracketOrder, deBracket, snakeGroups, crossDraw } from './src/sim.js';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};
const pct = x => `${Math.round(100 * x)}%`;

// ---------- inputs (mirrored in the URL hash so a setup can be shared) ----------
const inputs = { n: $('#n'), p: $('#p'), draw: $('#draw'), seeding: $('#seeding'), tables: $('#tables'), mins: $('#mins'), bestof: $('#bestof'), hours: $('#hours') };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k, inp] of Object.entries(inputs)) {
    if (!h.has(k)) continue;
    const v = h.get(k);
    if (inp.tagName === 'SELECT') { if ([...inp.options].some(o => o.value === v)) inp.value = v; continue; }
    const x = Number(v);
    if (v !== '' && Number.isFinite(x)) inp.value = String(Math.min(+inp.max || Infinity, Math.max(+inp.min || 0, x)));
  }
}
function writeHash(st) {
  const h = new URLSearchParams();
  for (const k of Object.keys(inputs)) if (inputs[k].value !== '') h.set(k, inputs[k].value);
  history.replaceState(null, '', '#' + h.toString());
}
// Pasted ratings: one player per line, an optional name and an Elo-style rating. Returns strongest first, or null.
function parseRatings() {
  const rows = [];
  for (const line of $('#ratings').value.split('\n')) {
    const m = /^\s*(.*?)[\s,;:\t]*(\d{1,4}(?:\.\d+)?)\s*$/.exec(line);
    if (m) rows.push({ name: m[1].trim(), r: +m[2] });
  }
  if (rows.length < 3) return { rows: null, count: rows.length };
  return { rows: rows.slice(0, 64).sort((a, b) => b.r - a.r), count: rows.length };
}
function state() {
  const pr = parseRatings();
  const ratings = pr.rows;
  $('#ratings-status').textContent = !$('#ratings').value.trim() ? ''
    : ratings ? `Using ${ratings.length} ratings, from ${ratings[0].r} to ${ratings[ratings.length - 1].r}${pr.count > 64 ? ' (only the first 64 lines)' : ''}. The player count and the slider above now follow your list; clear this box to go back.`
    : 'Paste at least three ratings, one per line.';
  inputs.n.disabled = inputs.p.disabled = !!ratings;
  if (ratings) {
    inputs.n.value = ratings.length;
    const mid = (ratings.length - 1) / 2, rm = (ratings[Math.floor(mid)].r + ratings[Math.ceil(mid)].r) / 2;
    inputs.p.value = Math.round(100 / (1 + 10 ** (-(ratings[0].r - rm) / 400)));
  }
  const n = ratings ? ratings.length : Math.max(3, Math.min(64, Math.round(+inputs.n.value || 16)));
  const p = ratings ? 1 / (1 + 10 ** (-(ratings[0].r - (ratings[Math.floor((n - 1) / 2)].r + ratings[Math.ceil((n - 1) / 2)].r) / 2) / 400)) : (+inputs.p.value) / 100;
  const tablesRaw = Math.round(+inputs.tables.value);
  const tables = tablesRaw >= 1 ? tablesRaw : Math.floor(n / 2);
  const mins = Math.max(1, +inputs.mins.value || 20);
  const hours = inputs.hours.value === '' ? null : Math.max(0, +inputs.hours.value);
  const bestOf = [1, 3, 5].includes(+inputs.bestof.value) ? +inputs.bestof.value : 1;
  return { n, p, draw: +inputs.draw.value, seeding: inputs.seeding.value, tables, mins, hours, ratings, bestOf };
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
function formatsFor(st, k = st.bestOf) {
  const { n } = st;
  const L = Math.max(1, Math.ceil(Math.log2(n)));
  const cap = swissRange(n).hi;
  const fits = r => st.hours === null || timeOf(roundShape('swiss', n, { rounds: r }), st, k) <= st.hours * 60;
  let more = Math.min(cap, L + 2);
  if (st.hours !== null) { // as many Swiss rounds as fit (at least L+1, at most the cap)
    let r = L + 1; while (r + 1 <= cap && fits(r + 1)) r++;
    more = Math.min(cap, Math.max(L + 1, r));
  }
  const moreWhat = st.hours !== null && fits(more) ? 'The most Swiss rounds that fit your time.'
    : `The same with ${more - L === 1 ? 'one extra round' : more - L === 2 ? 'two extra rounds' : `${more - L} extra rounds`}.`;
  const list = [
    { key: 'ko', fn: 'knockout', opts: {}, name: 'Knockout', say: 'a knockout', what: 'Lose once and you’re out.' },
    { key: 'de', fn: 'doubleElim', opts: {}, name: 'Double elimination', say: 'double elimination', what: 'Lose twice and you’re out. Players who lose once drop into a second bracket and can still win.' },
    { key: 'sw1', fn: 'swiss', opts: { rounds: L }, name: `Swiss, ${L} round${L > 1 ? 's' : ''}`, say: `a ${L}-round Swiss`, what: 'Everyone plays every round, against someone on the same score so far. Nobody is knocked out. This many rounds is the usual rule of thumb.' },
  ];
  if (more > L) list.push({ key: 'sw2', fn: 'swiss', opts: { rounds: more }, name: `Swiss, ${more} rounds`, say: `a ${more}-round Swiss`, what: moreWhat });
  if (n >= 6) list.push({ key: 'gr', fn: 'groupsKnockout', opts: { groupSize: 4, adv: 2 }, name: 'Groups, then knockout', say: 'groups then a knockout', what: 'Groups of three to five play everyone in their group; the top two of each group go into a knockout.' });
  list.push({ key: 'rr', fn: 'roundRobin', opts: {}, name: 'Round robin', say: 'a round robin', what: 'Everyone plays everyone once. Most points wins.' });
  for (const f of list) {
    f.shape = roundShape(f.fn, n, f.opts);
    f.rounds = f.shape.length;
    f.games = f.shape.reduce((a, b) => a + b, 0);
    f.bestOf = k;
    f.minutes = timeOf(f.shape, st, k);
    f.fits = st.hours === null || f.minutes <= st.hours * 60;
  }
  return list;
}
const timeOf = (shape, st, k = st.bestOf) => slotsNeeded(shape, st.tables) * st.mins * k;
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
  worker.postMessage({ id: jobId, n: st.n, p: st.p, draw: st.draw, seeding: st.seeding, bestOf: st.bestOf, runs: 4000, ratings: st.ratings ? st.ratings.map(x => x.r) : null,
    formats: fmts.map(({ key, fn, opts }) => ({ key, fn, opts })), swissMin, swissMax });
  swissData = []; drawSwiss();
  renderSchedule();
}

function factsLine(f, r, st) {
  const parts = [];
  if (r) parts.push(`A top-3 player wins ${pct(r.pTop3)}.`);
  const unit = f.bestOf > 1 ? 'match' : 'game';
  if (f.fn === 'knockout') parts.push(`Every first-round loser plays only one ${unit}.`);
  else if (r) parts.push(`Every player gets at least ${r.minGames} ${unit}${r.minGames === 1 ? '' : (unit === 'match' ? 'es' : 's')}.`);
  parts.push(`${f.games} ${unit}${unit === 'match' ? 'es' : 's'}${f.fn === 'doubleElim' ? ' at most' : ''} in ${f.rounds} rounds: about ${hm(f.minutes)} on ${st.tables} table${st.tables === 1 ? '' : 's'}${f.fits ? '' : ', more than the time you have'}.`);
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
    $('#takeaway').textContent = `None of these fits in ${hm(st.hours * 60)} with ${st.tables} table${st.tables === 1 ? '' : 's'}. The quickest, ${quick.f.say}, needs about ${hm(quick.f.minutes)}; more tables or shorter games would help.`;
    rows.forEach(R => R.row.classList.remove('pick'));
    return;
  }
  const ranked = ok.slice().sort((a, b) => b.r.pBest - a.r.pBest);
  const top = ranked[0];
  // formats whose difference from the top one is within the margin of error count as equally good
  const near = ranked.filter(x => top.r.pBest - x.r.pBest <= 2 * Math.hypot(top.r.seBest, x.r.seBest));
  const pick = near.slice().sort((a, b) => a.f.minutes - b.f.minutes)[0];
  const scope = st.hours !== null ? 'Of the formats that fit your time, ' : 'Of these, ';
  let t = `In a knockout, your best player wins ${pct(ko.r.pBest)} of the time. `;
  if (near.length === 1) {
    t += top.f.key === 'ko' ? (st.hours !== null ? 'Within your time, nothing does better.' : '')
      : `${scope}${top.f.say} does best: ${pct(top.r.pBest)}, with ${top.f.rounds} rounds instead of ${ko.f.rounds}.`;
  } else {
    const names = near.map(x => `${x.f.say} (${pct(x.r.pBest)})`);
    const list = names.length === 2 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    t += `${scope}${list} are about equally good: the differences are within the margin of error. The quickest of them is ${pick.f.say}, about ${hm(pick.f.minutes)}.`;
  }
  $('#takeaway').textContent = t;
  rows.forEach(R => { R.row.classList.toggle('pick', R.f.key === pick.f.key); });
  suggestSchedule(pick.f);
}


// ---------- Swiss rounds chart ----------
// From the usual number of rounds up to 6 more.
// Capped at 60% of the field: beyond that, Swiss pairing often can't avoid rematches (measured in proto/swisscap.mjs).
function swissRange(n) {
  const L = Math.max(1, Math.ceil(Math.log2(n))), lo = Math.min(L, n - 1);
  return { lo, hi: Math.max(lo, Math.min(n - 1, L + 6, Math.floor(0.6 * n))) };
}
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
  let given = $('#names').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!given.length && lastState && lastState.ratings) given = lastState.ratings.map((x, i) => x.name || `Player ${i + 1}`);
  return Array.from({ length: n }, (_, i) => given[i] || `Player ${i + 1}`);
}
let schedTouched = false;
function suggestSchedule(f) {
  if (schedTouched) return;
  const map = { roundRobin: 'rr', knockout: 'ko', swiss: 'sw', doubleElim: 'de', groupsKnockout: 'gr' };
  $('#sched-kind').value = map[f.fn] || 'rr';
  renderSchedule();
}
function renderSchedule() {
  const st = lastState; if (!st) return;
  const kind = $('#sched-kind').value, out = $('#schedule'); out.textContent = '';
  const nm = names(st.n);
  const f = lastFormats.find(x => ({ rr: 'roundRobin', ko: 'knockout', sw: 'swiss', de: 'doubleElim', gr: 'groupsKnockout' })[kind] === x.fn);
  const title = { rr: 'Round robin', ko: 'Knockout', sw: 'Swiss', de: 'Double elimination', gr: 'Groups, then knockout' }[kind];
  out.append(el('h3', { class: 'sched-title', text: `${title} · ${st.n} players · ${st.tables} table${st.tables === 1 ? '' : 's'}${st.bestOf > 1 ? ` · best of ${st.bestOf}` : ''}` }));
  if (f && !f.fits) out.append(el('p', { class: 'warn', text: `This takes about ${hm(f.minutes)}, more than the ${hm(st.hours * 60)} you have.` }));
  const waveNote = 'With more games than tables, a round is played in waves: wave 2 starts when wave 1 is done.';
  const sec = (h) => { const x = el('section', { class: 'round' }, el('h4', { text: h })); out.append(x); return x; };
  const list = (parent, items) => { const ol = el('ol'); for (const t of items) ol.append(el('li', { text: t })); parent.append(ol); };
  const tableLabel = (k, total) => { const waves = Math.ceil(total / st.tables); return `${waves > 1 ? `wave ${Math.floor(k / st.tables) + 1}, ` : ''}table ${(k % st.tables) + 1}`; };
  // A knockout bracket for the given entrants in seed order (null = bye), as sections of numbered matches.
  function koSections(entrants, firstMatch) {
    let m = 1; while (m < entrants.length) m *= 2;
    let slots = bracketOrder(m).map(k => (k <= entrants.length ? entrants[k - 1] : null));
    let match = firstMatch, r = 0;
    const roundName = left => (left === 2 ? 'Final' : left === 4 ? 'Semi-finals' : left === 8 ? 'Quarter-finals' : `Round ${r + 1}`);
    while (slots.length > 1) {
      const next = [], items = [];
      for (let k = 0; k < slots.length; k += 2) {
        const a = slots[k], b = slots[k + 1];
        if (!a || !b) { next.push(a || b); continue; }
        match++; items.push(`Match ${match}: ${a} – ${b}`); next.push(`winner of match ${match}`);
      }
      list(sec(roundName(slots.length)), items);
      slots = next; r++;
    }
  }
  if (kind === 'rr') {
    const sched = circleSchedule(st.n);
    if (sched[0].length > st.tables) out.append(el('p', { class: 'note', text: waveNote }));
    sched.forEach((round, r) => {
      const x = sec(`Round ${r + 1}`);
      list(x, round.map(([a, b], k) => `${tableLabel(k, round.length)}: ${nm[a]} – ${nm[b]}`));
      const playing = new Set(round.flat());
      const sitting = nm.filter((_, i) => !playing.has(i));
      if (sitting.length) x.append(el('p', { class: 'note', text: `Sits out: ${sitting.join(', ')}` }));
    });
  } else if (kind === 'ko') {
    out.append(el('p', { class: 'note', text: 'Players are seeded strongest first (by your ratings, or else in the order of your list); the number after a name is the seed. Top seeds get the byes.' }));
    koSections(nm.map((x, i) => `${x} (${i + 1})`), 0);
  } else if (kind === 'sw') {
    const order = nm.map((x, i) => `${x} (${i + 1})`);
    const half = Math.floor(st.n / 2);
    const x = sec('Round 1');
    const items = [];
    for (let k = 0; k < half; k++) items.push(`${tableLabel(k, half)}: ${order[k]} – ${order[k + half]}`);
    list(x, items);
    if (st.n % 2) x.append(el('p', { class: 'note', text: `Bye (counts as a win): ${order[st.n - 1]}` }));
    out.append(el('p', { class: 'note', text: `List your players strongest first, or in random order if you don't know. Later rounds depend on the results, so they can't be printed in advance. After each round: sort players by points (equal points: the order of your list). Pair the top half of each score group against its bottom half, first with first; if two players have met before, swap with the next player. An odd player out moves down to the next score group. With an odd number of players, the lowest-ranked player who hasn't had a bye gets one. Play ${f ? f.rounds : Math.ceil(Math.log2(st.n))} rounds; most points wins, ties broken by the sum of your opponents' points.` }));
  } else if (kind === 'de') {
    out.append(el('p', { class: 'note', text: 'Players are seeded strongest first (by your ratings, or else in the order of your list); the number after a name is the seed. Lose twice and you’re out: the loser of each winners’-bracket match moves to the losers’ bracket. Any match can start as soon as both its players are known, so the two brackets run side by side.' }));
    const ms = deBracket(nm.map((x, i) => `${x} (${i + 1})`));
    const groups = new Map();
    for (const mt of ms) {
      const h = mt.bracket === 'W' ? `Winners’ bracket, round ${mt.round}` : mt.bracket === 'L' ? `Losers’ bracket, round ${mt.round}` : 'Grand final';
      (groups.get(h) || groups.set(h, []).get(h)).push(`Match ${mt.id}: ${mt.a} – ${mt.b}`);
    }
    for (const [h, items] of groups) {
      const x = sec(h); list(x, items);
      if (h === 'Grand final') x.append(el('p', { class: 'note', text: 'If the player from the losers’ bracket wins, play one more game: now both have lost once.' }));
    }
  } else if (kind === 'gr') {
    const G = Math.max(1, Math.round(st.n / 4)), letters = 'ABCDEFGHIJKLMNOP';
    const groups = snakeGroups(nm.map((x, i) => `${x} (${i + 1})`), G);
    out.append(el('p', { class: 'note', text: 'Players are spread over the groups by strength (by your ratings, or else in the order of your list): the strongest one in each group, then the next, so every group is about equally hard. Each group plays a round robin; the top two go through.' }));
    // group rounds, with tables numbered across all groups
    const per = groups.map(g => circleSchedule(g.length));
    const R = Math.max(...per.map(x => x.length));
    for (let r = 0; r < R; r++) {
      const games = [];
      per.forEach((sch, gi) => (sch[r] || []).forEach(([a, b]) => games.push(`Group ${letters[gi]}: ${groups[gi][a]} – ${groups[gi][b]}`)));
      const x = sec(`Group round ${r + 1}`);
      list(x, games.map((t, k) => `${tableLabel(k, games.length)}: ${t}`));
      const sitting = [];
      per.forEach((sch, gi) => { if (!sch[r]) return; const on = new Set(sch[r].flat()); groups[gi].forEach((p, i) => { if (!on.has(i)) sitting.push(`${p} in group ${letters[gi]}`); }); });
      if (sitting.length) x.append(el('p', { class: 'note', text: `Sits out: ${sitting.join(', ')}` }));
    }
    const qual = [letters.slice(0, G).split('').map(c => `winner of group ${c}`), letters.slice(0, G).split('').map(c => `runner-up of group ${c}`)];
    const ko = crossDraw(qual, x => x.slice(-1));
    koSections(ko, 0);
  } else {
    out.append(el('p', { class: 'note', text: 'This page doesn’t print group schedules yet. Run each group as a small round robin (choose "Round robin" with the group’s size), then a knockout for the top two of each group.' }));
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
$('#ratings').addEventListener('input', changed);
$('#sched-kind').addEventListener('change', () => { schedTouched = true; renderSchedule(); });
$('#print').addEventListener('click', () => window.print());
readHash();
render(state());
let lastW = 0;
addEventListener('resize', () => { const w = $('#swiss-chart').clientWidth; if (Math.abs(w - lastW) > 40) { lastW = w; drawSwiss(); } });
