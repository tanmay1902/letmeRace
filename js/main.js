import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACKS } from './tracks.js';
import { buildTrack } from './trackData.js';
import { CarPhysics, CAR, G, applyTrack, collideCars } from './physics.js';
import { computeRacingLine, computeSpeedProfile, AIDriver } from './ai.js';
import { createCarModel, LIVERIES } from './carModel.js';
import { buildWorld } from './world.js';
import { onProgress, setAniso } from './assets.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { Commentary } from './commentary.js';

// ------------------------------------------------------------ setup
const $ = (id) => document.getElementById(id);
const showError = (msg) => { const e = $('error'); e.textContent = msg; e.classList.remove('hidden'); document.title = 'ERROR'; };
addEventListener('error', (e) => showError(String(e.error?.stack || e.message)));
addEventListener('unhandledrejection', (e) => showError(String(e.reason?.stack || e.reason)));

const params = new URLSearchParams(location.search);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 6000);
const audio = new GameAudio();
const input = new Input();
input.bindTouch($('touch'));
const commentary = new Commentary();
commentary.attach($('captions'));

const QUALITY = {
  low: { pr: 1, shadows: false, shadowSize: 1024, trees: 700, tyres: 450, bloom: false },
  medium: { pr: Math.min(devicePixelRatio, 1.25), shadows: true, shadowSize: 2048, trees: 1400, tyres: 1000, bloom: true },
  high: { pr: Math.min(devicePixelRatio, 2), shadows: true, shadowSize: 4096, trees: 2400, tyres: 1600, bloom: true },
};
const DRIVERS = ['M. Okafor', 'L. Brandt', 'S. Moreau', 'K. Tanaka', 'R. Alves', 'A. Novak', 'J. Lindqvist', 'D. Marchetti', 'E. Kaya', 'T. Whitlock'];
const CAMS = ['Chase', 'Far chase', 'Cockpit', 'T-Cam', 'Nose', 'TV'];

let scene = null, world = null, track = null, worldKey = '';
let composer = null, bloomPass = null;
let cars = [], player = null;
let state = 'menu';          // menu | loading | countdown | racing | finished | paused
let prevState = null;
let raceTime = 0, countdownT = 0, lightsOutAt = 0, lightsShown = 0;
let settings = null;
let camMode = 0;
let finishOrder = [];
let resultsShown = false, finishedAt = 0;
let smoke = null;
let tvSpots = [];
let bestLapStored = null;
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, tvIdx: -1, shake: 0, head: new THREE.Vector3(), lookYaw: 0 };

function resize() {
  const q = QUALITY[settings?.gfx || 'high'];
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(q.pr); composer.setSize(innerWidth, innerHeight); }
}
addEventListener('resize', resize);

// ------------------------------------------------------------ menu
// tracks shown on the menu but not playable yet (deep links still work for development via ?play=)
const UPCOMING = new Set(['iiser']);
let selectedTrack = params.get('track') || 'gp';
if (UPCOMING.has(selectedTrack)) selectedTrack = 'gp';
document.querySelectorAll('.mode').forEach((b) => {
  if (b.dataset.track === selectedTrack) { document.querySelectorAll('.mode').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); }
  b.addEventListener('click', () => {
    if (UPCOMING.has(b.dataset.track)) return;
    document.querySelectorAll('.mode').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected'); selectedTrack = b.dataset.track;
  });
});
try {
  const saved = JSON.parse(localStorage.getItem('race3d.opts') || '{}');
  for (const [k, v] of Object.entries(saved)) { const el = $('opt-' + k); if (el) el.value = v; }
} catch { /* storage unavailable */ }

function readSettings() {
  const s = {
    track: selectedTrack,
    laps: +$('opt-laps').value, ai: +$('opt-ai').value, skill: +$('opt-skill').value,
    gear: $('opt-gear').value, tc: $('opt-tc').value === '1', assist: $('opt-assist').value === '1',
    gfx: $('opt-gfx').value, comm: $('opt-comm').value,
  };
  try { localStorage.setItem('race3d.opts', JSON.stringify({ laps: s.laps, ai: s.ai, skill: s.skill, gear: s.gear, tc: s.tc ? 1 : 0, assist: s.assist ? 1 : 0, gfx: s.gfx, comm: s.comm })); } catch { /* ignore */ }
  return s;
}

