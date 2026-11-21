// Vehicle dynamics for a modern open-wheel race car.
// Dynamic bicycle model with Pacejka-style tyres, aero downforce & drag,
// load transfer, friction circle, 8-speed gearbox. Pure math, no three.js.
//
// Conventions: world ground plane (x, z). heading h: forward = (sin h, cos h),
// left = (cos h, -sin h). Local velocity vx = forward, vy = left, r = yaw rate
// (positive = turning left). Steer angle positive = left.

export const G = 9.81;
export const CAR = {
  mass: 798,
  L: 3.6, a: 1.9, b: 1.7,      // wheelbase, CG→front axle, CG→rear axle
  h: 0.3,                      // CG height
  Iz: 1100,
  mu: 1.7,
  ClA: 4.0, CdA: 1.4, aeroFront: 0.45, rho: 1.225,
  power: 780000,               // W (~1050 hp hybrid V6)
  maxDrive: 13000,
  brakeMax: 62000, brakeFront: 0.6,
  rollRes: 0.015,
  tyreBf: 12, tyreBr: 17, tyreC: 1.5, rearGrip: 1.1,
  wheelR: 0.36,
  steerMax: 0.38, steerRate: 2.6,
  maxRpm: 12500, idleRpm: 4200, shiftUpRpm: 12100, downRpm: 10400,
  gearTop: [25, 34.5, 43, 51.5, 60, 69.5, 80.5, 95],   // m/s at max rpm per gear
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function powerCurve(rpm) {
  if (rpm <= 11000) {
    const r = clamp((rpm - 4000) / 7000, 0, 1);
    return 0.4 + 0.6 * Math.sin(r * Math.PI / 2);
  }
  return 1 - (rpm - 11000) / 1500 * 0.1;
}

// surface presets
export const SURF = {
  asphalt: { mu: 1.0, dragA: 0, dragB: 0, bump: 0 },
  kerb: { mu: 0.93, dragA: 0, dragB: 0, bump: 1 },
  grass: { mu: 0.5, dragA: 1.6, dragB: 0.045, bump: 0.6 },
  gravel: { mu: 0.45, dragA: 4.5, dragB: 0.11, bump: 0.8 },
};

export class CarPhysics {
  constructor() {
    this.x = 0; this.z = 0; this.h = 0;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.steer = 0; this.gear = 1; this.rpm = CAR.idleRpm;
    this.shiftTimer = 0; this.revTimer = 0;
    this.axs = 0; this.ay = 0;
    this.slipF = 0; this.slipR = 0; this.wheelRot = 0;
    this.throttle = 0; this.brake = 0;
    this.locked = false; this.autoGear = true;
    this.draft = 1;
    this.surface = SURF.asphalt; this.surfaceName = 'asphalt';
    this.tyreLoad = 0;   // 0..1 usage of grip (for sound/smoke)
    this.lastShift = 0;
    this.tcs = true; this.lastFyr = 0;
  }
  setPose(x, z, h) {
    this.x = x; this.z = z; this.h = h; this.vx = this.vy = this.r = 0; this.steer = 0;
    this.gear = 1; this.axs = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }

  shift(dir) {
    if (dir > 0 && this.gear >= 1 && this.gear < 8) { this.gear++; this.shiftTimer = 0.06; this.lastShift = 1; }
    else if (dir < 0 && this.gear > 1) { this.gear--; this.lastShift = -1; }
  }

  step(dt, inp) {
    const c = CAR, m = c.mass, W = m * G, surf = this.surface;
    const throttleIn = clamp(inp.throttle, 0, 1), brakeIn = clamp(inp.brake, 0, 1);
    this.throttle = throttleIn; this.brake = brakeIn;

    // steering actuator
    const dSteer = clamp(inp.steer, -c.steerMax, c.steerMax) - this.steer, maxd = c.steerRate * dt;
    this.steer += clamp(dSteer, -maxd, maxd);

    if (this.locked) {
      const target = c.idleRpm + throttleIn * 8000;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
      this.vx = this.vy = this.r = 0;
      return;
    }

    let { vx, vy, r } = this;
    const speed = Math.hypot(vx, vy);
    const absVx = Math.abs(vx);

    // ---- gearbox ----
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.gear >= 1) {
      if (absVx < 0.6 && brakeIn > 0.6 && throttleIn < 0.1) {
        this.revTimer += dt;
        if (this.revTimer > 0.6) { this.gear = -1; this.revTimer = 0; }
      } else this.revTimer = 0;
      if (this.autoGear) {
        if (this.rpm > c.shiftUpRpm && this.gear < 8 && this.shiftTimer <= 0) this.shift(1);
        else if (this.gear > 1 && absVx / c.gearTop[this.gear - 2] * c.maxRpm < c.downRpm) this.shift(-1);
      } else {
        if (inp.shiftUp) this.shift(1);
        if (inp.shiftDown && this.gear > 1 && absVx / c.gearTop[this.gear - 2] * c.maxRpm < c.maxRpm * 1.02) this.shift(-1);
      }
    } else if (this.gear === -1 && throttleIn > 0.1 && vx > -0.6) {
      this.gear = 1;
    }

    // rpm
    let rpmT;
    if (this.gear >= 1) {
      rpmT = absVx / c.gearTop[this.gear - 1] * c.maxRpm;
      if (this.gear === 1) rpmT = Math.max(rpmT, c.idleRpm + throttleIn * 6500 * clamp(1 - absVx / 12, 0, 1));
    } else rpmT = c.idleRpm + brakeIn * 3000;
    rpmT = clamp(rpmT, c.idleRpm, c.maxRpm);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 30);

    // ---- loads ----
    const v2 = vx * vx;
    const Fd = 0.5 * c.rho * c.ClA * v2;
    let Fzf = W * c.b / c.L + Fd * c.aeroFront - m * this.axs * c.h / c.L;
    let Fzr = W * c.a / c.L + Fd * (1 - c.aeroFront) + m * this.axs * c.h / c.L;
    Fzf = Math.max(Fzf, 0.15 * W); Fzr = Math.max(Fzr, 0.15 * W);
    const mu = c.mu * surf.mu;
    const DfMax = mu * Fzf, DrMax = mu * c.rearGrip * Fzr;

    // ---- longitudinal ----
    let Fdrive = 0, brakeCmd = brakeIn;
    if (this.gear >= 1) {
      if (this.shiftTimer <= 0 && !(this.rpm >= c.maxRpm * 0.998 && !this.autoGear)) {
        Fdrive = throttleIn * Math.min(c.maxDrive, c.power * powerCurve(this.rpm) / Math.max(absVx, 1));
      }
      if (this.tcs) {   // friction-circle aware traction control
        const room = Math.sqrt(Math.max(0, (0.97 * DrMax) ** 2 - this.lastFyr * this.lastFyr));
        Fdrive = Math.min(Fdrive, Math.max(room, 0.25 * DrMax));
      } else Fdrive = Math.min(Fdrive, 1.0 * DrMax);
    } else {
      brakeCmd = throttleIn;
      if (vx > -7) Fdrive = -brakeIn * 4500;
    }
    const sgn = vx >= 0 ? 1 : -1;
    const B = brakeCmd * c.brakeMax;
    let Bf = Math.min(B * c.brakeFront, 0.92 * DfMax);    // ABS-ish limit
    let Br = Math.min(B * (1 - c.brakeFront), 0.8 * DrMax);
    const stopCap = m * absVx / dt;
    if (Bf + Br > stopCap) { const k = stopCap / (Bf + Br); Bf *= k; Br *= k; }
    const Fxf = -sgn * Bf;
    const Fxr = Fdrive - sgn * Br;

    // ---- lateral (tyres) ----
    const vxa = Math.max(absVx, 4);
    const alphaF = Math.atan2(vy + c.a * r, vxa) - this.steer * sgn;
    const alphaR = Math.atan2(vy - c.b * r, vxa);
    const DfLat = Math.sqrt(Math.max(DfMax * DfMax - Fxf * Fxf, 0.16 * DfMax * DfMax));
    const DrLat = Math.sqrt(Math.max(DrMax * DrMax - Fxr * Fxr, 0.16 * DrMax * DrMax));
    const Fyf = -DfLat * Math.sin(c.tyreC * Math.atan(c.tyreBf * alphaF));
    const Fyr = -DrLat * Math.sin(c.tyreC * Math.atan(c.tyreBr * alphaR));
    this.slipF = alphaF; this.slipR = alphaR; this.lastFyr = Fyr;
    this.tyreLoad = Math.max(Math.abs(Fyr) / DrMax, Math.abs(Fyf) / DfMax, Math.abs(Fxr) / DrMax);

    // resistances
    let Fres = 0.5 * c.rho * c.CdA * v2 * this.draft + c.rollRes * W + m * (surf.dragA + surf.dragB * absVx);
    Fres = Math.min(Fres, stopCap * 0.9);

    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const Fx = Fxf * cs - Fyf * sn + Fxr - sgn * Fres;
    const Fy = Fxf * sn + Fyf * cs + Fyr;
    const ax = Fx / m, ay = Fy / m;
    const rDot = ((Fxf * sn + Fyf * cs) * c.a - Fyr * c.b) / c.Iz;

    vx += (ax + vy * r) * dt;
    vy += (ay - vx * r) * dt;
    r += rDot * dt;
    this.axs += (ax - this.axs) * Math.min(1, dt * 10);
    this.ay = ay;

    // low-speed blend to kinematic model (stable parking / reversing)
    const kb = clamp((speed - 3) / 4, 0, 1);
    if (kb < 1) {
      const rk = vx * Math.tan(this.steer) / c.L;
      r = kb * r + (1 - kb) * rk;
      vy *= 0.85 + 0.15 * kb;
    }
    // hold still when braking at rest
    if (absVx < 0.15 && brakeCmd > 0.05 && Math.abs(Fdrive) < 1) { vx = 0; vy *= 0.5; }

    this.vx = vx; this.vy = vy; this.r = r;
    this.h += r * dt;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    this.x += (vx * sh + vy * ch) * dt;
    this.z += (vx * ch - vy * sh) * dt;
    this.wheelRot += vx / c.wheelR * dt;
  }

  // world velocity helpers
  worldVel() {
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    return [this.vx * sh + this.vy * ch, this.vx * ch - this.vy * sh];
  }
  setWorldVel(wx, wz) {
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    this.vx = wx * sh + wz * ch;
    this.vy = wx * ch - wz * sh;
  }
}

