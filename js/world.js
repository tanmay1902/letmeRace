// Builds the 3D environment for a track: surfaces, barriers and scenery.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr, loadHDR, loadGLTF } from './assets.js';

// deterministic RNG so scenery is identical each visit
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------------------------------------------------------------- helpers
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Build strips along the track for every contiguous run where filter(i) is true.
// edge(i) returns [ax, ay, az, bx, by, bz]; u0/u1 are the u coords of each edge.
function strip(track, edge, { filter = () => true, vScale = 10, u0 = 0, u1 = 1 } = {}) {
  const { N, ds } = track;
  const runs = [];
  let all = true;
  for (let i = 0; i < N; i++) if (!filter(i)) { all = false; break; }
  if (all) runs.push([0, N]);
  else {
    let start = 0; while (filter(start)) start++;
    let inRun = false, rs = 0;
    for (let k = 1; k <= N; k++) {
      const i = (start + k) % N, f = filter(i);
      if (f && !inRun) { inRun = true; rs = start + k; }
      if ((!f || k === N) && inRun) { inRun = false; runs.push([rs, start + k + (f ? 1 : 0)]); }
    }
  }
  const geos = [];
  for (const [a, b] of runs) {
    const pos = [], uv = [], idx = [];
    for (let k = a; k <= b; k++) {
      const i = ((k % N) + N) % N;
      const e = edge(i);
      pos.push(e[0], e[1], e[2], e[3], e[4], e[5]);
      const v = (k * ds) / vScale;
      uv.push(u0, v, u1, v);
    }
    for (let k = 0; k < b - a; k++) {
      const p = k * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  if (!geos.length) return null;
  const g = geos.length > 1 ? mergeGeometries(geos) : geos[0];
  return g;
}
const flat = (track, la, lb, y) => (i) => {
  const { px, pz, nx, nz } = track;
  const A = typeof la === 'function' ? la(i) : la, B = typeof lb === 'function' ? lb(i) : lb;
  return [px[i] + nx[i] * A, y, pz[i] + nz[i] * A, px[i] + nx[i] * B, y, pz[i] + nz[i] * B];
};
const vert = (track, lat, y0, y1) => (i) => {
  const { px, pz, nx, nz } = track;
  const L = typeof lat === 'function' ? lat(i) : lat;
  const x = px[i] + nx[i] * L, z = pz[i] + nz[i] * L;
  return [x, y0, z, x, y1, z];
};
// ensure upward facing for flat strips
function faceUp(g) {
  const n = g.attributes.normal;
  if (n && n.getY(0) < 0) {
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}
function mesh(g, m, { cast = false, receive = true } = {}) {
  if (!g) return null;
  const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = receive; return o;
}

function clearOfTrack(track, x, z, r) {
  const loc = track.locate(x, z, null, {});
  const w = Math.max(track.wallL[loc.idx], track.wallR[loc.idx]);
  return Math.abs(loc.lat) > w + r;
}

// ---------------------------------------------------------------- main
export async function buildWorld(scene, renderer, track, quality) {
  const def = track.def, city = def.scenery === 'city', campus = def.scenery === 'campus';
  const R = rng(city ? 7 : campus ? 11 : 3);
  const root = new THREE.Group(); scene.add(root);
  const hw = track.halfWidth;

  // ---- sky & lighting
  const hdr = await loadHDR(def.hdri);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.background = hdr;
  scene.backgroundIntensity = city ? 0.9 : 1.0;
  scene.environmentIntensity = city ? 0.55 : 1.0;
  scene.fog = new THREE.Fog(city ? 0x4c4858 : 0xc3d3e3, city ? 350 : 400, city ? 2400 : 3800);

  const sunDir = new THREE.Vector3(...def.sunDir).normalize();
  const sun = new THREE.DirectionalLight(city ? 0xffb48a : 0xfff3e0, city ? 1.2 : 3.0);
  sun.position.copy(sunDir).multiplyScalar(300);
  sun.castShadow = quality.shadows;
  const sz = quality.shadowSize;
  sun.shadow.mapSize.set(sz, sz);
  const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(city ? 0x8f8cb0 : 0xbcd4ff, city ? 0x2a2420 : 0x4a5a2a, city ? 0.35 : 0.5);
  scene.add(hemi);

  // ---- bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // ---- materials (CC0 textures from Poly Haven)
  const [roadMat, groundMat, wallMat, gravelMat, paveMat] = await Promise.all([
    pbr(city ? 'clean_asphalt' : 'asphalt_track', 1.5, 1),
    city ? pbr('clean_asphalt', 600, 600, { color: 0x8a8a8a }) : pbr('aerial_grass_rock', 300, 300, { color: 0xb8c8a0 }),
    pbr('concrete_wall_004', 1, 1),
    pbr('gravel_floor_02', 2, 1),
    pbr('concrete_pavement', 1, 1),
  ]);
  roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -2; roadMat.polygonOffsetUnits = -2;
  roadMat.color.set(city ? 0x9a9a9a : 0xb0b0b0);
  roadMat.envMapIntensity = 0.6;
  gravelMat.polygonOffset = true; gravelMat.polygonOffsetFactor = -1; gravelMat.polygonOffsetUnits = -1;

  // ground
  const groundSize = 9000;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz); ground.receiveShadow = true;
  if (city) { ground.geometry = new THREE.PlaneGeometry(4000, 4000); ground.position.set(-140 + 2000, 0, cz); }
  root.add(ground);

  // road surface
  root.add(mesh(faceUp(strip(track, flat(track, hw, -hw, 0.02), { vScale: 12, u0: 0, u1: 1 })), roadMat));
  // white edge lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const s of [1, -1]) {
    root.add(mesh(faceUp(strip(track, flat(track, s * (hw - 0.15), s * (hw - 0.4), 0.025))), lineMat));
  }

  // kerbs
  if (def.kerbs) {
    const kerbTex = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#d01818'; g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#f2f2f2'; g.fillRect(0, h / 2, w, h / 2);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    });
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    for (const s of [1, -1]) {
      // slight bevel: inner edge flush, outer edge raised
      const g = strip(track, (i) => {
        const { px, pz, nx, nz } = track;
        const a = s * (hw - 0.25), b = s * (hw + 1.4);
        return [px[i] + nx[i] * a, 0.03, pz[i] + nz[i] * a, px[i] + nx[i] * b, 0.08, pz[i] + nz[i] * b];
      }, { filter: (i) => track.kerb[i], vScale: 3 });
      root.add(mesh(faceUp(g), kerbMat));
    }
  }
  // gravel traps
  if (def.gravel) {
    for (const s of [1, -1]) {
      const flag = s > 0 ? track.gravelL : track.gravelR;
      const g = strip(track, flat(track, s * (hw + 1.4), (i) => s * ((s > 0 ? track.wallL[i] : track.wallR[i]) - 0.2), 0.015),
        { filter: (i) => flag[i], vScale: 8 });
      root.add(mesh(faceUp(g), gravelMat));
    }
  }
  // run-off verge (darker grass) & sidewalks
  if (def.street) {
    paveMat.polygonOffset = true; paveMat.polygonOffsetFactor = -1;
    for (const s of [1, -1]) {
      const wl = (i) => s * ((s > 0 ? track.wallL[i] : track.wallR[i]) + 0.35);
      if (city) {
        const top = strip(track, flat(track, wl, (i) => wl(i) + s * 6.5, 0.16), { vScale: 4, u0: 0, u1: 1.6 });
        root.add(mesh(faceUp(top), paveMat));
      }
      // inner strip between road and barrier
      root.add(mesh(faceUp(strip(track, flat(track, s * hw, (i) => s * ((s > 0 ? track.wallL[i] : track.wallR[i])), 0.018), { vScale: 12 })), roadMat));
    }
  }

  // barriers
  const wallH = city ? 1.15 : 1.0;
  wallMat.color.set(city ? 0xd8d8d8 : 0xcfcfcf);
  for (const s of [1, -1]) {
    const W = (i) => s * (s > 0 ? track.wallL[i] : track.wallR[i]);
    const face = strip(track, vert(track, W, 0, wallH), { vScale: 4, u0: 0, u1: 0.3 });
    const back = strip(track, vert(track, (i) => W(i) + s * 0.35, 0, wallH), { vScale: 4, u0: 0, u1: 0.3 });
    const cap = strip(track, flat(track, W, (i) => W(i) + s * 0.35, wallH), { vScale: 4, u0: 0, u1: 0.1 });
    const m = new THREE.Mesh(mergeGeometries([face, back, faceUp(cap)]), wallMat);
    wallMat.side = THREE.DoubleSide;
    m.receiveShadow = true; m.castShadow = quality.shadows;
    root.add(m);
    // painted stripe on the wall face
    const stripeTex = canvasTex(16, 256, (g, w, h) => {
      for (let y = 0; y < h; y += 64) { g.fillStyle = city ? '#1e5bd8' : '#c81d25'; g.fillRect(0, y, w, 32); g.fillStyle = '#ffffff'; g.fillRect(0, y + 32, w, 32); }
    });
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const stripeG = strip(track, vert(track, (i) => W(i) - s * 0.01, 0.15, 0.45), { vScale: 16 });
    root.add(mesh(stripeG, stripeMat));
  }

  // debris fence
  {
    const fenceTex = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(200,200,200,0.9)'; g.lineWidth = 2;
      for (let k = -h; k < w + h; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
    });
    fenceTex.repeat.set(1, 1);
    const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4, depthWrite: true });
    const fh = city ? 3.2 : 2.8;
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, fh, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.4 });
    const posts = [];
    for (const s of [1, -1]) {
      const W = (i) => s * ((s > 0 ? track.wallL[i] : track.wallR[i]) + 0.2);
      const g = strip(track, vert(track, W, wallH, wallH + fh), { vScale: 1.6, u0: 0, u1: fh / 1.6 });
      root.add(mesh(g, fenceMat, { receive: false }));
      for (let i = 0; i < track.N; i += 4) posts.push([track.px[i] + track.nx[i] * W(i), track.pz[i] + track.nz[i] * W(i)]);
    }
    const pm = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    const mm = new THREE.Matrix4();
    posts.forEach((p, k) => { mm.makeTranslation(p[0], wallH + fh / 2, p[1]); pm.setMatrixAt(k, mm); });
    root.add(pm);
  }

  // tyre barriers (CC0 tyre model)
  if (def.gravel) {
    try {
      const gl = await loadGLTF('assets/models/old_tyre/old_tyre.gltf');
      let tm = null; gl.scene.traverse(o => { if (o.isMesh && !tm) tm = o; });
      const spots = [];
      for (const s of [1, -1]) {
        const flag = s > 0 ? track.tyreL : track.tyreR;
        let acc = 0;
        for (let i = 0; i < track.N; i++) {
          if (!flag[i]) continue;
          acc += track.ds;
          while (acc > 0.62) {
            acc -= 0.62;
            const W = (s > 0 ? track.wallL[i] : track.wallR[i]) - 0.32;
            spots.push([track.px[i] + track.nx[i] * W * s, track.pz[i] + track.nz[i] * W * s, track.heading[i]]);
          }
        }
      }
      const layers = 3, maxN = quality.tyres;
      const step = Math.max(1, Math.ceil(spots.length * layers / maxN));
      const used = spots.filter((_, k) => k % step === 0);
      const im = new THREE.InstancedMesh(tm.geometry, tm.material, used.length * layers);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      let n = 0;
      for (const [x, z, h] of used) for (let l = 0; l < layers; l++) {
        e.set(-Math.PI / 2, 0, h + R() * 3); q.setFromEuler(e);
        v.set(x, 0.083 + l * 0.165, z);
        m4.compose(v, q, one); im.setMatrixAt(n, m4);
        col.setHSL(0, 0, l === 1 ? 0.9 : 0.6 + R() * 0.2); im.setColorAt(n, col);
        n++;
      }
      im.receiveShadow = true;
      root.add(im);
    } catch (e) { console.warn('tyre model failed', e); }
  }

  // ---- start line, grid, gantry
  const startLine = (() => {
    const tex = canvasTex(64, 16, (g, w, h) => {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5'; g.fillRect(x * 8, y * 8, 8, 8); }
    });
    tex.repeat.set(hw * 2 / 1.6, 1); tex.magFilter = THREE.NearestFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6 }));
    const p = track.pointAt(0, 0);
    m.rotation.set(-Math.PI / 2, 0, p.heading); m.position.set(p.x, 0.03, p.z);
    return m;
  })();
  root.add(startLine);
  {
    const gm = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6 });
    for (let k = 0; k < 12; k++) {
      const s = -10 - k * 8, lat = k % 2 ? -3 : 3;
      const p = track.pointAt(s + 2.4, lat);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.2), gm);
      bar.rotation.set(-Math.PI / 2, 0, p.heading); bar.position.set(p.x, 0.03, p.z);
      root.add(bar);
    }
  }
  const gantry = buildGantry(track, hw, city);
  root.add(gantry.group);

  // ---- scenery
  const footprints = [];   // [x, z, r] to avoid overlaps
  const fits = (x, z, r) => footprints.every(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) > r + fr);

  // grandstands near the start/finish
  if (campus) await buildCampus(root, track, R, footprints, fits, quality, { minX, maxX, minZ, maxZ, cx, cz });
  const standSpecs = city ? [[30, 1, 90], [140, -1, 80]] : campus ? [[15, 1, 60], [15, -1, 60], [-120, 1, 50], [-120, -1, 50]] : [[40, 1, 100], [160, 1, 100], [-140, 1, 90], [420, 1, 80]];
  for (const [s0, side, len] of standSpecs) {
    const idx = Math.round(((s0 + len / 2) % track.length + track.length) % track.length / track.ds) % track.N;
    const wall = side > 0 ? track.wallL[idx] : track.wallR[idx];
    const offs = wall + (def.street ? 7.5 : 5) + 6;
    const mid = track.pointAt(s0 + len / 2, side * offs);
    let ok = true;
    for (let t = 0; t <= len; t += 10) { const p = track.pointAt(s0 + t, side * offs); if (!clearOfTrack(track, p.x, p.z, 4)) ok = false; }
    if (!ok) continue;
    if (campus) { let clash = false; for (let t = 0; t <= len; t += 10) { const p = track.pointAt(s0 + t, side * offs); if (!fits(p.x, p.z, 9)) clash = true; } if (clash) continue; }
    const gs = buildGrandstand(len, R);
    gs.position.set(mid.x, 0, mid.z);
    gs.rotation.y = mid.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    root.add(gs);
    for (let t = 0; t <= len; t += 12) { const p = track.pointAt(s0 + t, side * offs); footprints.push([p.x, p.z, 10]); }
  }

  // billboards
  const brands = ['APEX OIL', 'VELOCE', 'NORTHWIND', 'HELIX TYRES', 'RACE3D', 'KINETIC', 'SOLARIS', 'TITAN BRAKES'];
  const brandColors = ['#e53935', '#1e88e5', '#00897b', '#f9a825', '#6a1b9a', '#212121', '#ef6c00', '#2e7d32'];
  for (let k = 0, s = 30; s < track.length - 50; s += city ? 140 : 190, k++) {
    const i = Math.round(s / track.ds) % track.N;
    if (Math.abs(track.curv[i]) > 1 / 300) continue;
    const side = k % 2 ? 1 : -1;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const p = track.pointAt(s, side * (wall + 1.2));
    if (!clearOfTrack(track, p.x, p.z, 0.5) || !fits(p.x, p.z, 4)) continue;
    const bi = k % brands.length;
    const bb = buildBillboard(brands[bi], brandColors[bi]);
    bb.position.set(p.x, 0, p.z);
    bb.rotation.y = p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    root.add(bb);
    footprints.push([p.x, p.z, 4]);
  }

  if (city) await buildCity(root, track, R, footprints, fits, quality, { minX, maxX, minZ, maxZ, hdr });
  else if (!campus) buildCountryside(root, track, R, footprints, fits, quality, { minX, maxX, minZ, maxZ, cx, cz });

  return {
    sun, root, gantry,
    updateSun(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDir, 300);
    },
  };
}