$('btn-start').addEventListener('click', () => { audio.init(); audio.resume(); startRace(readSettings()); });
$('btn-resume').addEventListener('click', () => togglePause(false));
$('btn-restart').addEventListener('click', () => { $('pause').classList.add('hidden'); startRace(settings); });
$('btn-quit').addEventListener('click', () => toMenu());
$('btn-again').addEventListener('click', () => { $('results').classList.add('hidden'); startRace(settings); });
$('btn-menu').addEventListener('click', () => toMenu());
$('t-pause').addEventListener('click', () => togglePause(state !== 'paused'));
$('t-cam').addEventListener('click', () => cycleCam());

function toMenu() {
  state = 'menu';
  ['pause', 'results', 'hud'].forEach(id => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
  audio.suspend(); commentary.stop();
}
function togglePause(on) {
  if (on && (state === 'racing' || state === 'countdown' || state === 'finished')) {
    prevState = state; state = 'paused'; $('pause').classList.remove('hidden'); audio.suspend(); commentary.pause();
  } else if (!on && state === 'paused') {
    state = prevState; $('pause').classList.add('hidden'); audio.resume();
  }
}
function cycleCam() { camMode = (camMode + 1) % CAMS.length; camState.init = false; $('h-cam').textContent = `CAMERA: ${CAMS[camMode].toUpperCase()}  [C]`; }

// ------------------------------------------------------------ world / race setup
function disposeScene(s) {
  s.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((mm) => { for (const k in mm) { const v = mm[k]; if (v && v.isTexture) v.dispose(); } mm.dispose(); });
  });
  if (s.background?.dispose) s.background.dispose();
  if (s.environment?.dispose) s.environment.dispose();
}

async function startRace(s) {
  settings = s;
  const q = QUALITY[s.gfx];
  resize();
  renderer.shadowMap.enabled = q.shadows;
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden');
  const key = s.track + '|' + s.gfx;
  if (key !== worldKey) {
    state = 'loading';
    $('loading').classList.remove('hidden'); $('load-bar').style.width = '0%';
    onProgress((p, url) => { $('load-bar').style.width = (p * 100).toFixed(0) + '%'; $('load-text').textContent = url.split('/').pop(); });
    await new Promise(r => setTimeout(r, 30));
    if (scene) disposeScene(scene);
    scene = new THREE.Scene();
    track = buildTrack(TRACKS[s.track]);
    computeRacingLine(track);
    computeSpeedProfile(track);
    world = await buildWorld(scene, renderer, track, q);
    smoke = new Smoke(scene, 160);
    buildTVSpots();
    // post-processing
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const city = s.track === 'city';
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), city ? 0.45 : 0.2, 0.5, city ? 0.9 : 0.97);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    bloomPass.enabled = q.bloom;
    resize();
    worldKey = key;
    drawMinimapBase();
    // warm up shaders
    renderer.compile(scene, camera);
    $('loading').classList.add('hidden');
  }
  // remove previous cars
  for (const c of cars) { scene.remove(c.model.group); }
  cars = [];
  const n = s.ai + 1;
  const playerSlot = s.ai === 0 ? 0 : Math.min(n - 1, Math.floor(n / 2) + 1);
  const liveries = LIVERIES.slice();
  for (let k = 0; k < n; k++) {
    const isPlayer = k === playerSlot;
    const livery = isPlayer ? LIVERIES[1] : liveries.filter(l => l !== LIVERIES[1])[k % (LIVERIES.length - 1)];
    const model = createCarModel(livery, { cockpit: isPlayer });
    scene.add(model.group);
    const phys = new CarPhysics();
    const st = track.pointAt(-10 - k * 8, k % 2 ? -3 : 3);
    phys.setPose(st.x, st.z, st.heading);
    phys.locked = true;
    phys.autoGear = isPlayer ? s.gear === 'auto' : true;
    phys.tcs = isPlayer ? s.tc : true;
    const loc = track.locate(phys.x, phys.z, null, {});
    const prog = loc.s > track.length / 2 ? loc.s - track.length : loc.s;
    const skill = s.skill * (1 - (k / n) * 0.035) * (0.99 + Math.random() * 0.02);
    cars.push({
      k, isPlayer, phys, model, loc, prog, lapsDone: Math.floor(prog / track.length), lapStart: 0, laps: [],
      best: Infinity, finished: false, finishTime: 0, livery,
      name: isPlayer ? 'YOU' : DRIVERS[k % DRIVERS.length],
      ai: isPlayer ? (params.has('autopilot') ? new AIDriver(0.95, k) : null) : new AIDriver(skill, k),
      input: { throttle: 0, brake: 0, steer: 0 }, smokeAcc: 0, wrongWay: 0,
    });
  }
  player = cars[playerSlot];
  player.model.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  try { bestLapStored = +localStorage.getItem('race3d.best.' + s.track) || null; } catch { bestLapStored = null; }
  finishOrder = []; resultsShown = false;
  raceTime = 0; countdownT = 0; lightsShown = 0; lightsOutAt = params.has('nocount') ? 0.1 : 5 + 0.4 + Math.random() * 1.6;
  world.gantry.set(0);
  state = 'countdown';
  camState.init = false;
  $('hud').classList.remove('hidden');
  $('h-cam').textContent = `CAMERA: ${CAMS[camMode].toUpperCase()}  [C]`;
  buildLeds();
  setMsg('');
  audio.resume();
  commentary.setMode(s.comm || 'voice');
  commentary.reset(gameInfo);
}

