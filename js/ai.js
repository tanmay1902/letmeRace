// Racing line optimisation, speed profiles and the AI driver. Pure math.
import { CAR, G, powerCurve } from './physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (d, L) => (d < -L / 2 ? d + L : d > L / 2 ? d - L : d);

// Minimum-curvature-ish racing line via iterative relaxation of lateral offsets.
export function computeRacingLine(track) {
  const { N, px, pz, nx, nz, halfWidth } = track;
  const lim = halfWidth - 1.4;
  const e = new Float64Array(N);
  const stencils = [[40, 300], [20, 300], [10, 300], [5, 200]];
  for (const [K, iters] of stencils) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - K + N) % N, b = (i + K) % N;
        const mx = (px[a] + nx[a] * e[a] + px[b] + nx[b] * e[b]) / 2;
        const mz = (pz[a] + nz[a] * e[a] + pz[b] + nz[b] * e[b]) / 2;
        const t = (mx - px[i]) * nx[i] + (mz - pz[i]) * nz[i];
        e[i] = clamp(e[i] + (t - e[i]) * 0.6, -lim, lim);
      }
    }
  }
  track.raceE = e;
  track.raceK = null; track.profiles = null;
  return e;
}

function lineCurvature(track) {
  const { N, px, pz, nx, nz, raceE: e } = track;
  const k = new Float64Array(N), kSigned = new Float64Array(N), S = 5;
  const P = (i) => { i = (i + N) % N; return [px[i] + nx[i] * e[i], pz[i] + nz[i] * e[i]]; };
  for (let i = 0; i < N; i++) {
    const A = P(i - S), B = P(i), C = P(i + S);
    const abx = B[0] - A[0], abz = B[1] - A[1], acx = C[0] - A[0], acz = C[1] - A[1];
    const cross = abx * acz - abz * acx;
    const la = Math.hypot(abx, abz), lb = Math.hypot(C[0] - B[0], C[1] - B[1]), lc = Math.hypot(acx, acz);
    k[i] = Math.abs(2 * cross / (la * lb * lc));
    kSigned[i] = 2 * cross / (la * lb * lc);
  }
  track.raceKs = kSigned;
  return k;
}

export function computeSpeedProfile(track, gripScale = 0.93, { assign = true, brakeFactor = 0.88 } = {}) {
  const { N, ds } = track;
  const k = track.raceK || (track.raceK = lineCurvature(track));
  const m = CAR.mass, mu = CAR.mu * gripScale;
  const cl = 0.5 * CAR.rho * CAR.ClA / m, cd = 0.5 * CAR.rho * CAR.CdA / m;
  const VMAX = 98;
  const latMax = (v) => mu * (G + cl * v * v);
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const kk = k[i], den = kk - mu * cl;
    v[i] = den <= 0 ? VMAX : Math.min(VMAX, Math.sqrt(mu * G / den));
  }
  // quick direction changes (chicanes / esses): the car needs time to swing its yaw across,
  // so the steady-state corner speed is too optimistic through the transition
  const ks = track.raceKs, W = Math.round(36 / ds);
  for (let i = 0; i < N; i++) {
    if (Math.abs(ks[i]) < 1 / 220) continue;
    for (let d = 1; d <= W; d++) {
      const j = (i + d) % N;
      if (Math.abs(ks[j]) > 1 / 220 && Math.sign(ks[j]) !== Math.sign(ks[i])) {
        const sev = Math.min(1, (Math.abs(ks[i]) + Math.abs(ks[j])) * 40);
        const f = 1 - 0.09 * sev;
        for (let q = -2; q <= d + 2; q++) { const n = (i + q + N) % N; v[n] *= f; }
        break;
      }
    }
  }
  const vCorner = Float64Array.from(v);
  const use = (vv, kk) => { const a = vv * vv * kk / latMax(vv); return Math.sqrt(Math.max(0, 1 - a * a)); };
  for (let pass = 0; pass < 2; pass++) {
    // forward: acceleration limit
    for (let n = 0; n < N; n++) {
      const i = n % N, j = (n + 1) % N, vi = v[i];
      const trac = mu * (G * CAR.a / CAR.L + cl * vi * vi * (1 - CAR.aeroFront));
      const eng = (CAR.power * 0.95 * powerCurve(11000) / Math.max(vi, 1)) / m;
      const acc = Math.min(trac, Math.min(eng, CAR.maxDrive / m)) * use(vi, k[i]) - cd * vi * vi;
      v[j] = Math.min(v[j], Math.sqrt(Math.max(0, vi * vi + 2 * Math.max(acc, 0) * ds)));
    }
    // backward: braking limit
    for (let n = 2 * N; n > 0; n--) {
      const i = n % N, j = (n - 1 + N) % N, vi = v[i];
      const dec = latMax(vi) * brakeFactor * use(vi, k[i]) + cd * vi * vi;
      v[j] = Math.min(v[j], Math.sqrt(vi * vi + 2 * dec * ds));
    }
  }
  for (let i = 0; i < N; i++) v[i] = Math.min(v[i], vCorner[i]);
  if (assign) track.speed = v;
  return v;
}