// ---------------------------------------------------------------- gantry
function buildGantry(track, hw, city) {
  const g = new THREE.Group();
  const p = track.pointAt(-0.5, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.35 });
  const span = Math.min(hw + 2.5, Math.min(track.wallL[0], track.wallR[0]) + 0.6);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), metal);
    post.position.set(s * span, 3.75, 0); post.castShadow = true; g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.9, 0.7), metal);
  beam.position.set(0, 7.1, 0); beam.castShadow = true; g.add(beam);
  const board = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }));
  board.position.set(0, 6.1, 0.3); g.add(board);
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff0000, emissiveIntensity: 0, roughness: 0.3 });
    for (let r = 0; r < 2; r++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), mat);
      l.position.set((k - 2) * 0.85, 6.45 - r * 0.6, 0.51);
      g.add(l);
    }
    lights.push(mat);
  }
  g.position.set(p.x, 0, p.z); g.rotation.y = p.heading + Math.PI;
  return {
    group: g,
    set(n, green = false) {
      lights.forEach((m, k) => {
        const on = green || k < n;
        m.emissive.set(green ? 0x00ff40 : 0xff0000);
        m.emissiveIntensity = on ? 6 : 0;
        m.color.set(on ? (green ? 0x00ff40 : 0xff2020) : 0x200000);
      });
    },
  };
}