function buildTVSpots() {
  tvSpots = [];
  for (let s = 0; s < track.length; s += 140) {
    const i = Math.round(s / track.ds) % track.N;
    const side = track.curv[i] > 0 ? -1 : 1;
    const w = (side > 0 ? track.wallL[i] : track.wallR[i]) + 6;
    const p = track.pointAt(s, side * w);
    tvSpots.push({ s, pos: new THREE.Vector3(p.x, 9 + Math.random() * 6, p.z) });
  }
}

const gameInfo = {
  get cars() { return cars; }, get player() { return player; }, get settings() { return settings; },
  get track() { return track; }, get state() { return state; }, get trackName() { return TRACKS[settings.track].name; },
  standings: () => standings(), isRecord: false,
};

// ------------------------------------------------------------ smoke particles
class Smoke {
  constructor(scene, n) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.p = [];
    for (let k = 0; k < n; k++) {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      this.p.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.i = 0;
  }
  emit(x, y, z, vx, vz, color, size = 1.2, life = 1.6) {
    const p = this.p[this.i = (this.i + 1) % this.p.length];
    p.s.position.set(x, y, z); p.vx = vx * 0.3 + (Math.random() - 0.5); p.vy = 0.6 + Math.random() * 0.6; p.vz = vz * 0.3 + (Math.random() - 0.5);
    p.life = p.max = life * (0.7 + Math.random() * 0.6); p.size = size; p.s.visible = true;
    p.s.material.color.set(color);
  }
  update(dt) {
    for (const p of this.p) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= 0.97; p.vz *= 0.97;
      const sc = p.size * (1 + t * 4);
      p.s.scale.set(sc, sc, sc);
      p.s.material.opacity = 0.45 * (1 - t);
    }
  }
}

// ------------------------------------------------------------ simulation
const PHYS_DT = 1 / 240;
let acc = 0;

function steerLimit(p) {
  const v = Math.max(Math.abs(p.vx), 1);
  if (!settings.assist) return CAR.steerMax / (1 + v / 30);
  const cl = 0.5 * CAR.rho * CAR.ClA / CAR.mass;
  const lat = CAR.mu * (G + cl * v * v);
  return Math.min(CAR.steerMax, Math.max(0.05, CAR.L * lat / (v * v) + 0.065 + Math.abs(p.slipR) * 0.8));
}

function resetCar(c) {
  const loc = track.locate(c.phys.x, c.phys.z, null, {});
  const lat = Math.max(-track.halfWidth + 2, Math.min(track.halfWidth - 2, loc.lat));
  const p = track.pointAt(loc.s, lat);
  const keepGear = c.phys.autoGear, keepTc = c.phys.tcs;
  c.phys.setPose(p.x, p.z, p.heading);
  c.phys.autoGear = keepGear; c.phys.tcs = keepTc;
  track.locate(c.phys.x, c.phys.z, loc.idx, c.loc);
}

