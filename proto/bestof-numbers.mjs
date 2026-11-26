// Numbers for the "Longer matches or more rounds?" text: default page settings, 20,000 runs each.
import * as S from '../src/sim.js';
const n = +(process.argv[2] || 16), p = +(process.argv[3] || 0.8), tables = Math.floor(n / 2), mins = 20;
const sigma = S.sigmaFor(n, p), seeded = sigma; // "roughly"
const L = Math.ceil(Math.log2(n));
const F = [['KO', S.knockout, 'knockout', {}], ['DE', S.doubleElim, 'doubleElim', {}], ['Gr', S.groupsKnockout, 'groupsKnockout', { groupSize: 4, adv: 2 }], ['RR', S.roundRobin, 'roundRobin', {}]];
for (let r = L; r <= Math.floor(0.6 * n); r++) F.push([`Sw${r}`, S.swiss, 'swiss', { rounds: r }]);
const rows = [];
for (const k of [1, 3, 5]) for (const [name, fn, key, o] of F) {
  const mins_ = S.slotsNeeded(S.roundShape(key, n, o), tables) * mins * k;
  const r = S.evaluate(fn, n, { ...o, seeded }, { sigma, runs: 20000, seed: 100 + k, bestOf: k });
  rows.push([`${name} bo${k}`, mins_, r.pBest, r.seBest, r.minGames]);
}
rows.sort((a, b) => a[1] - b[1]);
let best = -1;
for (const r of rows) { const fr = r[2] > best + 0.005; if (fr) best = r[2]; console.log((fr ? '* ' : '  ') + r[0].padEnd(9), String(r[1]).padStart(4) + 'min', (100 * r[2]).toFixed(1) + '±' + (200 * r[3]).toFixed(1), 'minM=' + r[4]); }