// ---------------------------------------------------------------- grandstand
function buildGrandstand(len, R) {
  const g = new THREE.Group();
  const rows = 12, rowD = 0.85, rowH = 0.5, base = 2.5;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85 });
  const seatsMat = new THREE.MeshStandardMaterial({ color: 0x1c4fa0, roughness: 0.6 });
  const geos = [], seatGeos = [];
  const depth = rows * rowD;
  const baseG = new THREE.BoxGeometry(len, base, depth + 1); baseG.translate(0, base / 2, depth / 2 - 0.5); geos.push(baseG);
  for (let r = 0; r < rows; r++) {
    const b = new THREE.BoxGeometry(len, rowH, rowD); b.translate(0, base + r * rowH + rowH / 2, r * rowD + rowD / 2); geos.push(b);
    const sg = new THREE.BoxGeometry(len - 1, 0.25, 0.4); sg.translate(0, base + r * rowH + rowH + 0.12, r * rowD + rowD * 0.65); seatGeos.push(sg);
  }
  const back = new THREE.BoxGeometry(len, base + rows * rowH + 4, 0.4); back.translate(0, (base + rows * rowH + 4) / 2, depth + 0.2); geos.push(back);
  const body = new THREE.Mesh(mergeGeometries(geos), concrete); body.castShadow = true; body.receiveShadow = true; g.add(body);
  const seats = new THREE.Mesh(mergeGeometries(seatGeos), seatsMat); seats.receiveShadow = true; g.add(seats);
  // roof
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.5 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, depth + 3), roofMat);
  roof.position.set(0, base + rows * rowH + 4.2, depth / 2 - 0.5); roof.rotation.x = -0.08; roof.castShadow = true; g.add(roof);
  for (let x = -len / 2; x <= len / 2; x += 12) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, base + rows * rowH + 4.2, 8), roofMat);
    col.position.set(x, (base + rows * rowH + 4.2) / 2, depth + 0.5); g.add(col);
  }
  // crowd
  const per = Math.floor(len / 0.65);
  const crowdGeo = new THREE.BoxGeometry(0.42, 0.75, 0.3);
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), rows * per);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  let n = 0;
  for (let r = 0; r < rows; r++) for (let k = 0; k < per; k++) {
    if (R() < 0.12) continue;
    m.makeTranslation(-len / 2 + 0.4 + k * 0.65 + (R() - 0.5) * 0.15, base + r * rowH + rowH + 0.5, r * rowD + rowD * 0.5);
    crowd.setMatrixAt(n, m);
    c.setHSL(R(), 0.5 + R() * 0.4, 0.3 + R() * 0.4); crowd.setColorAt(n, c);
    n++;
  }
  crowd.count = n;
  g.add(crowd);
  return g;
}