// Determine the surface under the car and resolve barrier contact.
// Returns impact speed (m/s) if the car hit a wall this step, else 0.
export function applyTrack(car, loc, track) {
  const i = loc.idx, lat = loc.lat, hw = track.halfWidth;
  const side = lat >= 0 ? 1 : -1, alat = Math.abs(lat);
  // surface
  let sname = 'asphalt';
  if (alat > hw + 0.3) {
    const gravel = side > 0 ? track.gravelL[i] : track.gravelR[i];
    if (track.kerb[i] && alat < hw + 1.6) sname = 'kerb';
    else if (track.def.street) sname = 'asphalt';
    else sname = gravel ? 'gravel' : 'grass';
  } else if (alat > hw - 0.9 && track.kerb[i]) sname = 'kerb';
  car.surface = SURF[sname]; car.surfaceName = sname;

  // barriers
  const tyres = side > 0 ? track.tyreL[i] : track.tyreR[i];
  const wall = (side > 0 ? track.wallL[i] : track.wallR[i]) - 1.05 - (tyres ? 0.65 : 0);
  if (alat > wall) {
    const pen = alat - wall;
    const nx = track.nx[i] * side, nz = track.nz[i] * side;   // outward normal
    car.x -= nx * pen; car.z -= nz * pen;
    let [wx, wz] = car.worldVel();
    const vn = wx * nx + wz * nz;
    if (vn > 0) {
      const tx = wx - vn * nx, tz = wz - vn * nz;
      const fr = clamp(1 - vn * 0.03, 0.55, 0.97);
      wx = tx * fr - vn * 0.25 * nx; wz = tz * fr - vn * 0.25 * nz;
      car.setWorldVel(wx, wz);
      car.r *= 0.4;
      return vn;
    }
  }
  return 0;
}

