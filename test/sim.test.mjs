import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('bracketOrder', () => {
  assert.deepEqual(S.bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(S.bracketOrder(4), [1, 4, 2, 3]);
});

test('sigmaFor inverts bestVsMiddle', () => {
  for (const n of [4, 9, 16]) for (const p of [0.6, 0.75, 0.9]) close(S.bestVsMiddle(n, S.sigmaFor(n, p)), p, 1e-9, `n=${n}`);
});

test('circle schedule: everyone meets everyone once, one game per round', () => {
  for (const n of [2, 3, 6, 7, 10]) {
    const seen = new Set();
    for (const round of S.circleSchedule(n)) {
      const inRound = new Set();
      for (const [a, b] of round) {
        assert.ok(!inRound.has(a) && !inRound.has(b)); inRound.add(a); inRound.add(b);
        const k = Math.min(a, b) + ',' + Math.max(a, b); assert.ok(!seen.has(k)); seen.add(k);
      }
    }
    assert.equal(seen.size, n * (n - 1) / 2);
  }
});

// Exact P(win) for a seeded knockout by recursion over the bracket.
function exactKO(s, n) {
  let m = 1; while (m < n) m *= 2;
  const slots = S.bracketOrder(m).map(k => (k <= n ? k - 1 : -1));
  const P = (i, j) => S.logistic(s[i] - s[j]);
  function dist(lo, hi) { // map player -> prob of winning this subtree
    if (hi - lo === 1) return slots[lo] < 0 ? new Map() : new Map([[slots[lo], 1]]);
    const mid = (lo + hi) / 2, L = dist(lo, mid), R = dist(mid, hi);
    if (!L.size) return R; if (!R.size) return L;
    const out = new Map();
    for (const [a, pa] of L) { let t = 0; for (const [b, pb] of R) t += pb * P(a, b); out.set(a, pa * t); }
    for (const [b, pb] of R) { let t = 0; for (const [a, pa] of L) t += pa * P(b, a); out.set(b, pb * t); }
    return out;
  }
  return dist(0, m);
}

test('knockout Monte Carlo matches exact recursion (n=6, 8, 13)', () => {
  for (const n of [6, 8, 13]) {
    const sigma = S.sigmaFor(n, 0.75), runs = 40000;
    const ex = exactKO(S.quantileField(n, sigma), n);
    const r = S.evaluate(S.knockout, n, { seeded: true }, { sigma, runs, seed: 11 });
    for (let i = 0; i < 3; i++) close(r.winDist[i], ex.get(i), 4 * Math.sqrt(ex.get(i) / runs) + 1e-3, `n=${n} player ${i}`);
  }
});

// Exact round robin for small n: enumerate all outcomes (no draws); ties at the top: Sonneborn-Berger, then a
// random-order playoff, whose exact value we compute only when it is a 2-way tie (3-way ties: enumerate orders).
function exactRR(s) {
  const n = s.length, pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  const P = (i, j) => S.logistic(s[i] - s[j]);
  const win = new Array(n).fill(0);
  for (let mask = 0; mask < (1 << pairs.length); mask++) {
    let pr = 1; const score = new Array(n).fill(0); const beat = Array.from({ length: n }, () => []);
    pairs.forEach(([i, j], k) => { if (mask >> k & 1) { pr *= P(i, j); score[i]++; beat[i].push(j); } else { pr *= P(j, i); score[j]++; beat[j].push(i); } });
    const top = Math.max(...score);
    let tied = [...Array(n).keys()].filter(p => score[p] === top);
    const sb = beat.map(b => b.reduce((t, o) => t + score[o], 0));
    const t = Math.max(...tied.map(p => sb[p])); tied = tied.filter(p => sb[p] === t);
    if (tied.length === 1) { win[tied[0]] += pr; continue; }
    // playoff: random order, pairs (0,1), (2,3)..., odd one gets a bye; average over all orders
    const perms = permutations(tied);
    for (const order of perms) {
      const d = koDist(order, P);
      for (const [p, q] of d) win[p] += pr * q / perms.length;
    }
  }
  return win;
}
function permutations(a) { if (a.length <= 1) return [a]; return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }
function koDist(pool, P) { // pairs neighbours, odd last gets bye, repeat
  let dists = pool.map(p => new Map([[p, 1]]));
  while (dists.length > 1) {
    const next = [];
    for (let k = 0; k + 1 < dists.length; k += 2) {
      const L = dists[k], R = dists[k + 1], out = new Map();
      for (const [a, pa] of L) { let t = 0; for (const [b, pb] of R) t += pb * P(a, b); out.set(a, pa * t); }
      for (const [b, pb] of R) { let t = 0; for (const [a, pa] of L) t += pa * P(b, a); out.set(b, pb * t); }
      next.push(out);
    }
    if (dists.length % 2) next.push(dists[dists.length - 1]);
    dists = next;
  }
  return dists[0];
}

test('round robin Monte Carlo matches exact enumeration (n=4, 5)', () => {
  for (const n of [4, 5]) {
    const sigma = S.sigmaFor(n, 0.7), runs = 40000;
    const ex = exactRR(S.quantileField(n, sigma));
    close(ex.reduce((a, b) => a + b, 0), 1, 1e-9, 'exact sums to 1');
    const r = S.evaluate(S.roundRobin, n, {}, { sigma, runs, seed: 5 });
    for (let i = 0; i < n; i++) close(r.winDist[i], ex[i], 4 * Math.sqrt(ex[i] / runs) + 1e-3, `n=${n} player ${i}`);
  }
});

test('no skill -> everyone equally likely; huge skill -> best always wins', () => {
  const fmts = [[S.knockout, { seeded: true }], [S.roundRobin, {}], [S.swiss, { rounds: 4 }], [S.groupsKnockout, {}], [S.doubleElim, {}]];
  for (const [f, o] of fmts) {
    // 16 players: no byes, so with no skill differences every player is equally likely to win
    const r0 = S.evaluate(f, 16, o, { sigma: 0, runs: 16000 });
    close(r0.pBest, 1 / 16, 0.012, `${f.name} sigma 0`);
    const r1 = S.evaluate(f, 12, o, { sigma: 40, runs: 2000 });
    close(r1.pBest, 1, 1e-9, `${f.name} sigma 40`);
  }
});

test('swiss: no rematches when avoidable, one bye per player at most, game counts', () => {
  const rand = S.rng(3);
  for (const n of [8, 9, 16, 21]) {
    const s = S.quantileField(n, 1);
    const pairs = [];
    const game = (a, b) => { pairs.push([a, b]); return S.makeGame(s, 0, rand)(a, b); };
    const rounds = Math.ceil(Math.log2(n)) + 1;
    const r = S.swiss(n, game, rand, { rounds });
    const keys = pairs.slice(0, Math.floor(n / 2) * rounds).map(([a, b]) => Math.min(a, b) + ',' + Math.max(a, b));
    assert.equal(new Set(keys).size, keys.length, `rematch at n=${n}`);
    const total = r.games.reduce((a, b) => a + b, 0);
    assert.equal(total, 2 * Math.floor(n / 2) * rounds);
    for (const g of r.games) assert.ok(g >= rounds - 1 && g <= rounds);
  }
});

test('double elimination: every non-winner ends with exactly two losses, the winner with at most one', () => {
  const rand = S.rng(9);
  for (const n of [3, 4, 5, 6, 8, 11, 16, 23]) {
    const s = S.quantileField(n, 1);
    const g = S.makeGame(s, 0, rand);
    for (let t = 0; t < 300; t++) {
      const losses = new Array(n).fill(0);
      const game = (a, b) => { const r = g(a, b); losses[r === 1 ? b : a]++; return r; };
      const r = S.doubleElim(n, game, rand);
      losses.forEach((l, p) => assert.ok(p === r.winner ? l <= 1 : l === 2, `n=${n} player ${p} losses ${l}`));
    }
  }
});

test('draws: equal players draw at the requested rate', () => {
  const rand = S.rng(4), g = S.makeGame([0, 0], S.nuForDrawRate(0.3), rand);
  let d = 0; const N = 50000; for (let k = 0; k < N; k++) if (g(0, 1) === 0.5) d++;
  close(d / N, 0.3, 0.01, 'draw rate');
});