function buildBillboard(text, color) {
  const g = new THREE.Group();
  const tex = canvasTex(512, 128, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 78px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 4);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }));
  face.position.set(0, 5, 0.06);
  const back = new THREE.Mesh(new THREE.BoxGeometry(12.2, 3.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  back.position.set(0, 5, 0);
  g.add(face, back);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6 }));
    leg.position.set(s * 5, 1.75, -0.1); g.add(leg);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------------------------------------------------------------- countryside
function buildCountryside(root, track, R, footprints, fits, quality, b) {
  // pit building alongside the main straight (inside)
  {
    const s0 = 40, len = 240;
    const i = Math.round((s0 + len / 2) / track.ds);
    const off = track.wallR[i] + 12;
    const mid = track.pointAt(s0 + len / 2, -off);
    let ok = true;
    for (let t = 0; t <= len; t += 10) { const p = track.pointAt(s0 + t, -off); if (!clearOfTrack(track, p.x, p.z, 8)) ok = false; }
    if (ok) {
      const g = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x0d2333, roughness: 0.05, metalness: 0.9 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.7 });
      const lower = new THREE.Mesh(new THREE.BoxGeometry(len, 5, 16), white); lower.position.y = 2.5;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 14), glass); upper.position.set(0, 7, 1);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.6, 17), white); roof.position.set(0, 9.3, 0.5);
      g.add(lower, upper, roof);
      for (let x = -len / 2 + 6; x < len / 2 - 4; x += 12) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 0.2), dark); door.position.set(x, 2.1, -8.05); g.add(door);
      }
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(mid.x, 0, mid.z); g.rotation.y = mid.heading - Math.PI / 2;
      root.add(g);
      for (let t = 0; t <= len; t += 12) { const p = track.pointAt(s0 + t, -off); footprints.push([p.x, p.z, 12]); }
    }
  }

  plantTrees(root, track, R, fits, quality, b, { count: quality.trees, pad: 260 });
  buildHills(root, R, b.cx, b.cz, 1500);

  // marshal posts / tv towers scattered along circuit
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  for (let s0 = 300; s0 < track.length; s0 += 520) {
    const i = Math.round(s0 / track.ds) % track.N;
    const side = track.curv[i] > 0 ? -1 : 1;
    const w = (side > 0 ? track.wallL[i] : track.wallR[i]) + 4;
    const p = track.pointAt(s0, side * w);
    if (!clearOfTrack(track, p.x, p.z, 2) || !fits(p.x, p.z, 3)) continue;
    const tw = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), towerMat); leg.position.y = 4;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.4), towerMat); cab.position.y = 9;
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.8, 2.45), new THREE.MeshStandardMaterial({ color: 0x102030, metalness: 0.8, roughness: 0.1 })); win.position.y = 9.3;
    tw.add(leg, cab, win); tw.position.set(p.x, 0, p.z);
    tw.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(tw);
  }
}


