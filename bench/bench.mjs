// Real timings: 1 warmup + 7 measured passes over 72 orbit views, plus a cold pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildMeshlets, cullMeshlets, orbitViews } from '../src/core.mjs';
import { exactPerTriangleCull } from '../baseline/tri-backface.mjs';

const doc = JSON.parse(readFileSync(new URL('../data/mesh.json', import.meta.url), 'utf8'));
const positions = doc.positions, indices = doc.indices;
const views = orbitViews(72, 8);
const coldStart = performance.now();
const built = buildMeshlets(positions, indices, { maxVerts: 32, maxTris: 32 });
const { meshlets } = built;
const coldBuildMs = performance.now() - coldStart;

function conePass() {
  let culled = 0, tris = 0;
  for (const v of views) { const r = cullMeshlets(meshlets, v); culled += r.culled; tris += r.trisCulled; }
  return { culled, tris };
}
function exactPass() {
  let culled = 0, tris = 0;
  for (const v of views) {
    const r = exactPerTriangleCull(meshlets, positions, indices, v);
    culled += r.culled;
    for (let i = 0; i < meshlets.length; i++) if (r.flags[i]) tris += meshlets[i].triCount;
  }
  return { culled, tris };
}

// cold: the first cone pass is measured before any warmup
const coldT0 = performance.now();
const coldPass = conePass();
const coldMs = performance.now() - coldT0;

conePass(); // warmup
const coneSamples = [], exactSamples = [];
for (let i = 0; i < 7; i++) {
  let t = performance.now(); conePass(); coneSamples.push(performance.now() - t);
  t = performance.now(); exactPass(); exactSamples.push(performance.now() - t);
}
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const med = s[Math.floor(s.length / 2)];
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  return { min: s[0], median: med, p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1], max: s[s.length - 1], stddev: sd, rsd: sd / mean };
};
const cone = stats(coneSamples), exact = stats(exactSamples);
const result = {
  sample: { vertices: positions.length / 3, triangles: indices.length / 3, meshlets: meshlets.length, maxVerts: 32, maxTris: 32 },
  views: 72,
  samples: 7,
  cold: { passMs: Number(coldMs.toFixed(3)), buildMs: Number(coldBuildMs.toFixed(2)), culled: coldPass.culled, trisCulled: coldPass.tris },
  cone: { ...Object.fromEntries(Object.entries(cone).map(([k, v]) => [k, Number(v.toFixed(4))])), culled: conePass().culled, trisCulled: conePass().tris, tests: meshlets.length * 72 },
  exactBaseline: { ...Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, Number(v.toFixed(4))])), tests: indices.length / 3 * 72 },
  speedupMedian: Number((exact.median / cone.median).toFixed(2)),
  testReduction: Number(((indices.length / 3 * 72) / (meshlets.length * 72)).toFixed(1)),
  cullRatePct: Number(((conePass().tris / (indices.length / 3 * 72)) * 100).toFixed(2)),
  exactCullRatePct: Number(((exactPass().tris / (indices.length / 3 * 72)) * 100).toFixed(2)),
  generatedAt: new Date().toISOString(),
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
