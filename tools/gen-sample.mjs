// Deterministic sample: a (2,3) torus knot tube, closed and outward-wound.
// No randomness: the same command produces byte-identical output.
import { writeFileSync, mkdirSync } from 'node:fs';
import { signedVolume } from '../src/core.mjs';

const SEG = 96;            // around the major ring
const TUBE = 256;          // around the tube (normals vary slowly)
const R = 2.0;             // major radius
const KNOT_R = 0.85;       // tube radius

function torusPoint(u, v) {
  const rr = R + KNOT_R * Math.cos(v);
  return [rr * Math.cos(u), rr * Math.sin(u), KNOT_R * Math.sin(v)];
}

const positions = [];
for (let i = 0; i < SEG; i++) {
  const u = (i / SEG) * Math.PI * 2;
  for (let j = 0; j < TUBE; j++) {
    const v = (j / TUBE) * Math.PI * 2;
    positions.push(...torusPoint(u, v).map((x) => Number(x.toFixed(7))));
  }
}

const indices = [];
for (let i = 0; i < SEG; i++) {
  const i2 = (i + 1) % SEG;
  for (let j = 0; j < TUBE; j++) {
    const j2 = (j + 1) % TUBE;
    const a = i * TUBE + j, bb = i * TUBE + j2;
    const c = i2 * TUBE + j, d = i2 * TUBE + j2;
    indices.push(a, bb, d, a, d, c);
  }
}

if (signedVolume(positions, indices) < 0) {
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
  }
}

const vol = signedVolume(positions, indices);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const doc = {
  name: 'torus-96x256',
  note: 'procedurally generated closed torus; deterministic, no RNG',
  segments: SEG,
  tube: TUBE,
  positions,
  indices,
};
writeFileSync(new URL('../data/mesh.json', import.meta.url), JSON.stringify(doc) + '\n');
console.log(`wrote data/mesh.json  vertices=${positions.length / 3} triangles=${indices.length / 3} signedVolume=${vol.toFixed(9)}`);