// ---------------------------------------------------------------- shared vegetation / terrain
function plantTrees(root, track, R, fits, quality, b, opts) {
  // trees (instanced)
  const nTrees = opts.count;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const pineGeo = new THREE.ConeGeometry(1, 1, 8, 3); pineGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  jitter(pineGeo, R, 0.12); jitter(leafGeo, R, 0.18);
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, nTrees);
  const pines = new THREE.InstancedMesh(pineGeo, leafMat, nTrees);
  const leafs = new THREE.InstancedMesh(leafGeo, leafMat, nTrees);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let nt = 0, np = 0, nl = 0, tries = 0;
  const pad = opts.pad;
  while (nt < nTrees && tries < nTrees * 8) {
    tries++;
    const x = b.minX - pad + R() * (b.maxX - b.minX + pad * 2);
    const z = b.minZ - pad + R() * (b.maxZ - b.minZ + pad * 2);
    if (!clearOfTrack(track, x, z, (opts.trackGap ?? 6) + R() * 10) || !fits(x, z, 3)) continue;
    if (opts.accept && !opts.accept(x, z, R)) continue;
    const h = (opts.minH ?? 7) + R() * 10;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
    const pine = R() < 0.55;
    m.compose(v.set(x, 0, z), q, s.set(1, pine ? h * 0.35 : h * 0.45, 1)); trunks.setMatrixAt(nt++, m);
    if (pine) {
      m.compose(v.set(x, h * 0.2, z), q, s.set(h * 0.28, h * 0.9, h * 0.28)); pines.setMatrixAt(np, m);
      c.setHSL(0.3 + R() * 0.06, 0.45, 0.16 + R() * 0.08); pines.setColorAt(np++, c);
    } else {
      const r = h * 0.32;
      m.compose(v.set(x, h * 0.45 + r * 0.7, z), q, s.set(r, r * 0.9, r)); leafs.setMatrixAt(nl, m);
      c.setHSL(0.22 + R() * 0.08, 0.45, 0.2 + R() * 0.1); leafs.setColorAt(nl++, c);
    }
  }
  trunks.count = nt; pines.count = np; leafs.count = nl;
  for (const o of [trunks, pines, leafs]) { o.castShadow = quality.shadows; o.receiveShadow = true; root.add(o); }

}

function buildHills(root, R, cx, cz, minDist) {
  // distant hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x5f7356, roughness: 1, flatShading: true });
  const hillGeos = [];
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2 + R() * 0.1;
    const dist = minDist + R() * 900, h = 120 + R() * 380, w = 300 + R() * 500;
    const g = new THREE.ConeGeometry(w, h, 10, 4);
    jitter(g, R, 0.08);
    g.translate(cx + Math.cos(a) * dist, h / 2 - 5, cz + Math.sin(a) * dist);
    hillGeos.push(g.toNonIndexed());
  }
  const hills = new THREE.Mesh(mergeGeometries(hillGeos), hillMat);
  root.add(hills);

}

function jitter(geo, R, amt) {
  const p = geo.attributes.position;
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const offs = new Map();
  for (let k = 0; k < p.count; k++) {
    const kk = key(p.getX(k), p.getY(k), p.getZ(k));
    if (!offs.has(kk)) offs.set(kk, [(R() - 0.5) * amt, (R() - 0.5) * amt, (R() - 0.5) * amt]);
    const o = offs.get(kk);
    p.setXYZ(k, p.getX(k) + o[0], p.getY(k) + o[1], p.getZ(k) + o[2]);
  }
  geo.computeVertexNormals();
}

