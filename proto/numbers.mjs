// Numbers quoted in the text. Default settings: 16 players, best beats middle 80%, rough seeding, no draws.
import * as S from '../src/sim.js';
const runs = 20000;
function row(n, p, seeding) {
  const sigma = S.sigmaFor(n, p), sd = seeding === 'exact' ? true : seeding === 'rough' ? sigma : false;
  const L = Math.ceil(Math.log2(n)), out = {};
  const F = { KO: [S.knockout, {}], DE: [S.doubleElim, {}], ['Sw' + L]: [S.swiss, { rounds: L }], ['Sw' + (L + 2)]: [S.swiss, { rounds: L + 2 }], Groups: [S.groupsKnockout, {}], RR: [S.roundRobin, {}] };
  for (const [k, [f, o]] of Object.entries(F)) { const r = S.evaluate(f, n, { ...o, seeded: sd }, { sigma, runs }); out[k] = `${(100 * r.pBest).toFixed(1)}±${(200 * r.seBest).toFixed(1)}`; }
  return out;
}
console.log('n=16 p=.8 rough', row(16, 0.8, 'rough'));
console.log('n=16 p=.8 exact', row(16, 0.8, 'exact'));
console.log('n=16 p=.8 none', row(16, 0.8, 'none'));
console.log('n=8 p=.8 rough', row(8, 0.8, 'rough'));
console.log('n=32 p=.8 rough', row(32, 0.8, 'rough'));
// Swiss: how often is first place shared after L rounds, and how often does the best player share it?
for (const n of [8, 16, 32]) {
  const sigma = S.sigmaFor(n, 0.8), rand = S.rng(5), L = Math.ceil(Math.log2(n));
  const game = S.makeGame(S.quantileField(n, sigma), 0, rand);
  let shared = 0, bestTop = 0, bestTopShared = 0, perfect = 0;
  for (let t = 0; t < runs; t++) {
    const r = S.swiss(n, game, rand, { rounds: L, seeded: sigma, field: S.quantileField(n, sigma) });
    const top = Math.max(...r.score), k = r.score.filter(x => x === top).length;
    if (k > 1) shared++; if (r.score[0] === top) { bestTop++; if (k > 1) bestTopShared++; }
    if (top === L) perfect++;
  }
  console.log(`Swiss n=${n} L=${L}: first place shared ${(100*shared/runs).toFixed(1)}%, best player on top score ${(100*bestTop/runs).toFixed(1)}% (shared ${(100*bestTopShared/runs).toFixed(1)}%)`);
}
// Best player vs others in the default field
{ const n = 16, s = S.quantileField(n, S.sigmaFor(n, 0.8)); console.log('P(best beats #2, #4, #8, #16):', [1, 3, 7, 15].map(i => S.logistic(s[0] - s[i]).toFixed(2)).join(' ')); }