function simulate(dt) {
  const racing = state === 'racing' || state === 'finished';
  // controls (once per frame)
  for (const c of cars) {
    if (c.ai) {
      c.input = c.ai.control(c.phys, c.loc, track, cars, dt, raceTime);
      if (c.ai.wantReset) { c.ai.wantReset = false; resetCar(c); }
    } else {
      const lim = steerLimit(c.phys);
      c.input = {
        throttle: input.throttle, brake: input.brake, steer: input.steer * lim,
        shiftUp: input.hit('KeyE', 'ShiftLeft', 'ShiftRight'), shiftDown: input.hit('KeyQ', 'ControlLeft', 'ControlRight'),
      };
    }
  }
  // slipstream
  for (const c of cars) {
    let d = 1;
    for (const o of cars) {
      if (o === c) continue;
      let ds = o.loc.s - c.loc.s; if (ds < -track.length / 2) ds += track.length; if (ds > track.length / 2) ds -= track.length;
      if (ds > 4 && ds < 45 && Math.abs(o.loc.lat - c.loc.lat) < 1.8) d = Math.min(d, 1 - 0.28 * (1 - ds / 45));
    }
    c.phys.draft = d;
  }
  acc += dt;
  let steps = 0;
  while (acc >= PHYS_DT && steps < 16) {
    acc -= PHYS_DT; steps++;
    for (const c of cars) {
      const inp = c.input;
      c.phys.step(PHYS_DT, inp);
      inp.shiftUp = inp.shiftDown = false;
      const prevS = c.loc.s;
      track.locate(c.phys.x, c.phys.z, c.loc.idx, c.loc);
      let d = c.loc.s - prevS;
      if (d < -track.length / 2) d += track.length; if (d > track.length / 2) d -= track.length;
      c.prog += d;
      const imp = applyTrack(c.phys, c.loc, track);
      if (imp > 3 && c === player) { audio.impact(imp); camState.shake = Math.min(1, imp / 25); }
      if (imp > 5 && state === 'racing') commentary.onImpact(c, imp);
    }
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
      const imp = collideCars(cars[a].phys, cars[b].phys);
      if (imp > 2 && (cars[a] === player || cars[b] === player)) { audio.impact(imp * 1.5); camState.shake = Math.min(1, imp / 15); }
      if (imp > 3 && state === 'racing') commentary.onImpact(cars[a], imp, cars[b]);
    }
  }
  if (acc > PHYS_DT * 4) acc = 0;

  if (!racing) return;
  // laps
  for (const c of cars) {
    if (c.finished) continue;
    const done = Math.floor(c.prog / track.length);
    if (done > c.lapsDone) {
      c.lapsDone = done;
      if (done >= 1) {
        const lt = raceTime - c.lapStart;
        c.laps.push(lt); c.lapStart = raceTime;
        if (lt < c.best) c.best = lt;
        gameInfo.isRecord = false;
        if (c === player) onPlayerLap(lt);
        commentary.onLap(c, lt, done);
        if (done >= settings.laps) {
          c.finished = true; c.finishTime = raceTime; finishOrder.push(c);
          if (c === player) onPlayerFinish();
          commentary.onFinish(c, finishOrder.length);
        }
      }
    }
  }
}

function onPlayerLap(lt) {
  $('h-last').textContent = fmt(lt);
  const isBest = player.laps.length === 1 || lt <= player.best;
  if (isBest) $('h-best').textContent = fmt(lt);
  const el = $('delta');
  const recordPrev = bestLapStored;
  let cls = 'good', txt = `LAP ${fmt(lt)}`;
  if (!recordPrev || lt < recordPrev) {
    cls = 'best'; txt = `TRACK RECORD ${fmt(lt)}`; gameInfo.isRecord = !!recordPrev;
    bestLapStored = lt; try { localStorage.setItem('race3d.best.' + settings.track, String(lt)); } catch { /* ignore */ }
  } else if (player.laps.length > 1 && !isBest) cls = 'bad';
  el.className = 'delta show ' + cls; el.textContent = txt;
  setTimeout(() => el.classList.remove('show'), 3500);
  if (player.lapsDone === settings.laps - 1 && settings.laps > 1) setMsg('FINAL LAP', 2);
}
function onPlayerFinish() {
  state = 'finished'; finishedAt = performance.now();
  const pos = finishOrder.indexOf(player) + 1;
  setMsg(settings.ai === 0 ? 'FINISH' : (pos === 1 ? 'WINNER!' : `P${pos}`), 4);
  player.ai = new AIDriver(0.8, 99);   // cool-down lap on autopilot
  audio.beep(660, 0.3); setTimeout(() => audio.beep(990, 0.4), 250);
}

