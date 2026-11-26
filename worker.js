// Runs the simulations off the main thread. Message in: { id, n, p, draw, seeding, bestOf, formats: [{key, fn, opts}], combos: [{key, fn, opts, bestOf}], swissMin, swissMax }
import * as S from './src/sim.js';
const FN = { knockout: S.knockout, doubleElim: S.doubleElim, swiss: S.swiss, groupsKnockout: S.groupsKnockout, roundRobin: S.roundRobin };
let current = 0;
self.onmessage = async e => {
  const job = e.data; current = job.id;
  const field = job.ratings ? S.fieldFromRatings(job.ratings) : null;
  const sigma = field ? S.sd(field) : S.sigmaFor(job.n, job.p);
  const seeded = job.seeding === 'exact' ? true : job.seeding === 'rough' ? sigma : false;
  const yieldNow = () => new Promise(r => setTimeout(r, 0));
  for (const f of job.formats) {
    await yieldNow(); if (current !== job.id) return;
    const r = S.evaluate(FN[f.fn], job.n, { ...f.opts, seeded }, { sigma, field, drawRate: job.draw, runs: job.runs, seed: 7, bestOf: job.bestOf });
    self.postMessage({ id: job.id, type: 'format', key: f.key, r: { pBest: r.pBest, seBest: r.seBest, pTop3: r.pTop3, minGames: r.minGames, avgGames: r.avgGames } });
  }
  // every format at every match length, for "longer matches or more rounds?"
  const combos = [];
  for (const c of job.combos || []) {
    await yieldNow(); if (current !== job.id) return;
    const r = S.evaluate(FN[c.fn], job.n, { ...c.opts, seeded }, { sigma, field, drawRate: job.draw, runs: job.runs, seed: 29 + c.bestOf, bestOf: c.bestOf });
    combos.push({ key: c.key, pBest: r.pBest, seBest: r.seBest });
    self.postMessage({ id: job.id, type: 'combos', combos });
  }
  const swiss = [];
  for (let k = job.swissMin; k <= job.swissMax; k++) {
    await yieldNow(); if (current !== job.id) return;
    const r = S.evaluate(S.swiss, job.n, { rounds: k, seeded }, { sigma, field, drawRate: job.draw, runs: Math.round(job.runs / 2), seed: 11 + k, bestOf: job.bestOf });
    swiss.push({ k, p: r.pBest, se: r.seBest });
    self.postMessage({ id: job.id, type: 'swiss', swiss });
  }
  self.postMessage({ id: job.id, type: 'done' });
};
