import * as S from '../src/sim.js';
const runs = +process.argv[2] || 10000;
for (const n of [8, 16, 32]) for (const p of [0.65, 0.8, 0.95]) {
  const sigma = S.sigmaFor(n, p);
  const L = Math.ceil(Math.log2(n));
  const rows = [
    ['KO seeded', S.knockout, { seeded: true }], ['KO random', S.knockout, { seeded: false }],
    ['Double elim', S.doubleElim, {}],
    [`Swiss ${L}`, S.swiss, { rounds: L }], [`Swiss ${L + 2}`, S.swiss, { rounds: L + 2 }],
    ['Groups4+KO', S.groupsKnockout, {}], ['Round robin', S.roundRobin, {}],
  ];
  if (n > 16) rows.pop();
  const out = rows.map(([name, f, o]) => { const r = S.evaluate(f, n, o, { sigma, runs }); return `${name}: ${(100*r.pBest).toFixed(0)}% top2 ${(100*r.pTop2).toFixed(0)}% rds ${r.rounds} minG ${r.minGames}`; });
  console.log(`n=${n} best-vs-middle ${p}:\n  ` + out.join('\n  '));
}
