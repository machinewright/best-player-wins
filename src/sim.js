// Tournament format simulator. Players 0..n-1, player 0 is the strongest (strengths sorted descending).
// Match model: Bradley-Terry / Elo on a logit scale, P(i beats j) = 1 / (1 + exp(-(s_i - s_j))),
// with optional draws (Davidson): P(draw) = nu*sqrt(pi*pj) / (pi + pj + nu*sqrt(pi*pj)), pi = exp(s_i).

// ---------- random numbers (seedable, so tests are reproducible) ----------
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { // mulberry32
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the field ----------
// Inverse normal CDF (Acklam), good to ~1e-9.
export function probit(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

// A "typical" group of n players: strengths at the normal quantiles (i+0.5)/n, scaled by sigma, strongest first.
export function quantileField(n, sigma) {
  const s = [];
  for (let i = 0; i < n; i++) s.push(sigma * probit(1 - (i + 0.5) / n));
  return s;
}

export const logistic = x => 1 / (1 + Math.exp(-x));

// Win probability of the best player against the middle player of a quantile field, ignoring draws.
export function bestVsMiddle(n, sigma) {
  const s = quantileField(n, sigma);
  const mid = (n - 1) / 2;
  const sm = Number.isInteger(mid) ? s[mid] : (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
  return logistic(s[0] - sm);
}

// Find sigma so that the best player beats the middle player with probability p (bisection; monotone in sigma).
export function sigmaFor(n, p) {
  let lo = 0, hi = 50;
  for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (bestVsMiddle(n, m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------- one game ----------
// Returns 1 if i wins, 0 if j wins, 0.5 for a draw. drawNu = 0 means no draws.
export function makeGame(s, drawNu, rand) {
  return (i, j) => {
    const pi = Math.exp(s[i]), pj = Math.exp(s[j]);
    const dr = drawNu * Math.sqrt(pi * pj);
    const u = rand() * (pi + pj + dr);
    return u < pi ? 1 : u < pi + pj ? 0 : 0.5;
  };
}
// Draw rate d between equal players -> Davidson nu.
export const nuForDrawRate = d => (d <= 0 ? 0 : 2 * d / (1 - d));

// A game that must have a winner (knockout, playoff): replay draws.
function decisive(game, i, j) {
  for (;;) { const r = game(i, j); if (r !== 0.5) return r === 1 ? i : j; }
}

// ---------- seeding helpers ----------
// Standard bracket order for size m (power of 2): seed positions 1..m, e.g. m=8 -> [1,8,4,5,2,7,3,6].
export function bracketOrder(m) {
  let order = [1];
  while (order.length < m) {
    const k = order.length * 2;
    order = order.flatMap(x => [x, k + 1 - x]);
  }
  return order;
}

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// seeds: players in seed order (seed 1 first). `seeded`: false = random draw; true = the organizer knows the exact
// order; a number tau = the organizer ranks by strength + Normal(0, tau) noise (needs the field `s`, passed via
// opts.field by evaluate()).
function seedList(n, seeded, rand, field) {
  const ids = [...Array(n).keys()];
  if (!seeded) return shuffled(ids, rand);
  if (seeded === true || !field) return ids;
  const key = ids.map(i => field[i] + seeded * gauss(rand));
  return ids.sort((a, b) => key[b] - key[a]);
}
function gauss(rand) { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }

// ---------- formats ----------
// Every format returns { winner, games: per-player game counts, rounds }.

// Single elimination. Byes go to the top seeds.
export function knockout(n, game, rand, { seeded = true, field } = {}) {
  const seeds = seedList(n, seeded, rand, field);
  let m = 1; while (m < n) m *= 2;
  let slots = bracketOrder(m).map(k => (k <= n ? seeds[k - 1] : -1));
  const games = new Array(n).fill(0);
  let rounds = 0;
  while (slots.length > 1) {
    const next = [];
    let played = false;
    for (let k = 0; k < slots.length; k += 2) {
      const a = slots[k], b = slots[k + 1];
      if (a < 0) next.push(b); else if (b < 0) next.push(a);
      else { games[a]++; games[b]++; played = true; next.push(decisive(game, a, b)); }
    }
    if (played) rounds++;
    slots = next;
  }
  return { winner: slots[0], games, rounds };
}

// Round-robin schedule by the circle method: returns rounds, each a list of [i, j] pairs (byes omitted).
export function circleSchedule(n) {
  const ids = [...Array(n).keys()];
  if (n % 2) ids.push(-1);
  const m = ids.length, rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let k = 0; k < m / 2; k++) {
      const a = ids[k], b = ids[m - 1 - k];
      if (a >= 0 && b >= 0) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()); // rotate all but the first
  }
  return rounds;
}

// Pick the winner among players with the top score: tie-break function, then a playoff knockout among those still tied.
function resolveTop(score, cands, tb, game, rand) {
  let best = Math.max(...cands.map(p => score[p]));
  let tied = cands.filter(p => score[p] === best);
  if (tb && tied.length > 1) {
    const t = Math.max(...tied.map(p => tb[p]));
    tied = tied.filter(p => tb[p] === t);
  }
  if (tied.length === 1) return { winner: tied[0], playoff: 0 };
  // playoff: random-order knockout among the tied players
  let pool = shuffled(tied, rand), playoff = 0;
  while (pool.length > 1) {
    const next = [];
    for (let k = 0; k + 1 < pool.length; k += 2) { next.push(decisive(game, pool[k], pool[k + 1])); playoff++; }
    if (pool.length % 2) next.push(pool[pool.length - 1]);
    pool = next;
  }
  return { winner: pool[0], playoff };
}

// Sonneborn-Berger tie-break for a round robin: sum of beaten opponents' scores + half of drawn opponents' scores.
export function roundRobin(n, game, rand, { cycles = 1 } = {}) {
  const sched = circleSchedule(n);
  const score = new Array(n).fill(0), games = new Array(n).fill(0);
  const res = [];
  for (let c = 0; c < cycles; c++) for (const round of sched) for (const [a, b] of round) {
    const r = game(a, b);
    score[a] += r; score[b] += 1 - r; games[a]++; games[b]++;
    res.push([a, b, r]);
  }
  const sb = new Array(n).fill(0);
  for (const [a, b, r] of res) { sb[a] += r * score[b]; sb[b] += (1 - r) * score[a]; }
  const { winner } = resolveTop(score, [...Array(n).keys()], sb, game, rand);
  return { winner, games, rounds: sched.length * cycles, score };
}

// Swiss system, k rounds. Pairing: players sorted by (score desc, seed asc); within that order, the top half of each
// score group meets the bottom half (Dutch style), avoiding rematches by backtracking; the lowest-ranked player
// without a bye so far gets the bye (1 point) when n is odd. Tie-break: Buchholz (sum of opponents' scores),
// then a playoff.
export function swiss(n, game, rand, { rounds = 5, seeded = true, field } = {}) {
  const seeds = seedList(n, seeded, rand, field);
  const rank = new Array(n); seeds.forEach((p, k) => { rank[p] = k; });
  const score = new Array(n).fill(0), games = new Array(n).fill(0);
  const met = Array.from({ length: n }, () => new Set());
  const hadBye = new Array(n).fill(false);
  const opps = Array.from({ length: n }, () => []);
  for (let r = 0; r < rounds; r++) {
    let order = [...Array(n).keys()].sort((a, b) => score[b] - score[a] || rank[a] - rank[b]);
    if (n % 2) {
      let k = n - 1; while (k > 0 && hadBye[order[k]]) k--;
      const bye = order[k]; hadBye[bye] = true; score[bye] += 1;
      order = order.filter(p => p !== bye);
    }
    const pairs = pairSwiss(order, score, met);
    for (const [a, b] of pairs) {
      const res = game(a, b);
      score[a] += res; score[b] += 1 - res; games[a]++; games[b]++;
      met[a].add(b); met[b].add(a); opps[a].push(b); opps[b].push(a);
    }
  }
  const buch = opps.map(os => os.reduce((t, o) => t + score[o], 0));
  const { winner } = resolveTop(score, [...Array(n).keys()], buch, game, rand);
  return { winner, games, rounds, score };
}

// Pair an ordered list (even length). Preferred partner of a player = the one half a score group below; fall back to
// the nearest unpaired player without a rematch. Backtracks; if no rematch-free pairing exists, allows rematches.
function pairSwiss(order, score, met) {
  const groups = new Map();
  for (const p of order) { const g = groups.get(score[p]) || []; g.push(p); groups.set(score[p], g); }
  // candidate preference list per player: Dutch partner first, then by distance in the order
  const pref = new Map();
  for (const [, g] of groups) {
    const h = Math.floor(g.length / 2);
    g.forEach((p, k) => { if (k < h) pref.set(p, g[k + h]); });
  }
  let budget = 20000; // backtracking steps; if a rematch-free pairing isn't found within it, rematches are allowed
  function solve(left, allowRematch) {
    if (left.length === 0) return [];
    if (!allowRematch && --budget < 0) return null;
    const a = left[0];
    const rest = left.slice(1);
    const want = pref.get(a);
    // `a` is the highest-ranked unpaired player, so "nearest below" is simply list order
    const cands = want !== undefined && rest.includes(want) ? [want, ...rest.filter(x => x !== want)] : rest;
    for (const b of cands) {
      if (!allowRematch && met[a].has(b)) continue;
      const sub = solve(rest.filter(x => x !== b), allowRematch);
      if (sub) return [[a, b], ...sub];
    }
    return null;
  }
  return solve(order, false) || solve(order, true);
}

// Groups of size g (snake seeding), round robin in each group, top `adv` of each group go to a seeded knockout.
export function groupsKnockout(n, game, rand, { groupSize = 4, adv = 2, seeded = true, field } = {}) {
  const seeds = seedList(n, seeded, rand, field);
  const G = Math.max(1, Math.round(n / groupSize));
  const groups = Array.from({ length: G }, () => []);
  seeds.forEach((p, k) => { const row = Math.floor(k / G), col = k % G; groups[row % 2 ? G - 1 - col : col].push(p); });
  const games = new Array(n).fill(0);
  const qualifiers = []; // [rankInGroup][group]
  let groupRounds = 0;
  for (const g of groups) {
    const sub = roundRobin(g.length, (i, j) => game(g[i], g[j]), rand);
    groupRounds = Math.max(groupRounds, sub.rounds);
    sub.games.forEach((c, i) => { games[g[i]] += c; });
    // order group by score, ties by sub-playoffs via repeated resolveTop
    let left = [...Array(g.length).keys()];
    const ranked = [];
    while (ranked.length < Math.min(adv, g.length)) {
      const { winner } = resolveTop(sub.score, left, null, (i, j) => game(g[i], g[j]), rand);
      ranked.push(g[winner]); left = left.filter(x => x !== winner);
    }
    ranked.forEach((p, k) => { (qualifiers[k] ||= []).push(p); });
  }
  // knockout seeding: group winners first, then runners-up (a simplification of crossing rules)
  const ko = qualifiers.flat();
  const sub = knockout(ko.length, (i, j) => game(ko[i], ko[j]), rand, { seeded: true });
  sub.games.forEach((c, i) => { games[ko[i]] += c; });
  return { winner: ko[sub.winner], games, rounds: groupRounds + sub.rounds };
}

// Double elimination: winners bracket (standard seeding, byes to top seeds); losers from winners round r drop into
// the losers bracket, which alternates "major" rounds (survivors play each other) and "minor" rounds (survivors meet
// the newly dropped players); grand final, with a second game if the losers-bracket champion wins the first.
// `rounds` is the length of the critical path: each game is played one time slot after both players are free.
export function doubleElim(n, game, rand, { seeded = true, field } = {}) {
  const seeds = seedList(n, seeded, rand, field);
  const games = new Array(n).fill(0), free = new Array(n).fill(0);
  let rounds = 0;
  const play = (a, b) => {
    games[a]++; games[b]++;
    const t = Math.max(free[a], free[b]) + 1; free[a] = free[b] = t; rounds = Math.max(rounds, t);
    return decisive(game, a, b);
  };
  let m = 1; while (m < n) m *= 2;
  let slots = bracketOrder(m).map(k => (k <= n ? seeds[k - 1] : -1));
  const dropped = [];
  while (slots.length > 1) {
    const next = [], lost = [];
    for (let k = 0; k < slots.length; k += 2) {
      const a = slots[k], b = slots[k + 1];
      if (a < 0) next.push(b); else if (b < 0) next.push(a);
      else { const w = play(a, b); next.push(w); lost.push(w === a ? b : a); }
    }
    if (lost.length) dropped.push(lost);
    slots = next;
  }
  const wbChamp = slots[0];
  const reduce = arr => {
    const next = [];
    for (let k = 0; k + 1 < arr.length; k += 2) next.push(play(arr[k], arr[k + 1]));
    if (arr.length % 2) next.unshift(arr[arr.length - 1]); // the bye goes to the last listed player
    return next;
  };
  let pool = [];
  dropped.forEach((lost, r) => {
    if (r === 0) { pool = lost.slice(); }
    else {
      // minor round: survivors meet newcomers one to one (newcomers in reverse order to avoid quick rematches)
      const nw = lost.slice().reverse(), next = [];
      const k = Math.min(pool.length, nw.length);
      for (let i = 0; i < k; i++) next.push(play(pool[i], nw[i]));
      pool = [...next, ...pool.slice(k), ...nw.slice(k)];
    }
    const target = r + 1 < dropped.length ? Math.max(1, dropped[r + 1].length) : 1;
    while (pool.length > target) pool = reduce(pool); // major rounds
  });
  if (!pool.length) return { winner: wbChamp, games, rounds };
  const lbChamp = pool[0];
  let w = play(wbChamp, lbChamp);
  if (w === lbChamp) w = play(wbChamp, lbChamp);
  return { winner: w, games, rounds };
}

// ---------- Monte Carlo summary ----------
export function evaluate(format, n, opts, { sigma, drawRate = 0, runs = 20000, seed = 7 } = {}) {
  const rand = rng(seed);
  const s = quantileField(n, sigma);
  const game = makeGame(s, nuForDrawRate(drawRate), rand);
  opts = { ...opts, field: s };
  const winCount = new Array(n).fill(0);
  let minGames = Infinity, sumGames = 0, rounds = 0;
  for (let t = 0; t < runs; t++) {
    const r = format(n, game, rand, opts);
    winCount[r.winner]++;
    minGames = Math.min(minGames, ...r.games);
    sumGames += r.games.reduce((a, b) => a + b, 0) / n;
    rounds = Math.max(rounds, r.rounds);
  }
  const p = winCount.map(c => c / runs);
  const se = q => Math.sqrt(q * (1 - q) / runs);
  return {
    pBest: p[0], seBest: se(p[0]),
    pTop2: p[0] + (p[1] || 0), pTop3: p[0] + (p[1] || 0) + (p[2] || 0),
    winDist: p, minGames, avgGames: sumGames / runs, rounds,
  };
}

// ---------- time ----------
// Matches per round, assuming unlimited tables and rounds run one after another (tie-break playoffs not included).
// For double elimination this includes the grand-final reset game (worst case).
export function roundShape(name, n, opts = {}) {
  const half = Math.floor(n / 2);
  const koShape = k => { let m = 1; while (m < k) m *= 2; const out = []; if (k < 2) return out; out.push(k - m / 2); for (let r = m / 4; r >= 1; r /= 2) out.push(r); return out; };
  if (name === 'knockout') return koShape(n);
  if (name === 'roundRobin') return new Array(n % 2 ? n : n - 1).fill(half).flatMap(x => new Array(opts.cycles || 1).fill(x));
  if (name === 'swiss') return new Array(opts.rounds || 5).fill(half);
  if (name === 'groupsKnockout') {
    const g = opts.groupSize || 4, adv = opts.adv || 2, G = Math.max(1, Math.round(n / g));
    const sizes = new Array(G).fill(0); for (let k = 0; k < n; k++) sizes[k % G]++;
    const R = Math.max(...sizes.map(s => (s % 2 ? s : s - 1)));
    const groupRounds = new Array(R).fill(sizes.reduce((t, s) => t + Math.floor(s / 2), 0));
    return [...groupRounds, ...koShape(sizes.reduce((t, s) => t + Math.min(adv, s), 0))];
  }
  if (name === 'doubleElim') {
    return doubleElimTimes(n);
  }
  throw new Error('unknown format ' + name);
}

// Slot counts of a double-elimination bracket: simulate with "the first listed player wins", then add the reset.
function doubleElimTimes(n) {
  const counts = [];
  const free = new Array(n).fill(0);
  let last = 0;
  const g = (a, b) => {
    const t = Math.max(free[a], free[b]) + 1; free[a] = free[b] = t; counts[t - 1] = (counts[t - 1] || 0) + 1; last = t;
    return 1;
  };
  doubleElim(n, g, rng(1), { seeded: true });
  // with "first listed wins" the winners-bracket champion wins the final; add the possible reset game
  counts.push(1);
  return counts;
}

// Time slots needed with `tables` tables: each round takes ceil(matches / tables) slots.
export function slotsNeeded(shape, tables) {
  return shape.reduce((t, c) => t + Math.ceil(c / Math.max(1, tables)), 0);
}
