// Baseline: exact per-cluster cull by testing every triangle. Independent of the
// cone test in src/core.mjs (own centroid + normal + dot math).
export function exactPerTriangleCull(meshlets, positions, indices, view) {
  const flags = new Uint8Array(meshlets.length);
  let trisTested = 0, culled = 0;
  for (let i = 0; i < meshlets.length; i++) {
    const m = meshlets[i];
    let visible = false;
    for (const t of m.tris) {
      trisTested++;
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      const ux = positions[b * 3] - positions[a * 3];
      const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
      const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const vx = positions[c * 3] - positions[a * 3];
      const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
      const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const cx = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
      const cy = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3;
      const cz = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
      const ex = view[0] - cx, ey = view[1] - cy, ez = view[2] - cz;
      const el = Math.hypot(ex, ey, ez) || 1;
      const d = (nx * ex + ny * ey + nz * ez) / (nl * el);
      if (d > 0) { visible = true; break; }
    }
    if (!visible) { flags[i] = 1; culled++; }
  }
  return { flags, culled, trisTested };
}