// Speed profiles are cached per (grip, braking) level so each driver can have their own pace.
export function getProfile(track, grip, brake) {
  if (!track.profiles) track.profiles = new Map();
  const key = grip.toFixed(3) + '|' + brake.toFixed(3);
  if (!track.profiles.has(key)) track.profiles.set(key, computeSpeedProfile(track, grip, { assign: false, brakeFactor: brake }));
  return track.profiles.get(key);
}

// Map the menu skill (0.86 rookie … 1.0 legend) to how close to the limit a driver corners and brakes.
// Straights are always taken flat out; skill changes corner speed, braking, reactions and consistency.
export function skillToPace(skill) {
  const s = clamp((skill - 0.84) / 0.16, 0, 1.1);        // 0 = rookie, 1 = legend
  return {
    grip: 0.86 + s * 0.10,            // fraction of available grip used in corners
    brake: 0.76 + s * 0.13,           // braking aggression
    reaction: 0.42 - s * 0.26,        // start reaction time (s)
    consistency: 0.010 - s * 0.007,   // random pace variation per corner
    mistakeRate: 0.05 * (1 - Math.min(1, s)) + 0.004,  // chance of a small error per corner
  };
}

export class AIDriver {
  constructor(skill = 0.95, seed = 0, opts = {}) {
    this.skill = skill;
    this.rnd = mulberry(seed * 9973 + 17);
    this.pace = skillToPace(skill);
    this.aggression = opts.aggression ?? (0.35 + this.rnd() * 0.6);   // personality
    this.reaction = this.pace.reaction * (0.8 + this.rnd() * 0.5);
    this.offset = 0;                // lateral deviation from the racing line
    this.stuck = 0; this.wantReset = false; this.recover = 0; this.recoverCount = 0;
    this.pass = null;               // committed overtake { car, side, until }
    this.cornerIdx = -1; this.cornerMod = 1; this.mistake = 0;
    this.startedAt = -1;
  }

  setupFor(track) {
    if (this.track === track && this.profile) return;
    this.track = track;
    this.profile = getProfile(track, this.pace.grip, this.pace.brake);
  }

