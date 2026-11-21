// Procedural modern open-wheel race car model (original design).
// Local space: +z forward, +x left, +y up. Origin at ground under CG.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './physics.js';

let shared = null;
function sharedMats() {
  if (shared) return shared;
  // carbon weave texture
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = ((x + y) % 2) ? 26 : 16;
    g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(x * 8, y * 8, 8, 8);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x * 8, y * 8, ((x + y) % 2) ? 8 : 2, ((x + y) % 2) ? 2 : 8);
  }
  const weave = new THREE.CanvasTexture(c); weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(6, 6);
  weave.colorSpace = THREE.SRGBColorSpace;
  shared = {
    carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: weave, roughness: 0.38, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92, metalness: 0 }),
    tread: new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.75, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.3, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.7 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.9, clearcoat: 1 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x331a10, roughness: 0.6, emissive: 0xff3300, emissiveIntensity: 0 }),
    light: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.4 }),
  };
  return shared;
}

const compounds = { soft: 0xe0262d, medium: 0xf5d020, hard: 0xf2f2f2 };

export function createCarModel(livery, opts = {}) {
  const M = sharedMats();
  const paint = new THREE.MeshPhysicalMaterial({ color: livery.primary, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 });
  const accent = new THREE.MeshPhysicalMaterial({ color: livery.accent, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: livery.helmet ?? livery.accent, roughness: 0.25, clearcoat: 1 });

  const buckets = new Map();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
  function add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    tmpE.set(rot[0], rot[1], rot[2]); tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(...pos), tmpQ, new THREE.Vector3(...scl));
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(tmpM);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  }
  function link(a, b, r, mat) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const geo = new THREE.CylinderGeometry(r, r, len, 6);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    add(geo, mat, mid.toArray(), [e.x, e.y, e.z]);
  }

  const zf = CAR.a, zr = -CAR.b;   // axle positions
  // ---- floor & plank
  add(new THREE.BoxGeometry(1.55, 0.04, 3.0), M.carbon, [0, 0.07, -0.2]);
  add(new THREE.BoxGeometry(0.9, 0.04, 0.9), M.carbon, [0, 0.07, 1.4]);
  // floor edge fences
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.1, 1.2), M.carbon, [s * 0.77, 0.12, 0.45]);
  // ---- survival cell
  add(new RoundedBoxGeometry(0.78, 0.5, 2.1, 3, 0.12), paint, [0, 0.42, 0.45]);
  // cockpit rim
  add(new THREE.TorusGeometry(0.3, 0.035, 6, 20), M.carbon, [0, 0.69, 0.0], [Math.PI / 2, 0, 0], [1, 1.6, 1]);
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 20), M.dark, [0, 0.675, 0.0], [0, 0, 0], [1, 1, 1.55]);
  // carbon panel on top of the chassis ahead of the driver (cuts glare in the cockpit view)
  add(new THREE.BoxGeometry(0.46, 0.012, 0.95), M.carbon, [0, 0.672, 0.92]);
  // T-cam pod on the airbox
  add(new RoundedBoxGeometry(0.1, 0.06, 0.2, 2, 0.02), accent, [0, 1.09, -0.62]);
  // ---- nose
  {
    const g = new THREE.CylinderGeometry(0.08, 0.3, 1.75, 16, 1);
    g.scale(1, 1, 0.55);
    add(g, paint, [0, 0.36, 2.25], [Math.PI / 2 + 0.07, 0, 0]);
    add(new THREE.SphereGeometry(0.08, 10, 8), accent, [0, 0.3, 3.12], [0, 0, 0], [1, 0.55, 1]);
  }
  // nose pylons to front wing
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.2, 0.3), M.carbon, [s * 0.1, 0.2, 2.75]);
  // ---- front wing
  add(new THREE.BoxGeometry(1.95, 0.025, 0.42), M.carbon, [0, 0.1, 2.95], [-0.05, 0, 0]);
  for (let k = 0; k < 3; k++) {
    add(new THREE.BoxGeometry(1.8 - k * 0.15, 0.02, 0.17), k === 2 ? accent : paint,
      [0, 0.15 + k * 0.055, 2.86 - k * 0.11], [-0.35 - k * 0.15, 0, 0]);
  }
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.025, 0.28, 0.62), accent, [s * 0.98, 0.2, 2.9]);
    add(new THREE.BoxGeometry(0.22, 0.02, 0.4), M.carbon, [s * 0.86, 0.32, 2.88], [-0.25, 0, 0]);
  }
  // ---- sidepods
  for (const s of [-1, 1]) {
    add(new RoundedBoxGeometry(0.5, 0.42, 1.55, 3, 0.14), paint, [s * 0.58, 0.36, -0.05]);
    add(new RoundedBoxGeometry(0.42, 0.3, 0.6, 2, 0.1), paint, [s * 0.5, 0.31, -1.0], [0, s * 0.18, 0]);
    add(new THREE.BoxGeometry(0.36, 0.26, 0.05), M.dark, [s * 0.6, 0.39, 0.73]);   // intake
    add(new THREE.BoxGeometry(0.04, 0.42, 1.1), accent, [s * 0.84, 0.36, -0.05]);   // flank stripe
    // mirrors
    link([s * 0.36, 0.62, 0.55], [s * 0.5, 0.72, 0.6], 0.012, M.carbon);
    add(new RoundedBoxGeometry(0.16, 0.07, 0.04, 2, 0.015), paint, [s * 0.52, 0.73, 0.6]);
    // bargeboards
    add(new THREE.BoxGeometry(0.02, 0.3, 0.5), M.carbon, [s * 0.72, 0.25, 0.9], [0, s * 0.15, 0]);
  }
  // ---- engine cover / airbox
  {
    const g = new THREE.CylinderGeometry(0.05, 0.34, 1.9, 16, 1);
    g.scale(1, 1, 1.3);
    add(g, paint, [0, 0.55, -1.15], [-Math.PI / 2 + 0.12, 0, 0]);
  }
  add(new RoundedBoxGeometry(0.32, 0.42, 0.7, 3, 0.1), paint, [0, 0.85, -0.55]);
  add(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16), M.dark, [0, 0.93, -0.18], [Math.PI / 2, 0, 0], [1, 1, 1.25]);
  add(new THREE.BoxGeometry(0.015, 0.33, 1.25), accent, [0, 0.9, -1.35]);   // shark fin
  // ---- rear wing
  add(new THREE.BoxGeometry(0.98, 0.04, 0.3), M.carbon, [0, 0.86, -2.5], [0.12, 0, 0]);
  add(new THREE.BoxGeometry(0.98, 0.03, 0.2), paint, [0, 0.98, -2.42], [0.5, 0, 0]);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.025, 0.5, 0.65), accent, [s * 0.5, 0.82, -2.45]);
  add(new THREE.BoxGeometry(0.05, 0.38, 0.12), M.carbon, [0, 0.62, -2.35]);
  add(new THREE.BoxGeometry(0.9, 0.03, 0.18), M.carbon, [0, 0.42, -2.35], [0.2, 0, 0]);   // beam wing
  // diffuser
  add(new THREE.BoxGeometry(1.0, 0.24, 0.45), M.carbon, [0, 0.17, -2.15], [-0.3, 0, 0]);
  for (let k = -2; k <= 2; k++) add(new THREE.BoxGeometry(0.015, 0.22, 0.4), M.carbon, [k * 0.2, 0.18, -2.15], [-0.3, 0, 0]);
  // gearbox / crash structure
  add(new THREE.BoxGeometry(0.3, 0.25, 0.8), M.carbon, [0, 0.3, -1.95]);
  // rain light
  add(new THREE.BoxGeometry(0.14, 0.06, 0.03), M.light, [0, 0.33, -2.37]);

  // ---- halo
  add(new THREE.TorusGeometry(0.33, 0.026, 8, 28, Math.PI), M.halo, [0, 0.95, -0.12], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) link([s * 0.33, 0.95, -0.12], [s * 0.3, 0.74, -0.5], 0.026, M.halo);
  link([0, 0.95, 0.21], [0, 0.67, 0.62], 0.028, M.halo);

  // ---- driver
  const driver = new THREE.Group();
  {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), helmetMat);
    helmet.scale.set(1, 1.05, 1.12);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 8, -0.9, 1.8, 1.15, 0.45), M.visor);
    visor.rotation.y = 0; visor.scale.copy(helmet.scale);
    driver.add(helmet, visor);
    driver.position.set(0, 0.8, -0.08);
  }

  // ---- suspension links
  const wheelPos = {
    fl: [0.8, CAR.wheelR, zf], fr: [-0.8, CAR.wheelR, zf],
    rl: [0.78, CAR.wheelR, zr], rr: [-0.78, CAR.wheelR, zr],
  };
  for (const [k, p] of Object.entries(wheelPos)) {
    const s = Math.sign(p[0]), front = k[0] === 'f';
    const inX = front ? 0.3 : 0.25;
    link([s * inX, 0.5, p[2] + 0.25], [p[0] - s * 0.12, 0.52, p[2]], 0.018, M.carbon);
    link([s * inX, 0.5, p[2] - 0.25], [p[0] - s * 0.12, 0.52, p[2]], 0.018, M.carbon);
    link([s * inX, 0.25, p[2] + 0.25], [p[0] - s * 0.12, 0.22, p[2]], 0.018, M.carbon);
    link([s * inX, 0.25, p[2] - 0.25], [p[0] - s * 0.12, 0.22, p[2]], 0.018, M.carbon);
    link([s * inX, 0.32, p[2] + (front ? 0.1 : -0.1)], [p[0] - s * 0.12, 0.38, p[2]], 0.014, M.carbon);
  }

  const body = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    body.add(mesh);
  }
  body.add(driver);
  driver.traverse(o => { if (o.isMesh) o.castShadow = true; });

  // ---- wheels
  const wheels = {}, pivots = {};
  const compound = compounds[livery.tyre ?? 'soft'];
  const stripeMat = new THREE.MeshStandardMaterial({ color: compound, roughness: 0.6 });
  const letterMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 });
  function makeWheel(width) {
    const R = CAR.wheelR;
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, width, 36, 1, true), M.tread);
    tyre.rotation.z = Math.PI / 2;
    // rounded shoulders
    const sh = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.03, 8, 36), M.rubber);
    const sh2 = sh.clone();
    sh.rotation.y = Math.PI / 2; sh2.rotation.y = Math.PI / 2;
    sh.position.x = width / 2 - 0.01; sh2.position.x = -width / 2 + 0.01;
    w.add(tyre, sh, sh2);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.RingGeometry(0.235, R - 0.02, 36), M.rubber);
      side.rotation.y = s * Math.PI / 2; side.position.x = s * width / 2;
      const stripe = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.285, 36), stripeMat);
      stripe.rotation.y = s * Math.PI / 2; stripe.position.x = s * (width / 2 + 0.002);
      // sidewall lettering blocks so rotation is visible
      for (let k = 0; k < 2; k++) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.1), letterMat);
        t.position.set(s * (width / 2 + 0.003), Math.cos(k * Math.PI) * 0.31, Math.sin(k * Math.PI) * 0.31);
        t.rotation.set(k * Math.PI, s * Math.PI / 2, 0);
        w.add(t);
      }
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.21, 0.03, 24), M.rim);
      rim.rotation.z = Math.PI / 2; rim.position.x = s * (width / 2 - 0.03);
      w.add(side, stripe, rim);
    }
    // spokes (one side visible) & wheel nut
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width + 0.04, 6), stripeMat);
    nut.rotation.z = Math.PI / 2; w.add(nut);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, 0.03, 0.2), M.rim);
      sp.rotation.x = k * Math.PI * 2 / 5; sp.position.set(0, Math.cos(k * Math.PI * 2 / 5) * 0.12, Math.sin(k * Math.PI * 2 / 5) * 0.12);
      w.add(sp);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20), M.brake);
    disc.rotation.z = Math.PI / 2; w.add(disc);
    w.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return w;
  }
  const group = new THREE.Group();
  for (const [k, p] of Object.entries(wheelPos)) {
    const pivot = new THREE.Group();
    pivot.position.set(...p);
    const wh = makeWheel(k[0] === 'f' ? 0.3 : 0.4);
    pivot.add(wh);
    group.add(pivot);
    wheels[k] = wh; pivots[k] = pivot;
  }
  group.add(body);

  const steering = opts.cockpit ? buildSteeringWheel(body, M, accent, livery) : null;
  return { group, body, wheels, pivots, driver, paint, steering };
}

