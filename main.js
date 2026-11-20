import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildMeshlets, coneCull, cullMeshlets, exactCull, orbitViews } from './src/core.mjs';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 500);
camera.position.set(0, 3.4, 7.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;

scene.add(new THREE.HemisphereLight(0xbfe4ff, 0x1b2230, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 3);
scene.add(key);
scene.add(new THREE.DirectionalLight(0x6db7ff, 0.7).translateX(-5));

const doc = await fetch('./data/mesh.json').then((r) => {
  if (!r.ok) throw new Error(`data/mesh.json: HTTP ${r.status}`);
  return r.json();
});
const positions = doc.positions, indices = doc.indices;
const { meshlets, triangleNormals } = buildMeshlets(positions, indices, { maxVerts: 32, maxTris: 32 });

// solid mesh, non-indexed so normals stay faceted
const meshPos = new Float32Array(indices.length * 3);
for (let i = 0; i < indices.length; i++) {
  const v = indices[i];
  meshPos[i * 3] = positions[v * 3];
  meshPos[i * 3 + 1] = positions[v * 3 + 1];
  meshPos[i * 3 + 2] = positions[v * 3 + 2];
}
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(meshPos, 3));
geom.computeVertexNormals();
const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
  color: 0x9fb4cc, roughness: 0.42, metalness: 0.28, flatShading: true,
}));
scene.add(mesh);

// x-ray cull map: one point per meshlet center, always drawn over the mesh
const centers = new Float32Array(meshlets.length * 3);
const colors = new Float32Array(meshlets.length * 3);
const plist = meshlets.map((m) => m.center);
plist.forEach((c, i) => { centers.set(c, i * 3); });
const pgeom = new THREE.BufferGeometry();
pgeom.setAttribute('position', new THREE.BufferAttribute(centers, 3));
pgeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const points = new THREE.Points(pgeom, new THREE.PointsMaterial({
  size: 0.075, vertexColors: true, depthTest: false, transparent: true, opacity: 0.95,
}));
scene.add(points);

const HUD = {
  total: document.getElementById('m-total'), culled: document.getElementById('m-culled'),
  tri: document.getElementById('m-tri'), exact: document.getElementById('m-exact'),
  false: document.getElementById('m-false'), tests: document.getElementById('m-tests'),
};
HUD.total.textContent = `${meshlets.length} / ${indices.length / 3} tris`;

function update() {
  const view = [camera.position.x, camera.position.y, camera.position.z];
  const r = cullMeshlets(meshlets, view);
  let falseCulls = 0;
  for (let i = 0; i < meshlets.length; i++) {
    const culled = r.flags[i] === 1;
    if (culled) {
      for (const t of meshlets[i].tris) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
          const v = indices[t * 3 + k];
          cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2];
        }
        const dx = view[0] - cx / 3, dy = view[1] - cy / 3, dz = view[2] - cz / 3;
        const dl = Math.hypot(dx, dy, dz) || 1;
        if ((triangleNormals[t * 3] * dx + triangleNormals[t * 3 + 1] * dy + triangleNormals[t * 3 + 2] * dz) / dl > 1e-12) falseCulls++;
      }
      colors.set([1, 0.23, 0.23], i * 3);
    } else colors.set([0.22, 0.85, 0.54], i * 3);
  }
  pgeom.attributes.color.needsUpdate = true;
  const exact = exactCull(meshlets, positions, indices, triangleNormals, view);
  HUD.culled.textContent = `${r.culled} (${((r.culled / meshlets.length) * 100).toFixed(1)}%)`;
  HUD.tri.textContent = `${((r.trisCulled / (indices.length / 3)) * 100).toFixed(2)}% of ${indices.length / 3} tris`;
  HUD.exact.textContent = `${exact.culled} clusters`;
  HUD.false.textContent = `${falseCulls} (live per-triangle oracle)`;
  HUD.tests.textContent = `${meshlets.length} / ${indices.length / 3}`;
}

controls.addEventListener('change', update);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
update();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
