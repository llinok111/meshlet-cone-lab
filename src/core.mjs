// Pure geometry core: meshlet partition + normal-cone backface culling.
// No three.js, no DOM, no I/O. Every function is deterministic.

export const DEFAULTS = { maxVerts: 64, maxTris: 124 };

function sub(a, i, b, j) {
  return [a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm(a) {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function triangleNormals(positions, indices) {
  const n = indices.length / 3;
  const out = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const nn = norm(cross(sub(positions, b, positions, a), sub(positions, c, positions, a)));
    out[t * 3] = nn[0]; out[t * 3 + 1] = nn[1]; out[t * 3 + 2] = nn[2];
  }
  return out;
}

export function signedVolume(positions, indices) {
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

// Greedy meshlet construction: grow a cluster over edge-adjacent triangles while
// staying under both the vertex and triangle caps.
export function buildMeshlets(positions, indices, opts = {}) {
  const maxVerts = opts.maxVerts ?? DEFAULTS.maxVerts;
  const maxTris = opts.maxTris ?? DEFAULTS.maxTris;
  const triCount = indices.length / 3;

  // edge -> incident triangles
  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const v = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const key = a < b ? a + ',' + b : b + ',' + a;
      let arr = edgeMap.get(key);
      if (!arr) { arr = []; edgeMap.set(key, arr); }
      arr.push(t);
    }
  }
  const neighbors = Array.from({ length: triCount }, () => []);
  for (const arr of edgeMap.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr.length; j++) {
        if (i !== j) neighbors[arr[i]].push(arr[j]);
      }
    }
  }
  for (const a of neighbors) a.sort((x, y) => x - y);

  const assigned = new Uint8Array(triCount);
  const meshlets = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (assigned[seed]) continue;
    const verts = new Set();
    const tris = [];
    const stack = [seed];
    while (stack.length && tris.length < maxTris) {
      const t = stack.pop();
      if (assigned[t]) continue;
      const v0 = indices[t * 3], v1 = indices[t * 3 + 1], v2 = indices[t * 3 + 2];
      let fresh = 0;
      if (!verts.has(v0)) fresh++;
      if (!verts.has(v1) && v1 !== v0) fresh++;
      if (!verts.has(v2) && v2 !== v0 && v2 !== v1) fresh++;
      if (verts.size + fresh > maxVerts) continue;
      assigned[t] = 1;
      verts.add(v0); verts.add(v1); verts.add(v2);
      tris.push(t);
      for (const nb of neighbors[t]) if (!assigned[nb]) stack.push(nb);
    }
    if (tris.length === 0) { // defensive: cap smaller than 1 triangle
      assigned[seed] = 1;
      verts.add(indices[seed * 3]); verts.add(indices[seed * 3 + 1]); verts.add(indices[seed * 3 + 2]);
      tris.push(seed);
    }
    tris.sort((a, b) => a - b);
    const vlist = Array.from(verts).sort((a, b) => a - b);
    meshlets.push(makeMeshlet(positions, indices, tris, vlist));
  }
  const normals = triangleNormals(positions, indices);
  for (const m of meshlets) finalizeCone(m, normals);
  return { meshlets, triangleNormals: normals, triCount, maxVerts, maxTris };
}

function makeMeshlet(positions, indices, tris, verts) {
  // Bounding sphere: AABB center, max vertex distance. Conservative, not minimal.
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const v of verts) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
  let r2 = 0;
  for (const v of verts) {
    const dx = positions[v * 3] - cx, dy = positions[v * 3 + 1] - cy, dz = positions[v * 3 + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return {
    tris, verts,
    center: [cx, cy, cz],
    radius: Math.sqrt(r2),
    axis: [0, 0, 1],
    cosCutoff: -1,
    coneDeg: 180,
    triCount: tris.length,
    vertexCount: verts.length,
  };
}

function finalizeCone(m, normals) {
  let ax = 0, ay = 0, az = 0;
  for (const t of m.tris) { ax += normals[t * 3]; ay += normals[t * 3 + 1]; az += normals[t * 3 + 2]; }
  let a = norm([ax, ay, az]);
  if (len([ax, ay, az]) === 0) a = [0, 0, 1];
  let cosMin = 1;
  for (const t of m.tris) {
    const d = a[0] * normals[t * 3] + a[1] * normals[t * 3 + 1] + a[2] * normals[t * 3 + 2];
    if (d < cosMin) cosMin = d;
  }
  m.axis = a;
  m.cosCutoff = Math.max(-1, Math.min(1, cosMin));
  m.coneDeg = Math.acos(m.cosCutoff) * 180 / Math.PI;
}

// Conservative cone cull. Returns true only when every triangle in the cluster
// is back-facing for the given view position, with a small safety margin.
export function coneCull(m, view, margin = 1e-12) {
  const dx = view[0] - m.center[0], dy = view[1] - m.center[1], dz = view[2] - m.center[2];
  const d = Math.hypot(dx, dy, dz);
  if (d <= m.radius) return false;
  const u = [dx / d, dy / d, dz / d];
  // A cone wider than a hemisphere contains visible normals in every
  // direction, so it can never be culled (and the closed-form limit below
  // is only valid for theta <= 90 degrees).
  if (m.cosCutoff <= 0) return false;
  const c = dot(m.axis, u);
  const theta = Math.acos(m.cosCutoff);
  const alpha = Math.asin(Math.min(1, m.radius / d));
  const limit = Math.sin(Math.min(Math.PI, theta + alpha));
  return c <= -limit - margin;
}

export function cullMeshlets(meshlets, view) {
  let culled = 0, trisCulled = 0;
  const flags = new Uint8Array(meshlets.length);
  for (let i = 0; i < meshlets.length; i++) {
    if (coneCull(meshlets[i], view)) {
      flags[i] = 1; culled++; trisCulled += meshlets[i].triCount;
    }
  }
  return { culled, trisCulled, flags };
}

// Independent per-triangle oracle: a cluster is cullable iff every triangle is
// back-facing. Deliberately does NOT reuse coneCull's formula.
export function exactCull(meshlets, positions, indices, normals, view) {
  const flags = new Uint8Array(meshlets.length);
  let culled = 0, trisCulled = 0, checks = 0, falseCulls = 0, worstDot = -Infinity;
  const culledTris = new Set();
  for (let i = 0; i < meshlets.length; i++) {
    const m = meshlets[i];
    let allBack = true;
    for (const t of m.tris) {
      checks++;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k];
        cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2];
      }
      cx /= 3; cy /= 3; cz /= 3;
      const dx = view[0] - cx, dy = view[1] - cy, dz = view[2] - cz;
      const dl = Math.hypot(dx, dy, dz);
      const d = (normals[t * 3] * dx + normals[t * 3 + 1] * dy + normals[t * 3 + 2] * dz) / (dl || 1);
      if (d > 0) allBack = false;
      if (d > worstDot) worstDot = d;
    }
    if (allBack) { flags[i] = 1; culled++; trisCulled += m.triCount; for (const t of m.tris) culledTris.add(t); }
  }
  return { flags, culled, trisCulled, checks, falseCulls, worstDot, culledTris };
}