// ------------------------------------------------------------ visuals
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
let wheelTick = 0;
function updateCarVisuals(c, dt) {
  const p = c.phys, m = c.model;
  m.group.position.set(p.x, 0, p.z);
  m.group.rotation.y = p.h;
  for (const k of ['fl', 'fr', 'rl', 'rr']) m.wheels[k].rotation.x = p.wheelRot;
  m.pivots.fl.rotation.y = p.steer; m.pivots.fr.rotation.y = p.steer;
  if (m.steering) {
    m.steering.set(p.steer);
    wheelTick -= dt;
    if (wheelTick <= 0) {
      wheelTick = 0.08;
      const rf = Math.max(0, Math.min(1, (p.rpm - 9000) / (CAR.shiftUpRpm - 9000)));
      let delta = '';
      if (isFinite(c.best) && state === 'racing') {
        const frac = (((c.prog % track.length) + track.length) % track.length) / track.length;
        const d = (raceTime - c.lapStart) - c.best * frac;
        if (frac > 0.05) delta = (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2);
      }
      m.steering.update({
        rpmFrac: rf, flash: p.rpm > CAR.shiftUpRpm - 150,
        gear: p.gear === -1 ? 'R' : (p.locked && p.throttle < 0.05 ? 'N' : String(p.gear)),
        speed: String(Math.round(Math.abs(p.vx) * 3.6)), delta,
        pos: 'P' + (standings().indexOf(c) + 1), lap: `L${Math.min(settings.laps, Math.max(1, c.lapsDone + 1))}/${settings.laps}`,
      });
    }
  }
  const v = Math.abs(p.vx);
  m.body.rotation.z = THREE.MathUtils.clamp(p.ay * 0.0006, -0.035, 0.035);
  m.body.rotation.x = THREE.MathUtils.clamp(-p.axs * 0.0005, -0.03, 0.03);
  let bump = 0;
  if (p.surfaceName !== 'asphalt' && v > 2) bump = (Math.random() - 0.5) * (p.surfaceName === 'kerb' ? 0.025 : 0.04);
  m.body.position.y = -Math.min(0.03, v * v * 4e-6) + bump;
  // smoke / dust
  const slide = Math.max(Math.abs(p.slipR) - 0.13, Math.abs(p.slipF) - 0.2, 0);
  const offroad = p.surfaceName === 'grass' || p.surfaceName === 'gravel';
  const wheelspin = p.gear === 1 && p.throttle > 0.9 && v < 12 && p.rpm > 9000 && !p.locked && !p.tcs;
  if ((slide > 0 && v > 6) || (offroad && v > 4) || wheelspin) {
    c.smokeAcc += dt * (offroad ? 40 : 30 + slide * 200);
    const sh = Math.sin(p.h), ch = Math.cos(p.h);
    const [wx, wz] = p.worldVel();
    while (c.smokeAcc > 1) {
      c.smokeAcc -= 1;
      const side = Math.random() < 0.5 ? 0.78 : -0.78;
      const x = p.x - sh * 1.7 + ch * side, z = p.z - ch * 1.7 - sh * side;
      smoke.emit(x, 0.35, z, wx, wz, offroad ? (p.surfaceName === 'gravel' ? 0xb9a27c : 0x8a7a5a) : 0xdddddd, offroad ? 0.9 : 1.1);
    }
  }
}