export const LIVERIES = [
  { name: 'Aurora', primary: 0x0b3d91, accent: 0xffb000, helmet: 0xffffff },
  { name: 'Scarlet', primary: 0xc8102e, accent: 0xf2f2f2, helmet: 0xffd400 },
  { name: 'Viridian', primary: 0x00594f, accent: 0xc6ff00, helmet: 0xc6ff00 },
  { name: 'Ember', primary: 0xff6a13, accent: 0x111a2e, helmet: 0x1e88e5 },
  { name: 'Glacier', primary: 0xe8eef3, accent: 0x00a3e0, helmet: 0x00a3e0 },
  { name: 'Onyx', primary: 0x16161a, accent: 0xd4af37, helmet: 0xd4af37 },
  { name: 'Azure', primary: 0x2a9df4, accent: 0xffffff, helmet: 0xff4081 },
  { name: 'Magenta', primary: 0xd81b60, accent: 0x1a1a1a, helmet: 0xffffff },
  { name: 'Racing Green', primary: 0x0d4d2b, accent: 0xe0c060, helmet: 0xe0c060 },
  { name: 'Solar', primary: 0xffd400, accent: 0x202020, helmet: 0x202020 },
];

// Detailed steering wheel with a live LCD (only built for the player's car).
function buildSteeringWheel(body, M, accent, livery) {
  const mount = new THREE.Group();
  mount.position.set(0, 0.69, 0.44);
  mount.rotation.x = -0.55;              // top of the wheel leans toward the driver
  body.add(mount);
  const wheel = new THREE.Group();
  mount.add(wheel);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.15, 0.03, 3, 0.02), M.carbon);
  wheel.add(plate);
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.1, 4, 10), rubber);
    grip.position.set(s * 0.14, -0.005, 0); grip.rotation.z = s * 0.12; wheel.add(grip);
    // gloves
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), new THREE.MeshStandardMaterial({ color: livery.accent, roughness: 0.8 }));
    glove.scale.set(0.8, 1.1, 0.75); glove.position.set(s * 0.15, 0.01, -0.02); wheel.add(glove);
    // paddles behind the wheel
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.006), M.carbon);
    pad.position.set(s * 0.085, 0.03, 0.03); wheel.add(pad);
  }
  // buttons and rotaries
  const cols = [0xe53935, 0xffd400, 0x1e88e5, 0x43a047, 0xffffff, 0xff6d00];
  for (let k = 0; k < 6; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 10), new THREE.MeshStandardMaterial({ color: cols[k], roughness: 0.4, emissive: cols[k], emissiveIntensity: 0.15 }));
    b.rotation.x = Math.PI / 2; b.position.set((k % 3 - 1) * 0.022 + (k < 3 ? -0.085 : 0.085), -0.045 + (k % 2) * 0.02, -0.018);
    wheel.add(b);
  }
  for (const s of [-1, 1]) {
    const rot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 12), new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.8, roughness: 0.3 }));
    rot.rotation.x = Math.PI / 2; rot.position.set(s * 0.04, -0.055, -0.018); wheel.add(rot);
  }
  // rev LEDs strip
  const leds = [];
  for (let k = 0; k < 15; k++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.0045, 8), m);
    l.position.set((k - 7) * 0.0115, 0.06, -0.0165); l.rotation.y = Math.PI; wheel.add(l);
    leds.push(m);
  }
  // LCD
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.0525), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  lcd.position.set(0, 0.012, -0.0165); lcd.rotation.y = Math.PI; wheel.add(lcd);
  const g = cv.getContext('2d');
  let last = '';
  return {
    set(steerAngle) { wheel.rotation.z = THREE.MathUtils.clamp(-steerAngle * 2.4, -0.75, 0.75); },
    update(d) {
      // shift lights
      const lit = Math.round(d.rpmFrac * 15);
      for (let k = 0; k < 15; k++) {
        const on = d.flash || k < lit;
        leds[k].color.set(on ? (d.flash ? 0x3d7bff : k < 5 ? 0x18e07a : k < 10 ? 0xe10600 : 0x3d7bff) : 0x111111);
      }
      const key = `${d.gear}|${d.speed}|${d.delta}|${d.pos}|${d.lap}`;
      if (key === last) return;
      last = key;
      g.fillStyle = '#05070a'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#1c2230'; g.fillRect(4, 4, 248, 120);
      g.textBaseline = 'middle'; g.textAlign = 'center';
      g.fillStyle = '#ffd400'; g.font = 'bold 84px Arial'; g.fillText(d.gear, 128, 64);
      g.font = 'bold 30px Arial'; g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.fillText(d.speed, 12, 32);
      g.font = '18px Arial'; g.fillStyle = '#9aa4af'; g.fillText('KM/H', 12, 58);
      g.textAlign = 'right'; g.font = 'bold 26px Arial'; g.fillStyle = '#ffffff'; g.fillText(d.pos, 244, 32);
      g.font = '18px Arial'; g.fillStyle = '#9aa4af'; g.fillText(d.lap, 244, 58);
      if (d.delta) {
        g.textAlign = 'center'; g.font = 'bold 24px Arial';
        g.fillStyle = d.delta.startsWith('-') ? '#18e07a' : '#ff5252';
        g.fillText(d.delta, 128, 112);
      }
      tex.needsUpdate = true;
    },
  };
}