// ---------------------------------------------------------------- city
async function buildCity(root, track, R, footprints, fits, quality, b) {
  // facade materials (CC0) + procedural lit-window emissive layer
  const winTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const n = 8, cw = w / n, ch = h / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (x === 0 && y === 0) continue;               // keep corner dark (roofs sample it)
      const r = Math.random();
      if (r < 0.42) {
        const warm = Math.random() < 0.75;
        g.fillStyle = warm ? `hsl(${35 + Math.random() * 15},90%,${55 + Math.random() * 25}%)` : `hsl(200,60%,${60 + Math.random() * 20}%)`;
        g.fillRect(x * cw + 4, y * ch + 5, cw - 8, ch - 9);
      }
    }
  });
  const [facadeA, facadeB, brick] = await Promise.all([
    pbr('rectangular_facade_tiles', 1, 1),
    pbr('concrete_tile_facade', 1, 1),
    pbr('brick_wall_001', 1, 1),
  ]);
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a3a, metalness: 0.9, roughness: 0.12 });
  const mats = [
    { mat: facadeA, tile: 6 }, { mat: facadeB, tile: 5 }, { mat: brick, tile: 3 }, { mat: glass, tile: 12 },
  ];
  for (const mm of mats) {
    const t = winTex.clone(); t.channel = 1; t.needsUpdate = true;
    mm.mat.emissiveMap = t; mm.mat.emissive = new THREE.Color(0xffffff); mm.mat.emissiveIntensity = mm.mat === glass ? 0.9 : 0.55;
    mm.geos = [];
  }

  function addBuilding(x, z, rot, w, d, h, kind) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, uv1 = new Float32Array(uv.count * 2);
    const tile = mats[kind].tile, win = 25.6;
    // faces: px, nx, py, ny, pz, nz (4 verts each)
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const vi = f * 4 + k, u = uv.getX(vi), v = uv.getY(vi);
        uv.setXY(vi, u * dims[f][0] / tile, v * dims[f][1] / tile);
        const roofish = f === 2 || f === 3;
        uv1[vi * 2] = roofish ? 0.01 : u * dims[f][0] / win + 0.125;
        uv1[vi * 2 + 1] = roofish ? 0.99 : v * (dims[f][1] - 4) / win + 0.125;
      }
    }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    g.rotateY(rot); g.translate(x, h / 2, z);
    mats[kind].geos.push(g);
    // rooftop details
    if (h > 25 && R() < 0.6) {
      const r = new THREE.BoxGeometry(w * 0.4, 3, d * 0.4);
      const ruv1 = new Float32Array(r.attributes.uv.count * 2).fill(0.01);
      r.setAttribute('uv1', new THREE.BufferAttribute(ruv1, 2));
      r.rotateY(rot); r.translate(x, h + 1.5, z);
      mats[1].geos.push(r);
    }
  }

  // buildings lining the circuit
  for (const side of [1, -1]) {
    let s = R() * 10;
    while (s < track.length) {
      const w = 18 + R() * 16, d = 16 + R() * 14;
      const i = Math.round(s / track.ds) % track.N;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const lat = side * (wall + 7.5 + d / 2);
      const p = track.pointAt(s, lat);
      const r = Math.hypot(w, d) / 2;
      if (clearOfTrack(track, p.x, p.z, r * 0.75 + 2) && fits(p.x, p.z, r * 0.75) && p.x > -140) {
        const h = 12 + Math.pow(R(), 1.8) * 75;
        const kind = h > 45 ? (R() < 0.6 ? 3 : 0) : h < 20 ? 2 : Math.floor(R() * 3);
        addBuilding(p.x, p.z, p.heading, w, d, h, kind);
        footprints.push([p.x, p.z, r * 0.75]);
      }
      s += w + 1 + R() * 4;
    }
  }
  // inner and outer blocks
  for (let k = 0; k < 900; k++) {
    const x = b.minX - 300 + R() * (b.maxX - b.minX + 600);
    const z = b.minZ - 300 + R() * (b.maxZ - b.minZ + 600);
    if (x < -140) continue;
    const w = 20 + R() * 25, d = 20 + R() * 25, r = Math.hypot(w, d) / 2;
    if (!clearOfTrack(track, x, z, r + 9) || !fits(x, z, r * 0.8)) continue;
    const far = Math.hypot(x - (b.minX + b.maxX) / 2, z - (b.minZ + b.maxZ) / 2);
    const h = 15 + Math.pow(R(), 1.5) * (far > 500 ? 60 : 110);
    addBuilding(x, z, 0, w, d, h, h > 50 ? 3 : Math.floor(R() * 3));
    footprints.push([x, z, r * 0.8]);
  }
  for (const mm of mats) {
    if (!mm.geos.length) continue;
    const merged = new THREE.Mesh(mergeGeometries(mm.geos), mm.mat);
    merged.castShadow = quality.shadows; merged.receiveShadow = true;
    root.add(merged);
  }

  // harbour water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 4000),
    new THREE.MeshStandardMaterial({ color: 0x0b1e2b, metalness: 0.95, roughness: 0.08 }));
  water.rotation.x = -Math.PI / 2; water.position.set(-140 - 1500, -1.2, (b.minZ + b.maxZ) / 2);
  root.add(water);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 4000), new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9 }));
  quay.position.set(-141, -0.6, (b.minZ + b.maxZ) / 2); root.add(quay);
  // a few moored boats
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  for (let k = 0; k < 14; k++) {
    const boat = new THREE.Group();
    const L = 10 + R() * 18;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3 + L * 0.12, 1.6, L), hullMat); hull.position.y = -0.4;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, L * 0.4), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.6, roughness: 0.2 })); cab.position.set(0, 0.9, -L * 0.1);
    boat.add(hull, cab);
    boat.position.set(-160 - R() * 120, 0, b.minZ - 100 + R() * (b.maxZ - b.minZ + 200));
    boat.rotation.y = (R() - 0.5) * 0.4;
    root.add(boat);
  }

  // street lamps (CC0 model) + light pools on the road
  try {
    const gl = await loadGLTF('assets/models/street_lamp_01/street_lamp_01.gltf');
    const parts = [];
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse(o => {
      if (!o.isMesh) return;
      const mat = o.material;
      if (/glass|bulb/i.test(mat.name)) { mat.emissive = new THREE.Color(0xffc070); mat.emissiveIntensity = /bulb/i.test(mat.name) ? 8 : 2.5; }
      parts.push(o);
    });
    const spots = [];
    let k = 0;
    for (let s = 10; s < track.length; s += 34, k++) {
      const side = k % 2 ? 1 : -1;
      const i = Math.round(s / track.ds) % track.N;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const p = track.pointAt(s, side * (wall + 1.4));
      if (!clearOfTrack(track, p.x, p.z, 0.8)) continue;
      const pool = track.pointAt(s, side * (wall - 2.5));
      spots.push([p.x, p.z, p.heading, side, pool.x, pool.z]);
    }
    const scale = 1.6;
    const m4 = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
      spots.forEach(([x, z, h], n) => {
        m4.makeRotationY(h).premultiply(tmp.makeTranslation(x, 0.16, z)).multiply(tmp.makeScale(scale, scale, scale)).multiply(part.matrixWorld);
        im.setMatrixAt(n, m4);
      });
      im.castShadow = quality.shadows;
      root.add(im);
    }
    const poolTex = canvasTex(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,200,130,0.9)'); grd.addColorStop(0.5, 'rgba(255,170,90,0.35)'); grd.addColorStop(1, 'rgba(255,150,80,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -8 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), poolMat, spots.length);
    spots.forEach(([, , , , px, pz], n) => { m4.makeTranslation(px, 0.05, pz); pools.setMatrixAt(n, m4); });
    pools.renderOrder = 2;
    root.add(pools);
  } catch (e) { console.warn('lamp model failed', e); }
}

