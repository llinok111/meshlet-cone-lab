# meshlet-cone-lab

One promise: build **1,679 meshlets** (≤32 verts / ≤32 tris) over a 49,152-triangle closed torus and cull **32.46% of the triangle workload per orbit view with 120,888 cluster tests instead of 3,538,944 triangle tests — 29.3× fewer tests, 15.08× faster than the in-repo exact per-triangle baseline, and 0 visible triangles lost across 72 views.**

Baseline: `baseline/tri-backface.mjs` (exact all-backfacing test per cluster, 3,538,944 triangle dots). Both numbers come from one machine in `bench/result.json`.

Upstream: none

## What it is

A GPU-driven-rendering style **meshlet partitioner + normal-cone backface culler**, with an independent per-triangle oracle that proves the cone never removes a visible cluster. The page orbits the mesh and shows an x-ray map of every meshlet center: red = culled by the cone, green = kept. The live counters are computed by the same `src/core.mjs` that the node bench uses.

## Run it

```bash
node tools/gen-sample.mjs && python3 -m http.server 4173
# open http://localhost:4173
```

Node-only evidence (no browser, no dependencies):

```bash
node bench/verify.mjs   # 18 assertions, measured values
node bench/bench.mjs    # 1 warmup + 7 samples + cold pass -> bench/result.json
```

Requires Node ≥ 20 (tested v24.19.0). No `npm install`, no build step, no headless browser.

## Evidence (real run, 2026-11-20)

| Measurement | Value |
|---|---|
| sample | torus 96×256, 24,576 vertices / 49,152 triangles, watertight (0 non-manifold edges) |
| partition | 1,679 meshlets, every triangle exactly once, 0 duplicates / 0 missing |
| caps | max 32 vertices, max 32 triangles |
| bounding sphere | max(vertex distance − radius) = 2.22e-16 |
| normal cone | max(cosCutoff − n·axis) = 0; max cone half-angle 29.700° |
| cone cull, 72 views | 39,829 cluster-culls, 1,148,603 triangle-tests avoided = **32.46%** |
| exact per-triangle cull, 72 views | 44.82% of triangle work |
| coverage of exact-cullable clusters | **73.12%** (39,829 / 54,471) |
| false culls | **0** (1,148,603 culled triangles rechecked; max n·view = −8.33e-3) |
| scale invariance | 1e-3 and 1e3: partition hash identical, 144/144 view decisions identical |
| determinism | rebuild hash identical (`3b84a0a9`) |
| tests | 120,888 cluster tests vs 3,538,944 triangle tests = **29.3× fewer** |
| time / pass (72 views) | cone median **9.479 ms** (min 9.053, p95 10.015, RSD 3.05%) |
| exact baseline / pass | median **142.985 ms** (min 139.087, p95 177.974, RSD **10.38%**) → **15.08×** |
| cold | first cone pass 19.939 ms; meshlet build 205.71 ms |

`exactBaseline` has RSD 10.38% (>10%) because it is 15× longer and absorbs host scheduling noise; it was not used to make the cone look faster. The cone pass RSD is 3.05%. Timings are host-specific; correctness numbers are deterministic.

## How the cull works

For each meshlet, store the AABB-centre bounding sphere and the narrowest cone around the average triangle normal that contains every triangle normal (`cosCutoff = min n·axis`). For a view `u = normalize(view − centre)`, the cluster is culled only if `axis·u ≤ −sin(θ + asin(r/d))` where `θ = acos(cosCutoff)`. That bound guarantees every normal in the cone, and every point in the sphere, faces away from the view. Cones ≥ 90° are never culled (the test would be unsound otherwise). The oracle does not use this formula at all: it re-tests every triangle of every culled cluster against the view.

## Known limits

- Backface culling only: no frustum, occlusion, or LOD. A closed surface tops out near 50% of triangles; this meshlet size reaches 32.46% (44.82% exact), so the cone leaves 11.4 points of cullable work on the table (73.12% coverage).
- Caps are absolute counts (32 verts / 32 tris). The cull predicates are dimensionless and the scale test covers 1e-3…1e3 only; beyond that, float precision of the mesh coordinates themselves degrades.
- The bounding sphere is AABB-centre + max distance, not minimal; a tighter sphere would cull slightly more.
- Tested on one procedural watertight torus, not on scanned or non-manifold assets. The partitioner assumes edge-adjacency; isolated triangles still get their own meshlet.
- Browser numbers are live counters, not a frame-rate claim: rendering a 49k-triangle mesh in three.js is not the bottleneck being measured.

## 本轮创新

首次把「法锥背面剔除」做成可独立复算的保守性证书：1679 个 meshlet、72 个视角下 0 个可见三角形被误剔，并给出对精确逐三角形基线的覆盖率 73.12% 与 29.3× 测试数缩减；台账中没有 meshlet / cone culling 项目（最近的是阴影时间区间与 LOD，二者都不做 GPU-driven 分簇剔除）。页面显示的剔除计数与 node 端 `bench/result.json` 同源同值。

## Project layout

```
index.html            importmap, three@0.170.0 pinned
main.js               render + orbit + live cull map (consumes core, does not re-derive)
src/core.mjs          partition, cone, oracle, scale/hash helpers (no three, no DOM)
tools/gen-sample.mjs  deterministic torus generator -> data/mesh.json
baseline/tri-backface.mjs  exact per-triangle baseline
bench/verify.mjs      18 assertions
bench/bench.mjs       warmup + 7 samples + cold -> bench/result.json
```

MIT licensed. Original work, no upstream repository.