  control(car, loc, track, others, dt, t) {
    this.setupFor(track);
    const { N, ds, px, pz, nx, nz, raceE, halfWidth, curv } = track;
    const prof = this.profile;
    const L = track.length;
    const v = car.vx;
    const lim = halfWidth - 1.25;

    // ---- start: hold until the lights go out, then react with a human delay
    if (car.locked) { this.startedAt = -1; this.stuck = 0; return { throttle: 0.55, brake: 1, steer: 0 }; }
    if (this.startedAt < 0) this.startedAt = t;
    const sinceStart = t - this.startedAt;
    if (sinceStart < this.reaction) return { throttle: 0.6, brake: 1, steer: 0 };

    // ---- recovery: back out of trouble instead of teleporting
    if (this.recover > 0) return this.recovering(car, loc, track, dt);

    // ---- next corner
    let cornerDist = Infinity, cornerDir = 0, cornerAt = -1;
    for (let d = 10; d < 240; d += 4) {
      const i = (loc.idx + Math.round(d / ds)) % N;
      if (Math.abs(curv[i]) > 1 / 140) { cornerDist = d; cornerDir = Math.sign(curv[i]); cornerAt = i; break; }
    }
    // per-corner consistency and the occasional small mistake
    if (cornerAt >= 0) {
      const gapIdx = Math.abs(cornerAt - this.cornerIdx);
      if (Math.min(gapIdx, N - gapIdx) > 40 / ds) {
        this.cornerIdx = cornerAt;
        this.cornerMod = 1 + (this.rnd() - 0.5) * 2 * this.pace.consistency;
        if (this.rnd() < this.pace.mistakeRate) this.mistake = 1.6;
      }
    }
    if (this.mistake > 0) this.mistake -= dt;

    // ---- traffic
    let ahead = null, aheadGap = Infinity, behind = null, behindGap = Infinity;
    const alongside = [];
    for (const o of others) {
      if (o.phys === car) continue;
      const dsg = wrap(o.loc.s - loc.s, L);
      const dlat = o.loc.lat - loc.lat;
      if (Math.abs(dsg) < 6.5 && Math.abs(dlat) < 4.2) alongside.push({ o, dsg, dlat });
      if (dsg > 0 && dsg < 70 && Math.abs(dlat) < 2.6 && dsg < aheadGap) { ahead = o; aheadGap = dsg; }
      if (dsg < 0 && dsg > -40 && -dsg < behindGap) { behind = o; behindGap = -dsg; }
    }

    // ---- lateral plan (absolute lateral position on the track)
    const here = loc.idx;
    const closing = ahead ? v - ahead.phys.vx : 0;
    if (this.pass) {
      const still = alongside.some((a) => a.o === this.pass.car);
      if (!still && (t > this.pass.until || ahead !== this.pass.car)) this.pass = null;
    }
    if (!this.pass && ahead && aheadGap < 30 + this.aggression * 20 && (closing > 0.6 || aheadGap < 12 + this.aggression * 6)) {
      // pick a side: the inside of the next corner when it's close, otherwise whichever side has more room
      const roomL = lim - ahead.loc.lat, roomR = ahead.loc.lat + lim;
      let side = roomL > roomR ? 1 : -1;
      if (cornerDist < 170 && cornerDir !== 0 && (cornerDir > 0 ? roomL : roomR) > 2.4) side = cornerDir;
      if ((side > 0 ? roomL : roomR) > 2.4) this.pass = { car: ahead, side, until: t + 4 };
    }
    let targetLat = null;
    if (this.pass) targetLat = this.pass.car.loc.lat + this.pass.side * 3.1;
    // defend: cover the inside when a faster car is closing in before a corner
    else if (behind && behindGap < 22 && behind.phys.vx > v + 0.5 && cornerDist < 200 && cornerDir !== 0 && this.aggression > 0.45) {
      targetLat = cornerDir * lim * 0.55;
    }
    const raceLat = raceE[here];
    let want = targetLat ?? raceLat;
    // spatial awareness: leave a car's width to anyone alongside
    for (const a of alongside) {
      if (a.dlat > 0) want = Math.min(want, a.o.loc.lat - 2.7);
      else want = Math.max(want, a.o.loc.lat + 2.7);
    }
    want = clamp(want, -lim, lim);
    const offRate = (alongside.length ? 4.5 : 2.4) * dt;
    this.offset += clamp(want - raceLat - this.offset, -offRate, offRate);

    // ---- steering: pure pursuit on (racing line + offset)
    const Ld = 7 + Math.max(v, 0) * 0.33;
    const ti = (here + Math.round(Ld / ds)) % N;
    const e = clamp(raceE[ti] + this.offset, -lim, lim);
    const Tx = px[ti] + nx[ti] * e, Tz = pz[ti] + nz[ti] * e;
    const dx = Tx - car.x, dz = Tz - car.z;
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    const fwd = dx * sh + dz * ch, left = dx * ch - dz * sh;
    const d2 = fwd * fwd + left * left;
    let steer = Math.atan(2 * CAR.L * left / Math.max(d2, 1));
    steer -= (car.r - v * 2 * left / Math.max(d2, 1)) * 0.02;
    // remove steady-state tracking error so the car really is on its planned line
    const eHere = clamp(raceE[here] + this.offset, -lim, lim);
    steer += clamp((eHere - loc.lat) * 0.006, -0.03, 0.03);
    // catch slides: countersteer toward the direction of travel
    const beta = Math.atan2(car.vy, Math.max(Math.abs(v), 3));
    if (Math.abs(beta) > 0.035) steer += beta * 0.9;

    // ---- speed target
    const look = (here + 3 + Math.round(Math.max(v, 0) * 0.2 / ds)) % N;
    let vt = prof[look] * this.cornerMod;
    // off the racing line the radius changes: the inside line is tighter, so slower
    const kc = curv[look];
    if (Math.abs(kc) > 1e-4) {
      const eLine = raceE[look], eMe = clamp(eLine + this.offset, -lim, lim);
      const kLine = Math.abs(kc / (1 - kc * eLine)), kMe = Math.abs(kc / Math.max(0.2, 1 - kc * eMe));
      if (kMe > kLine) vt *= clamp(Math.sqrt(kLine / kMe), 0.75, 1);
    }
    if (this.mistake > 0) vt *= 1.035;    // braked a touch late: runs wide and loses the exit
    // keep a safe gap to a car in our lane (unless we've pulled out to pass)
    if (ahead && Math.abs(ahead.loc.lat - (raceLat + this.offset)) < 2.3) {
      const gap = aheadGap - 5.6, safe = 1.5 + Math.max(v, 0) * (0.22 - this.aggression * 0.06);
      if (gap < safe * 2.5) vt = Math.min(vt, ahead.phys.vx + (gap - safe) * 0.9);
    }
    // first-corner caution in a pack
    if (sinceStart < 12 && ahead && aheadGap < 14) vt = Math.min(vt, ahead.phys.vx + 1);

    const err = vt - v;
    let throttle = 0, brake = 0;
    if (err > -0.3) throttle = clamp(0.35 + err * 0.5, 0, 1);
    else if (err < -1.0) brake = clamp(-err * 0.22, 0, 1);
    // rear stepping out: come off the brakes / throttle like a driver would
    const oversteer = Math.abs(car.slipR) > 0.085 && Math.abs(car.slipR) > Math.abs(car.slipF) * 0.85;
    if (oversteer) { brake *= 0.3; throttle *= 0.35; }
    else if (Math.abs(car.slipR) > 0.14) throttle *= 0.5;
    if (sinceStart < 2.5) throttle = Math.min(throttle, 0.82 + this.pace.grip * 0.18);   // launch modulation

    // ---- stuck / facing the wrong way -> recovery manoeuvre (teleport only as a last resort)
    const hd = Math.atan2(Math.sin(car.h - track.heading[here]), Math.cos(car.h - track.heading[here]));
    if (Math.abs(v) < 2 || (Math.abs(hd) > 1.4 && Math.abs(v) < 10)) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.6) {
      this.stuck = 0; this.recover = 3.2; this.recoverCount++;
      if (this.recoverCount > 3) { this.wantReset = true; this.recoverCount = 0; this.recover = 0; }
    }
    if (Math.abs(v) > 15) this.recoverCount = 0;
    // beached in the gravel / grass for too long: marshals recover the car
    const offSurface = car.surfaceName === 'gravel' || car.surfaceName === 'grass';
    this.offTime = offSurface && Math.abs(v) < 14 ? (this.offTime || 0) + dt : 0;
    if (this.offTime > 6) { this.offTime = 0; this.wantReset = true; }

    return { throttle, brake, steer: clamp(steer, -CAR.steerMax, CAR.steerMax), shiftUp: false, shiftDown: false };
  }

  // Reverse while swinging the nose round, then drive off toward the racing line.
  recovering(car, loc, track, dt) {
    this.recover -= dt;
    const here = loc.idx;
    const hd = Math.atan2(Math.sin(car.h - track.heading[here]), Math.cos(car.h - track.heading[here]));
    const latErr = loc.lat - track.raceE[here];
    if (this.recover > 1.4) {
      const steer = clamp(hd * 1.5, -1, 1) * CAR.steerMax;
      return { throttle: 0, brake: 1, steer, shiftUp: false, shiftDown: false };
    }
    const steer = clamp(-hd * 2 - latErr * 0.04, -1, 1) * CAR.steerMax;
    if (this.recover <= 0 || (Math.abs(hd) < 0.5 && car.vx > 4)) this.recover = 0;
    return { throttle: 0.55, brake: 0, steer, shiftUp: false, shiftDown: false };
  }
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
