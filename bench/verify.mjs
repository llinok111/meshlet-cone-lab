// Assertions against the real generated mesh. Every printed number is measured.
import { readFileSync } from 'node:fs';
import {
  buildMeshlets, triangleNormals, signedVolume, partitionStats, meshletHash,
  coneCull, cullMeshlets, exactCull, verifyNoFalseCull, boundsCheck, scalePositions,
  orbitViews,
} from '../src/core.mjs';
import { exactPerTriangleCull } from '../baseline/tri-backface.mjs';

const doc = JSON.parse(readFileSync(new URL('../data/mesh.json', import.meta.url), 'utf8'));
const positions = doc.positions;
const indices = doc.indices;
const VIEWS = 72;
const views = orbitViews(VIEWS, 8);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}: ${detail}`); }
  else { fail++; console.log(`FAIL ${name}: ${detail}`); }
}

const t0 = performance.now();
const built = buildMeshlets(positions, indices, { maxVerts: 32, maxTris: 32 });
const buildMs = performance.now() - t0;
const { meshlets, triangleNormals: normals, triCount } = built;

const ps = partitionStats(meshlets, indices, { maxVerts: 32, maxTris: 32 });
check('A1 partition-covers-each-triangle-exactly-once',
  ps.dup === 0 && ps.missing === 0 && ps.badIndex === 0,
  `duplicates=${ps.dup} missing=${ps.missing} badIndex=${ps.badIndex} triangles=${triCount}`);
check('A2 caps-respected',
  ps.overVerts === 0 && ps.overTris === 0 && ps.empty === 0,
  `meshlets=${ps.meshlets} overVerts=${ps.overVerts} overTris=${ps.overTris} empty=${ps.empty}`);
check('A3-triangle-count-conserved',
  meshlets.reduce((s, m) => s + m.triCount, 0) === triCount,
  `sum=${meshlets.reduce((s, m) => s + m.triCount, 0)} total=${triCount}`);
const maxV = Math.max(...meshlets.map((m) => m.vertexCount));
const maxT = Math.max(...meshlets.map((m) => m.triCount));
check('A4-cap-headroom', maxV <= 32 && maxT <= 32, `maxVerts=${maxV} maxTris=${maxT} (caps 32/32)`);

const bc = boundsCheck(meshlets, positions, normals);
check('A5-bounding-sphere-contains-all-vertices', bc.worstSphere <= 1e-9,
  `max(vertexDist-radius)=${bc.worstSphere.toExponential(3)}`);
check('A6-normal-cone-contains-all-triangle-normals', bc.worstCone <= 1e-9,
  `max(cosCutoff-dot)=${bc.worstCone.toExponential(3)} coneMaxDeg=${Math.max(...meshlets.map((m) => m.coneDeg)).toFixed(3)}`);

const vol = signedVolume(positions, indices);
check('A7-outward-winding', vol > 0, `signedVolume=${vol.toFixed(9)} (>0)`);

// edge watertightness (independent of meshlet code)
const edges = new Map();
for (let t = 0; t < indices.length; t += 3) {
  for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + (k + 1) % 3];
    const key = a < b ? a + ',' + b : b + ',' + a;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
}
let nonTwo = 0;
for (const c of edges.values()) if (c !== 2) nonTwo++;
check('A8-watertight-closed-surface', nonTwo === 0, `edges=${edges.size} nonManifoldOrBoundaryEdges=${nonTwo}`);

let totalCulled = 0, totalFalse = 0, triChecked = 0, worstCulledDot = -Infinity;
let exactTotal = 0, exactTris = 0, meshletTests = 0, exactTests = 0;
let recallNum = 0, recallDen = 0, baselineMismatch = 0;
const viewStats = [];
for (const v of views) {
  const r = cullMeshlets(meshlets, v);
  const verify = verifyNoFalseCull(meshlets, r.flags, positions, indices, normals, v);
  const ex = exactCull(meshlets, positions, indices, normals, v);
  const bl = exactPerTriangleCull(meshlets, positions, indices, v);
  totalCulled += r.culled; totalFalse += verify.falseCulls; triChecked += verify.checked;
  if (verify.worstDot > worstCulledDot) worstCulledDot = verify.worstDot;
  exactTotal += ex.culled; exactTris += ex.trisCulled;
  meshletTests += meshlets.length; exactTests += ex.checks;
  recallNum += r.culled; recallDen += ex.culled;
  let mismatch = 0;
  for (let i = 0; i < meshlets.length; i++) if ((bl.flags[i] === 1) !== (ex.flags[i] === 1)) mismatch++;
  baselineMismatch += mismatch;
  viewStats.push({ culled: r.culled, exact: ex.culled });
}
check('A9-no-false-culls-over-72-views', totalFalse === 0,
  `culledMeshlets=${totalCulled} trianglesInsideCulled=${triChecked} falseCulls=${totalFalse} maxDot=${worstCulledDot.toExponential(3)}`);
check('A10-cone-cull-is-subset-of-exact-cull', recallNum <= recallDen,
  `coneCulled=${recallNum} exactCulled=${recallDen}`);
const meanRate = totalCulled / (VIEWS * meshlets.length);
const exactRate = exactTotal / (VIEWS * meshlets.length);
check('A11-cull-rate-in-expected-band', meanRate > 0.2 && meanRate < 0.8,
  `coneRate=${(meanRate * 100).toFixed(2)}% exactRate=${(exactRate * 100).toFixed(2)}% perViewMin=${Math.min(...viewStats.map((s) => s.culled))} max=${Math.max(...viewStats.map((s) => s.culled))}`);
const recall = recallDen ? recallNum / recallDen : 1;
check('A12-coverage-of-exact-cullable-clusters', recall >= 0.70,
  `recall=${(recall * 100).toFixed(2)}% (${recallNum}/${recallDen})`);
check('A13-baseline-agrees-with-exact-oracle', baselineMismatch === 0,
  `mismatchedClusterViewPairs=${baselineMismatch} over ${VIEWS} views`);
const reduction = exactTests / meshletTests;
check('A14-test-count-reduction', reduction > 10,
  `meshletTests=${meshletTests} triangleTests=${exactTests} reduction=${reduction.toFixed(1)}x`);
const coneCulledTris = meshlets.reduce((s, m, i) => s, 0) + views.reduce((s, v) => s + cullMeshlets(meshlets, v).trisCulled, 0);
check('A15-triangle-work-removed', coneCulledTris < triCount * VIEWS,
  `keptTriangleTests=${triCount * VIEWS - coneCulledTris} of ${triCount * VIEWS}, removed=${((coneCulledTris / (triCount * VIEWS)) * 100).toFixed(2)}% exactRemoved=${((exactTris / (triCount * VIEWS)) * 100).toFixed(2)}%`);

const rebuilt = buildMeshlets(positions, indices, { maxVerts: 32, maxTris: 32 });
check('A16-deterministic-partition',
  rebuilt.meshlets.length === meshlets.length && meshletHash(rebuilt.meshlets) === meshletHash(meshlets),
  `rebuildMeshlets=${rebuilt.meshlets.length} hash=${meshletHash(meshlets).toString(16)} buildMs=${buildMs.toFixed(2)}`);

let scaleBad = 0, scaleViews = 0;
for (const s of [1e-3, 1e3]) {
  const sp = scalePositions(positions, s);
  const sb = buildMeshlets(sp, indices, { maxVerts: 32, maxTris: 32 });
  if (meshletHash(sb.meshlets) !== meshletHash(meshlets)) scaleBad++;
  for (const v of views) {
    const sv = v.map((x) => x * s);
    const a = cullMeshlets(meshlets, v);
    const b = cullMeshlets(sb.meshlets, sv);
    for (let i = 0; i < meshlets.length; i++) if (a.flags[i] !== b.flags[i]) scaleBad++;
    scaleViews++;
  }
}
check('A17-scale-invariant-partition-and-culls', scaleBad === 0,
  `scales=1e-3,1e3 views=${scaleViews} mismatches=${scaleBad}`);

let distFalse = 0, distChecks = 0;
for (const dist of [3.2, 5, 20, 100, 1000]) {
  for (const v of orbitViews(24, dist)) {
    const r = cullMeshlets(meshlets, v);
    const q = verifyNoFalseCull(meshlets, r.flags, positions, indices, normals, v);
    distFalse += q.falseCulls; distChecks += q.checked;
  }
}
check('A18-no-false-culls-across-5-view-distances', distFalse === 0,
  `distances=3.2,5,20,100,1000 views=120 culledTrianglesChecked=${distChecks} falseCulls=${distFalse}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);