// Simple car-to-car contact: each car is three circles along its length.
const OFFS = [-1.7, 0, 1.7], RAD = 0.95;
export function collideCars(A, B) {
  const dx0 = B.x - A.x, dz0 = B.z - A.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  const sa = Math.sin(A.h), ca = Math.cos(A.h), sb = Math.sin(B.h), cb = Math.cos(B.h);
  let impact = 0;
  for (const oa of OFFS) {
    const ax = A.x + sa * oa, az = A.z + ca * oa;
    for (const ob of OFFS) {
      const bx = B.x + sb * ob, bz = B.z + cb * ob;
      let dx = bx - ax, dz = bz - az;
      const d = Math.hypot(dx, dz);
      if (d >= RAD * 2 || d < 1e-4) continue;
      dx /= d; dz /= d;
      const pen = RAD * 2 - d;
      A.x -= dx * pen / 2; A.z -= dz * pen / 2; B.x += dx * pen / 2; B.z += dz * pen / 2;
      const [awx, awz] = A.worldVel(), [bwx, bwz] = B.worldVel();
      const vrel = (bwx - awx) * dx + (bwz - awz) * dz;
      if (vrel < 0) {
        const j = -(1 + 0.3) * vrel / 2;            // per unit mass
        A.setWorldVel(awx - j * dx, awz - j * dz);
        B.setWorldVel(bwx + j * dx, bwz + j * dz);
        // yaw kick from off-centre contact
        const m = CAR.mass, I = CAR.Iz;
        const rax = ax - A.x, raz = az - A.z, rbx = bx - B.x, rbz = bz - B.z;
        A.r += 0.5 * (raz * (-j * dx) - rax * (-j * dz)) * m / I;
        B.r += 0.5 * (rbz * (j * dx) - rbx * (j * dz)) * m / I;
        impact = Math.max(impact, -vrel);
      }
    }
  }
  return impact;
}