// ---------------------------------------------------------------- IISER Mohali campus (OpenStreetMap data)
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function polyline(lines, width, y, mat, vScale = 6) {
  const geos = [];
  for (const pts of lines) {
    if (pts.length < 2) continue;
    const pos = [], uv = [], idx = [];
    let acc = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = tz * width / 2, nz = -tx * width / 2;
      if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      pos.push(pts[k][0] + nx, y, pts[k][1] + nz, pts[k][0] - nx, y, pts[k][1] - nz);
      uv.push(0, acc / vScale, width / vScale, acc / vScale);
      if (k) { const q = (k - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    geos.push(faceUp(g));
  }
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true;
  return m;
}
function labelSprite(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = sub ? 144 : 104;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,18,28,0.82)';
  g.beginPath(); g.roundRect(4, 4, 504, c.height - 8, 18); g.fill();
  g.fillStyle = '#e10600'; g.fillRect(4, 4, 12, c.height - 8);
  g.fillStyle = '#fff'; g.font = 'bold 50px Arial'; g.textBaseline = 'middle';
  let fs = 50; while (g.measureText(text).width > 470 && fs > 26) { fs -= 2; g.font = `bold ${fs}px Arial`; }
  g.fillText(text, 30, sub ? 52 : c.height / 2);
  if (sub) { g.fillStyle = '#9aa4af'; g.font = '30px Arial'; g.fillText(sub, 30, 108); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, fog: false }));
  sp.scale.set(16, 16 * c.height / 512, 1);
  return sp;
}