// Check that a cone-culled cluster really has no front-facing triangle.
export function verifyNoFalseCull(meshlets, flags, positions, indices, normals, view) {
  let falseCulls = 0, checked = 0, worstDot = -Infinity;
  for (let i = 0; i < meshlets.length; i++) {
    if (!flags[i]) continue;
    const m = meshlets[i];
    for (const t of m.tris) {
      checked++;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k];
        cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2];
      }
      cx /= 3; cy /= 3; cz /= 3;
      const dx = view[0] - cx, dy = view[1] - cy, dz = view[2] - cz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const d = (normals[t * 3] * dx + normals[t * 3 + 1] * dy + normals[t * 3 + 2] * dz) / dl;
      if (d > 1e-12) falseCulls++;
      if (d > worstDot) worstDot = d;
    }
  }
  return { falseCulls, checked, worstDot };
}

export function partitionStats(meshlets, indices, opts = {}) {
  const maxVerts = opts.maxVerts ?? DEFAULTS.maxVerts;
  const maxTris = opts.maxTris ?? DEFAULTS.maxTris;
  const triCount = indices.length / 3;
  const seen = new Uint32Array(triCount);
  let dup = 0, badIndex = 0, overVerts = 0, overTris = 0, empty = 0;
  for (const m of meshlets) {
    if (m.triCount === 0) empty++;
    if (m.triCount > maxTris) overTris++;
    if (m.vertexCount > maxVerts) overVerts++;
    for (const t of m.tris) {
      if (t < 0 || t >= triCount) { badIndex++; continue; }
      seen[t]++; if (seen[t] > 1) dup++;
    }
  }
  let missing = 0;
  for (let t = 0; t < triCount; t++) if (seen[t] === 0) missing++;
  return { meshlets: meshlets.length, triCount, dup, missing, badIndex, overVerts, overTris, empty };
}

export function meshletHash(meshlets) {
  // FNV-1a over the exact partition, order sensitive.
  let h = 2166136261 >>> 0;
  for (const m of meshlets) {
    for (const v of m.verts) { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0;
    for (const t of m.tris) { h ^= t & 0xff; h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x3b; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function scalePositions(positions, s) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] * s;
  return out;
}

export function boundsCheck(meshlets, positions, normals, tol = 1e-9) {
  let worstSphere = 0, worstCone = 0;
  for (const m of meshlets) {
    for (const v of m.verts) {
      const dx = positions[v * 3] - m.center[0], dy = positions[v * 3 + 1] - m.center[1], dz = positions[v * 3 + 2] - m.center[2];
      const d = Math.hypot(dx, dy, dz) - m.radius;
      if (d > worstSphere) worstSphere = d;
    }
    for (const t of m.tris) {
      const d = m.axis[0] * normals[t * 3] + m.axis[1] * normals[t * 3 + 1] + m.axis[2] * normals[t * 3 + 2];
      const gap = m.cosCutoff - d;
      if (gap > worstCone) worstCone = gap;
    }
  }
  return { worstSphere, worstCone, ok: worstSphere <= tol && worstCone <= tol };
}
export function orbitViews(count, distance, center = [0, 0, 0]) {
  const views = [];
  for (let i = 0; i < count; i++) {
    const az = (i / count) * Math.PI * 2;
    const el = (-30 + 60 * ((i % 3) / 2)) * Math.PI / 180;
    views.push([
      center[0] + distance * Math.cos(el) * Math.cos(az),
      center[1] + distance * Math.sin(el),
      center[2] + distance * Math.cos(el) * Math.sin(az),
    ]);
  }
  return views;
}