function updateCamera(dt) {
  const p = player.phys;
  const sh = Math.sin(p.h), ch = Math.cos(p.h);
  const fwd = tmpV.set(sh, 0, ch);
  const carPos = tmpV2.set(p.x, 0, p.z);
  const v = Math.abs(p.vx);
  const mode = CAMS[camMode];
  player.model.driver.visible = mode !== 'Cockpit';
  let near = 0.3, fov = 60;
  if (mode === 'Chase' || mode === 'Far chase') {
    const far = mode === 'Far chase';
    const dist = (far ? 11 : 6.8) + v * 0.012, hgt = far ? 3.6 : 2.05;
    // follow travel direction a little when sliding
    const [wx, wz] = p.worldVel();
    const sp = Math.hypot(wx, wz);
    let dx = sh, dz = ch;
    if (sp > 5 && p.vx > 0) { dx = sh * 0.75 + (wx / sp) * 0.25; dz = ch * 0.75 + (wz / sp) * 0.25; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
    const want = new THREE.Vector3(p.x - dx * dist, hgt, p.z - dz * dist);
    const look = new THREE.Vector3(p.x + dx * 4, far ? 1.0 : 0.9, p.z + dz * 4);
    if (!camState.init) { camState.pos.copy(want); camState.look.copy(look); camState.init = true; }
    const k = 1 - Math.exp(-dt * (far ? 6 : 10));
    camState.pos.lerp(want, k); camState.look.lerp(look, 1 - Math.exp(-dt * 18));
    camera.position.copy(camState.pos); camera.lookAt(camState.look);
    fov = 58 + Math.min(14, v * 0.12);
  } else if (mode === 'Cockpit' || mode === 'T-Cam' || mode === 'Nose') {
    const body = player.model.body; body.updateMatrixWorld();
    // head / mount motion from g-forces, smoothed
    const hk = 1 - Math.exp(-dt * 7);
    const want = new THREE.Vector3(
      THREE.MathUtils.clamp(-p.ay * 0.0011, -0.05, 0.05),
      THREE.MathUtils.clamp(-Math.abs(p.ay) * 0.0002 + p.axs * 0.0004, -0.03, 0.02),
      THREE.MathUtils.clamp(-p.axs * 0.0009, -0.03, 0.05));
    if (mode !== 'Cockpit') want.multiplyScalar(0.15);
    camState.head.lerp(want, hk);
    camState.lookYaw += (p.steer * (mode === 'Cockpit' ? 1.3 : 0.5) - camState.lookYaw) * hk;
    let local, target;
    if (mode === 'Cockpit') {
      local = new THREE.Vector3(0, 0.84, 0.02).add(camState.head);
      target = new THREE.Vector3(Math.sin(camState.lookYaw) * 12, 0.0, 12);   // pitched ~4 deg down
      fov = 56 + Math.min(8, v * 0.06);
    } else if (mode === 'T-Cam') {
      local = new THREE.Vector3(0, 1.17, -0.5).add(camState.head);
      target = new THREE.Vector3(Math.sin(camState.lookYaw) * 14, 0.5, 14);
      fov = 54 + Math.min(8, v * 0.06);
    } else {
      local = new THREE.Vector3(0, 0.56, 2.35).add(camState.head);
      target = new THREE.Vector3(Math.sin(camState.lookYaw) * 20, 0.25, 20);
      fov = 62 + Math.min(10, v * 0.07);
    }
    camera.position.copy(local).applyMatrix4(body.matrixWorld);
    camera.lookAt(target.applyMatrix4(body.matrixWorld));
    near = 0.03;
    camState.init = false;
  } else { // TV
    let best = 0, bd = Infinity;
    tvSpots.forEach((t, i) => { const d = t.pos.distanceToSquared(carPos); if (d < bd) { bd = d; best = i; } });
    if (best !== camState.tvIdx) camState.tvIdx = best;
    camera.position.copy(tvSpots[best].pos);
    camera.lookAt(p.x, 0.8, p.z);
    const dist = Math.sqrt(bd);
    fov = THREE.MathUtils.clamp(2 * Math.atan(9 / dist) * 180 / Math.PI, 8, 60);
    camState.init = false;
  }
  if (params.has('top')) { camera.position.set(p.x, +params.get('top') || 120, p.z + 0.01); camera.lookAt(p.x, 0, p.z); fov = 60; near = 0.3; }
  // shake
  let sk = camState.shake * 0.25;
  if (p.surfaceName === 'kerb' && v > 10) sk += 0.012;
  if ((p.surfaceName === 'grass' || p.surfaceName === 'gravel') && v > 5) sk += 0.03;
  if (v > 70) sk += (v - 70) * 0.00015;
  if (sk > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk));
  camState.shake = Math.max(0, camState.shake - dt * 2);
  if (camera.near !== near || Math.abs(camera.fov - fov) > 0.05) { camera.near = near; camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------ HUD
function fmt(t) {
  if (!isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
let msgTimer = 0;
function setMsg(text, dur = 0) { $('msg').textContent = text; msgTimer = dur; }

function buildLeds() {
  const el = $('leds'); el.innerHTML = '';
  for (let k = 0; k < 15; k++) el.appendChild(document.createElement('i'));
}

function standings() {
  return cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.prog - a.prog;
  });
}

let hudTick = 0;
function updateHUD(dt) {
  const p = player.phys;
  $('h-speed').textContent = Math.round(Math.abs(p.vx) * 3.6);
  $('h-gear').textContent = p.gear === -1 ? 'R' : (p.locked && p.throttle < 0.05 ? 'N' : p.gear);
  const rf = (p.rpm - CAR.idleRpm) / (CAR.maxRpm - CAR.idleRpm);
  $('h-rpm').style.width = (Math.max(0, Math.min(1, rf)) * 100).toFixed(1) + '%';
  $('h-thr').style.width = (p.throttle * 100) + '%';
  $('h-brk').style.width = (p.brake * 100) + '%';
  // shift lights
  const leds = $('leds').children, lit = Math.round(Math.max(0, (p.rpm - 9000) / (CAR.shiftUpRpm - 9000)) * 15);
  const flash = p.rpm > CAR.shiftUpRpm - 150 && (performance.now() % 160 < 80);
  for (let k = 0; k < 15; k++) leds[k].className = flash ? 'b' : (k < lit ? (k < 5 ? 'g' : k < 10 ? 'r' : 'b') : '');

  const total = settings.laps;
  const lapNow = Math.min(total, Math.max(1, player.lapsDone + 1));
  $('h-lap').textContent = `${lapNow}/${total}`;
  const curLap = state === 'countdown' ? 0 : (player.finished ? player.laps[player.laps.length - 1] : raceTime - player.lapStart);
  $('h-time').textContent = fmt(curLap);
  if (player.laps.length === 0) { $('h-best').textContent = bestLapStored ? fmt(bestLapStored) : '–'; }

  hudTick -= dt;
  if (hudTick <= 0) {
    hudTick = 0.25;
    const order = standings();
    $('h-pos').textContent = `${order.indexOf(player) + 1}/${cars.length}`;
    const leader = order[0];
    const rows = order.map((c, i) => {
      let gap = '';
      if (i === 0) gap = c.finished ? 'FIN' : 'LEADER';
      else if (c.finished) gap = '+' + (c.finishTime - leader.finishTime).toFixed(3);
      else {
        const dl = leader.prog - c.prog;
        gap = dl > track.length ? `+${Math.floor(dl / track.length)} LAP` : '+' + (dl / Math.max(40, Math.abs(leader.phys.vx) || 40)).toFixed(1);
      }
      const col = '#' + new THREE.Color(c.livery.primary).getHexString();
      return `<div class="row${c === player ? ' me' : ''}"><span class="p">${i + 1}</span><span class="sw" style="background:${col}"></span><span class="n">${c.name}</span><span class="g">${gap}</span></div>`;
    }).join('');
    $('tower').innerHTML = cars.length > 1 ? rows : '';
    $('tower').style.display = cars.length > 1 ? '' : 'none';
    // wrong way
    const hd = Math.atan2(Math.sin(p.h - track.heading[player.loc.idx]), Math.cos(p.h - track.heading[player.loc.idx]));
    if (Math.abs(hd) > 1.9 && Math.abs(p.vx) > 3 && state === 'racing') { player.wrongWay += 0.25; if (player.wrongWay > 1) { setMsg('WRONG WAY', 0.6); if (player.wrongWay > 3) commentary.onWrongWay(); } }
    else player.wrongWay = 0;
  }
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) setMsg(''); }
  drawMinimap();
}

