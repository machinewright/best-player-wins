import * as S from '../src/sim.js';
const runs = 6000;
for (const n of [8, 16, 32]) for (const p of [0.8, 0.95]) {
  const sigma = S.sigmaFor(n, p), L = Math.ceil(Math.log2(n));
  const line = [];
  for (const [lab, sd] of [['exact', true], ['rough', sigma], ['none', false]]) {
    const f = (fmt, o) => (100 * S.evaluate(fmt, n, { ...o, seeded: sd }, { sigma, runs }).pBest).toFixed(0);
    line.push(`${lab}: KO ${f(S.knockout, {})} DE ${f(S.doubleElim, {})} Sw${L} ${f(S.swiss, { rounds: L })} Sw${L+2} ${f(S.swiss, { rounds: L + 2 })} Gr ${f(S.groupsKnockout, {})}`);
  }
  const rr = n <= 16 ? (100 * S.evaluate(S.roundRobin, n, {}, { sigma, runs }).pBest).toFixed(0) : '-';
  console.log(`n=${n} p=${p} RR ${rr}\n  ` + line.join('\n  '));
}
