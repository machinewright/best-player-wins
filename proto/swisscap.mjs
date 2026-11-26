import * as S from '../src/sim.js';
for (const n of [6, 8, 10, 12, 16, 20, 24, 32, 48, 64]) {
  const L = Math.ceil(Math.log2(n)), out = [];
  for (let k = L; k <= Math.min(n - 1, L + 8); k++) {
    const rand = S.rng(1), g = S.makeGame(S.quantileField(n, S.sigmaFor(n, 0.8)), 0, rand);
    let rem = 0; const runs = 300, t0 = Date.now();
    for (let t = 0; t < runs; t++) {
      const log = []; S.swiss(n, (a, b) => { log.push(a < b ? a + ',' + b : b + ',' + a); return g(a, b); }, rand, { rounds: k, seeded: true });
      const main = log.slice(0, Math.floor(n / 2) * k); if (new Set(main).size < main.length) rem++;
    }
    out.push(`${k}:${Math.round(100 * rem / runs)}%/${Math.round((Date.now() - t0) / runs * 4000 / 1000)}s`);
  }
  console.log(`n=${n} L=${L}`, out.join(' '));
}