async function buildCampus(root, track, R, footprints, fits, quality, b) {
  const C = track.def.campus;
  const [brick, facade, facadeB, pave, asphalt] = await Promise.all([
    pbr('brick_wall_001', 1 / 3, 1 / 3, { color: 0xd9a58a }),
    pbr('concrete_tile_facade', 1 / 5, 1 / 5, { color: 0xf0e6d8 }),
    pbr('rectangular_facade_tiles', 1 / 6, 1 / 6),
    pbr('concrete_pavement', 1, 1),
    pbr('clean_asphalt', 1, 1, { color: 0x8c8c8c }),
  ]);
  asphalt.polygonOffset = true; asphalt.polygonOffsetFactor = -1; asphalt.polygonOffsetUnits = -1;
  pave.polygonOffset = true; pave.polygonOffsetFactor = -1; pave.polygonOffsetUnits = -1;
  pave.color.set(0xd8d0c4);

  // other campus roads & footpaths (they run under the barriers like a real street circuit)
  const roads = C.roads.map((r) => r.pts);
  const rm = polyline(roads, 7, 0.012, asphalt, 8); if (rm) root.add(rm);
  const pm = polyline(C.paths, 2.4, 0.01, pave, 3); if (pm) root.add(pm);

  // sports pitches
  const pitchMat = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 });
  const courtMat = new THREE.MeshStandardMaterial({ color: 0x9a4a3a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  for (const pt of C.pitches) {
    const shape = new THREE.Shape(pt.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, 0.02, 0);
    const big = Math.abs(THREE.ShapeUtils.area(shape.getPoints())) > 2500;
    root.add(mesh(g, big ? pitchMat : courtMat));
    const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pt.poly.map(([x, z]) => new THREE.Vector3(x, 0.05, z))), lineMat);
    root.add(ln);
  }

  // buildings from OSM footprints, extruded; shrunk if they would intrude on the circuit
  const mats = { hostel: brick, academic: facade, misc: facadeB };
  const geos = { hostel: [], academic: [], misc: [] };
  const roofGeos = [];
  const labels = [];
  for (const bd of C.buildings) {
    let poly = bd.poly.slice();
    let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x; cz += z; } cx /= poly.length; cz /= poly.length;
    const clear = (pp) => pp.every(([x, z], i) => {
      const [x2, z2] = pp[(i + 1) % pp.length];
      return clearOfTrack(track, x, z, 2) && clearOfTrack(track, (x + x2) / 2, (z + z2) / 2, 2);
    });
    let ok = clear(poly);
    for (let k = 0; k < 6 && !ok; k++) {
      poly = poly.map(([x, z]) => [cx + (x - cx) * 0.85, cz + (z - cz) * 0.85]);
      ok = clear(poly);
    }
    if (!ok) continue;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: bd.h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    geos[bd.kind].push(g);
    const roof = new THREE.ShapeGeometry(shape); roof.rotateX(-Math.PI / 2); roof.translate(0, bd.h + 0.05, 0);
    roofGeos.push(roof);
    let r = 0; for (const [x, z] of poly) r = Math.max(r, Math.hypot(x - cx, z - cz));
    footprints.push([cx, cz, r * 0.9]);
    bd._poly = poly;
    if (bd.name) labels.push({ name: bd.name.replace('IISER Mohali ', '').replace(' - Central Analytical Facility', ' (Central Analytical Facility)'), x: cx, z: cz, h: bd.h });
  }
  for (const k of Object.keys(geos)) {
    if (!geos[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos[k]), mats[k]);
    m.castShadow = quality.shadows; m.receiveShadow = true; root.add(m);
  }
  if (roofGeos.length) {
    const roofs = new THREE.Mesh(mergeGeometries(roofGeos), new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.9 }));
    roofs.receiveShadow = true; root.add(roofs);
  }
  for (const l of labels) {
    const sp = labelSprite(l.name, 'IISER Mohali');
    sp.position.set(l.x, l.h + 6, l.z);
    root.add(sp);
  }
  track.landmarks = labels.map((l) => ({ name: l.name, x: l.x, z: l.z }));

  // boundary wall (skipped where the circuit passes)
  const bw = [];
  const B = C.boundary;
  for (let i = 0; i < B.length; i++) {
    const a = B[i], c = B[(i + 1) % B.length];
    const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 4));
    for (let k = 0; k < n; k++) {
      const x0 = a[0] + (c[0] - a[0]) * k / n, z0 = a[1] + (c[1] - a[1]) * k / n;
      const x1 = a[0] + (c[0] - a[0]) * (k + 1) / n, z1 = a[1] + (c[1] - a[1]) * (k + 1) / n;
      if (!clearOfTrack(track, (x0 + x1) / 2, (z0 + z1) / 2, 3)) continue;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len + 0.05, 2.2, 0.35);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, 1.1, (z0 + z1) / 2);
      bw.push(g);
    }
  }
  if (bw.length) {
    const wall = new THREE.Mesh(mergeGeometries(bw), brick);
    wall.castShadow = quality.shadows; wall.receiveShadow = true; root.add(wall);
  }

  // entrance sign near the main gate
  {
    const [gx, gz] = C.gate;
    const loc = track.locate(gx, gz, null, {});
    const side = loc.lat >= 0 ? 1 : -1;
    const w = (side > 0 ? track.wallL[loc.idx] : track.wallR[loc.idx]) + 9;
    const p = track.pointAt(loc.s, side * w);
    if (clearOfTrack(track, p.x, p.z, 4)) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 200;
      const g = c.getContext('2d');
      g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 1024, 200);
      g.fillStyle = '#7a1f1f'; g.font = 'bold 86px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('IISER MOHALI', 512, 82);
      g.fillStyle = '#333'; g.font = '34px Georgia, serif'; g.fillText('Knowledge City · Sector 81', 512, 160);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 1.2), brick); base.position.y = 2;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.7), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      face.position.set(0, 2.1, 0.61);
      sign.add(base, face);
      sign.position.set(p.x, 0, p.z);
      sign.rotation.y = p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      sign.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(sign);
      footprints.push([p.x, p.z, 9]);
    }
  }

  // trees: lots of them (green campus), denser in the Eco Park, none on pitches or in buildings
  const parks = C.parks.map((p) => p.poly);
  const pitches = C.pitches.map((p) => p.poly);
  const builtPolys = C.buildings.filter((bd) => bd._poly).map((bd) => bd._poly);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of B) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const nearRoad = (x, z) => roads.some((pts) => pts.some(([px, pz]) => Math.abs(px - x) < 6 && Math.abs(pz - z) < 6));
  plantTrees(root, track, R, fits, quality, { minX, maxX, minZ, maxZ }, {
    count: Math.round(quality.trees * 1.1), pad: 180, trackGap: 3, minH: 6,
    accept: (x, z, rnd) => {
      if (pitches.some((p) => pointInPoly(x, z, p))) return false;
      if (builtPolys.some((p) => pointInPoly(x, z, p))) return false;
      if (nearRoad(x, z)) return false;
      if (parks.some((p) => pointInPoly(x, z, p))) return true;
      return rnd() < (pointInPoly(x, z, B) ? 0.55 : 0.35);
    },
  });
  // Shivalik foothills to the north-east, flat plains elsewhere
  buildHills(root, R, b.cx, b.cz, 1800);
}
