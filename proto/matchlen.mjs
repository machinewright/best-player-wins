// Prototype: with a fixed time budget, single games vs best-of-3/5 matches.
import * as S from '../src/sim.js';
// match of up to k games (k odd): stop once someone has more than k/2 points; draws count half; a level match is a draw.
const matchOf = (game, k) => k === 1 ? game : (i, j) => {
  let a = 0, b = 0;
  for (let g = 0; g < k && a <= k / 2 && b <= k / 2; g++) { const r = game(i, j); a += r; b += 1 - r; }
  return a > b ? 1 : b > a ? 0 : 0.5;
};
const fmts = n => { const L = Math.ceil(Math.log2(n)); return [
  ['KO', S.knockout, {}, S.roundShape('knockout', n)],
  ['DE', S.doubleElim, {}, S.roundShape('doubleElim', n)],
  ...[L, L + 1, L + 2, L + 3].filter(k => k <= Math.floor(0.6 * n)).map(k => [`Sw${k}`, S.swiss, { rounds: k }, S.roundShape('swiss', n, { rounds: k })]),
  ['Gr', S.groupsKnockout, { groupSize: 4, adv: 2 }, S.roundShape('groupsKnockout', n, { groupSize: 4, adv: 2 })],
  ['RR', S.roundRobin, {}, S.roundShape('roundRobin', n)],
]; };
function ev(fn, n, opts, sigma, k, draw, runs = 6000) {
  const rand = S.rng(5 + k); const s = S.quantileField(n, sigma);
  const game = matchOf(S.makeGame(s, S.nuForDrawRate(draw), rand), k);
  let w = 0; for (let t = 0; t < runs; t++) if (fn(n, game, rand, { ...opts, seeded: sigma, field: s }).winner === 0) w++;
  return w / runs;
}
for (const [n, p, tables, budgetSlots] of [[8, .7, 4, 12], [16, .8, 8, 12], [16, .65, 8, 15], [12, .75, 6, 12], [24, .8, 12, 15]]) {
  const sigma = S.sigmaFor(n, p);
  console.log(`\nn=${n} best-vs-middle=${p} tables=${tables} budget=${budgetSlots} game-slots (rough seeding)`);
  const rows = [];
  for (const [name, fn, opts, shape] of fmts(n)) for (const k of [1, 3, 5]) {
    const slots = S.slotsNeeded(shape, tables) * k;
    if (slots > budgetSlots) continue;
    rows.push([`${name} bo${k}`, slots, ev(fn, n, opts, sigma, k, 0)]);
  }
  rows.sort((a, b) => b[2] - a[2]).forEach(r => console.log(r[0].padEnd(10), String(r[1]).padStart(3), (100 * r[2]).toFixed(1)));
}