// minimap
let mmBase = null, mmT = null;
function drawMinimapBase() {
  const W = 220, pad = 18;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
  const sc = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (W - (maxX - minX) * sc) / 2, oz = (W - (maxZ - minZ) * sc) / 2;
  // top-down: +x right, +z down
  mmT = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
  mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = W;
  const g = mmBase.getContext('2d');
  g.lineJoin = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 2) { const [x, y] = mmT(track.px[i % track.N], track.pz[i % track.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  path(); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 9; g.stroke();
  path(); g.strokeStyle = '#d9dde3'; g.lineWidth = 4; g.stroke();
  const [sx, sy] = mmT(track.px[0], track.pz[0]);
  g.fillStyle = '#e10600'; g.fillRect(sx - 2, sy - 6, 4, 12);
}
function drawMinimap() {
  const cv = $('minimap'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(mmBase, 0, 0);
  for (const c of cars) {
    if (c === player) continue;
    const [x, y] = mmT(c.phys.x, c.phys.z);
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2);
    g.fillStyle = '#' + new THREE.Color(c.livery.primary).getHexString(); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
  }
  const [x, y] = mmT(player.phys.x, player.phys.z);
  g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fillStyle = '#ffd400'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
}

function showResults() {
  resultsShown = true;
  const order = standings();
  const leader = order[0];
  const avgV = leader.prog / Math.max(1, raceTime);
  const rows = order.map((c, i) => {
    let time;
    if (c.finished) time = i === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - leader.finishTime).toFixed(3);
    else {
      const remaining = settings.laps * track.length - c.prog;
      const laps = Math.floor((leader.prog - c.prog) / track.length);
      time = laps >= 1 ? `+${laps} LAP${laps > 1 ? 'S' : ''}` : '+' + (remaining / avgV - (leader.finished ? 0 : 0)).toFixed(1) + ' (est.)';
    }
    return `<tr class="${c === player ? 'me' : ''}"><td>${i + 1}</td><td>${c.name}</td><td>${c.livery.name}</td><td>${time}</td><td>${fmt(c.best)}</td></tr>`;
  }).join('');
  $('res-title').textContent = settings.ai === 0 ? 'SESSION COMPLETE' : `YOU FINISHED P${order.indexOf(player) + 1}`;
  $('res-table').innerHTML = `<tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>TIME</th><th>BEST LAP</th></tr>` + rows;
  $('results').classList.remove('hidden');
}

// ------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = params.has('fixeddt') ? 1 / 30 : Math.min(clock.getDelta(), 0.05);
  input.update(dt);

  if (input.hit('Escape', 'KeyP')) togglePause(state !== 'paused');
  if (input.hit('KeyM')) audio.setMuted(!audio.muted);
  if (state === 'menu' && input.hit('Enter')) $('btn-start').click();

  if (state === 'countdown' || state === 'racing' || state === 'finished') {
    if (input.hit('KeyC')) cycleCam();
    if (input.hit('KeyR') && !player.finished && state === 'racing') { resetCar(player); commentary.onReset(player); }

    if (state === 'countdown') {
      countdownT += dt;
      const n = Math.min(5, Math.floor(countdownT));
      if (n > lightsShown) { lightsShown = n; world.gantry.set(n); audio.beep(520, 0.15); if (n === 1) commentary.onLights(); }
      if (countdownT >= lightsOutAt) {
        world.gantry.set(0);
        state = 'racing'; raceTime = 0;
        for (const c of cars) { c.phys.locked = false; c.lapStart = 0; }
        setMsg('GO!', 1.2); audio.beep(1040, 0.35); commentary.onStart();
      }
    } else raceTime += dt;

    simulate(dt);
    for (const c of cars) updateCarVisuals(c, dt);
    smoke.update(dt);
    updateCamera(dt);
    world.updateSun(new THREE.Vector3(player.phys.x, 0, player.phys.z));
    updateHUD(dt);
    // audio: player + nearest rival
    let rival = null, rd = Infinity;
    for (const c of cars) { if (c === player) continue; const d = Math.hypot(c.phys.x - player.phys.x, c.phys.z - player.phys.z); if (d < rd) { rd = d; rival = c; } }
    if (rival) {
      const toR = new THREE.Vector3(rival.phys.x - camera.position.x, 0, rival.phys.z - camera.position.z);
      const right = new THREE.Vector3(); camera.getWorldDirection(right); right.cross(camera.up).normalize();
      audio.update(player, { phys: rival.phys, vol: Math.min(0.5, 7 / (rd + 6)), pan: toR.normalize().dot(right) });
    } else audio.update(player, null);

    commentary.update(dt);
    if (state === 'finished' && !resultsShown && performance.now() - finishedAt > 3500) showResults();
  }

  if (state !== 'menu' && state !== 'loading' && scene) {
    if (composer && bloomPass.enabled) composer.render(); else renderer.render(scene, camera);
  }
  commentary.tick();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  input.endFrame();
}
resize();
requestAnimationFrame(frame);

// optional deep-link for quick start: ?play=gp|city
if (params.has('play')) {
  selectedTrack = params.get('play') || 'gp';
  const s = readSettings(); s.track = selectedTrack;
  if (params.has('gfx')) s.gfx = params.get('gfx');
  if (params.has('cam')) camMode = Math.max(0, CAMS.indexOf(params.get('cam')));
  startRace(s);
}
window.__game = { get state() { return state; }, get cars() { return cars; }, get raceTime() { return raceTime; } };
