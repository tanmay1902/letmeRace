// Pure track geometry: centreline sampling, normals, curvature, barrier
// offsets, kerb/gravel zones and fast nearest-point queries. No three.js.

const TAU = Math.PI * 2;
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// Centripetal Catmull-Rom (Barry–Goldman), closed loop.
function sampleCatmull(points, perSeg) {
  const n = points.length, out = [];
  const knot = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + (t2 - t1) * (k / perSeg);
      const P = [0, 0];
      for (let d = 0; d < 2; d++) {
        const A1 = (t1 - t) / (t1 - t0) * p0[d] + (t - t0) / (t1 - t0) * p1[d];
        const A2 = (t2 - t) / (t2 - t1) * p1[d] + (t - t1) / (t2 - t1) * p2[d];
        const A3 = (t3 - t) / (t3 - t2) * p2[d] + (t - t2) / (t3 - t2) * p3[d];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        P[d] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
      }
      out.push(P);
    }
  }
  return out;
}

// Polygon with circular fillets at every vertex (street-circuit style corners).
function filletPolygon(points, radius, radii = {}) {
  const n = points.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n];
    const d1 = [p1[0] - p0[0], p1[1] - p0[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const u1 = [d1[0] / l1, d1[1] / l1], u2 = [d2[0] / l2, d2[1] / l2];
    const turn = wrapAngle(Math.atan2(u2[1], u2[0]) - Math.atan2(u1[1], u1[0]));
    let R = radii[i] ?? radius;
    let tlen = R * Math.tan(Math.abs(turn) / 2);
    const maxT = Math.min(l1, l2) * 0.45;
    if (tlen > maxT) { R *= maxT / tlen; tlen = maxT; }
    const a = [p1[0] - u1[0] * tlen, p1[1] - u1[1] * tlen];
    const steps = Math.max(4, Math.ceil(Math.abs(turn) * R / 1.0));
    // arc centre: perpendicular to u1, on the side of the turn
    const s = Math.sign(turn) || 1;
    const perp = [-u1[1] * s, u1[0] * s];
    const c = [a[0] + perp[0] * R, a[1] + perp[1] * R];
    const startAng = Math.atan2(a[1] - c[1], a[0] - c[0]);
    for (let k = 0; k <= steps; k++) {
      const ang = startAng + turn * (k / steps);
      out.push([c[0] + Math.cos(ang) * R, c[1] + Math.sin(ang) * R]);
    }
  }
  return out;
}

function resample(pts, spacing) {
  const n = pts.length, cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum[n], N = Math.round(L / spacing), ds = L / N;
  const xs = new Float64Array(N), zs = new Float64Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (cum[seg + 1] < s) seg++;
    const a = pts[seg], b = pts[(seg + 1) % n];
    const f = (s - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1);
    xs[i] = a[0] + (b[0] - a[0]) * f; zs[i] = a[1] + (b[1] - a[1]) * f;
  }
  return { xs, zs, N, ds, L };
}

export function buildTrack(def) {
  let raw = def.type === 'spline' ? sampleCatmull(def.points, 60) : filletPolygon(def.points, def.cornerRadius, def.radii);
  let r = resample(raw, 1.0);
  // light smoothing to remove sampling kinks
  for (let pass = 0; pass < (def.type === 'spline' ? 6 : 3); pass++) {
    const { xs, zs, N } = r, nx = new Float64Array(N), nz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      nx[i] = (xs[a] + 2 * xs[i] + xs[b]) / 4; nz[i] = (zs[a] + 2 * zs[i] + zs[b]) / 4;
    }
    r.xs = nx; r.zs = nz;
  }
  const pts = []; for (let i = 0; i < r.N; i++) pts.push([r.xs[i], r.zs[i]]);
  r = resample(pts, 2.0);

  const { N, ds, L } = r;
  const px = r.xs, pz = r.zs;
  const tx = new Float64Array(N), tz = new Float64Array(N), nx = new Float64Array(N), nz = new Float64Array(N);
  const heading = new Float64Array(N), curv = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz; nx[i] = dz; nz[i] = -dx;  // n = left of travel
    heading[i] = Math.atan2(dx, dz);
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    curv[i] = wrapAngle(heading[b] - heading[a]) / (4 * ds);
  }
  const curvS = smoothCircular(curv, 6);

  const halfW = def.halfWidth;
  const wallL = new Float64Array(N).fill(def.wallDist), wallR = new Float64Array(N).fill(def.wallDist);
  // inside of tight corners
  for (let i = 0; i < N; i++) {
    const k = curvS[i];
    if (Math.abs(k) > 1e-4) {
      const lim = 0.8 / Math.abs(k);
      if (k > 0) wallL[i] = Math.min(wallL[i], lim); else wallR[i] = Math.min(wallR[i], lim);
    }
  }
  // proximity to other parts of the track
  const skip = Math.ceil(120 / ds), reach = def.wallDist * 2 + 12;
  let minSep = Infinity;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let d = Math.abs(i - j); d = Math.min(d, N - d);
      if (d < skip) continue;
      const dx = px[j] - px[i], dz = pz[j] - pz[i];
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > reach) continue;
      minSep = Math.min(minSep, dist);
      const side = dx * nx[i] + dz * nz[i];
      const lim = dist / 2 - 1.5;
      if (side > 0) wallL[i] = Math.min(wallL[i], lim); else wallR[i] = Math.min(wallR[i], lim);
    }
  }
  const minWall = halfW + 0.9;
  for (const w of [wallL, wallR]) {
    const m = minFilterCircular(w, 12);
    const s = smoothCircular(m, 8);
    for (let i = 0; i < N; i++) w[i] = Math.max(minWall, s[i]);
  }

  // kerbs (both sides in corners) and gravel (outside of corners)
  const kerb = new Uint8Array(N), gravelL = new Uint8Array(N), gravelR = new Uint8Array(N);
  if (def.kerbs) {
    for (let i = 0; i < N; i++) if (Math.abs(curvS[i]) > 1 / 320) for (let d = -8; d <= 8; d++) kerb[(i + d + N) % N] = 1;
  }
  if (def.gravel) {
    for (let i = 0; i < N; i++) {
      if (Math.abs(curvS[i]) > 1 / 180) {
        const g = curvS[i] > 0 ? gravelR : gravelL;
        for (let d = -10; d <= 30; d++) g[(i + d + N) % N] = 1;
      }
    }
  }

  // tyre barriers on the outside of the sharpest corners
  const tyreL = new Uint8Array(N), tyreR = new Uint8Array(N);
  if (def.gravel) {
    for (let i = 0; i < N; i++) {
      if (Math.abs(curvS[i]) > 1 / 120) {
        const t = curvS[i] > 0 ? tyreR : tyreL;
        for (let d = -6; d <= 22; d++) t[(i + d + N) % N] = 1;
      }
    }
  }

  let minR = Infinity; for (let i = 0; i < N; i++) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(curvS[i])));

  const track = {
    def, N, ds, length: L, halfWidth: halfW, px, pz, tx, tz, nx, nz, heading, curv: curvS,
    wallL, wallR, kerb, gravelL, gravelR, tyreL, tyreR, minSep, minRadius: minR,
    raceE: new Float64Array(N), speed: new Float64Array(N),
    locate(x, z, hint, out = {}) {
      let best = 0, bd = Infinity;
      if (hint == null || hint < 0) {
        for (let i = 0; i < N; i++) {
          const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      } else {
        for (let o = -40; o <= 40; o++) {
          const i = (hint + o + N) % N;
          const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      const dx = x - px[best], dz = z - pz[best];
      const along = dx * tx[best] + dz * tz[best];
      let s = best * ds + along; if (s < 0) s += L; if (s >= L) s -= L;
      out.idx = best; out.s = s; out.lat = dx * nx[best] + dz * nz[best];
      return out;
    },
    // world position from (s, lateral)
    pointAt(s, lat) {
      s = ((s % L) + L) % L;
      const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
      const x = px[i] + (px[j] - px[i]) * t, z = pz[i] + (pz[j] - pz[i]) * t;
      const nxx = nx[i] + (nx[j] - nx[i]) * t, nzz = nz[i] + (nz[j] - nz[i]) * t;
      let h = heading[i] + wrapAngle(heading[j] - heading[i]) * t;
      return { x: x + nxx * lat, z: z + nzz * lat, heading: h };
    },
  };
  return track;
}

export function smoothCircular(a, rad) {
  const N = a.length, out = new Float64Array(N);
  let sum = 0;
  for (let o = -rad; o <= rad; o++) sum += a[(o + N) % N];
  for (let i = 0; i < N; i++) {
    out[i] = sum / (2 * rad + 1);
    sum += a[(i + rad + 1) % N] - a[(i - rad + N) % N];
  }
  return out;
}
function minFilterCircular(a, rad) {
  const N = a.length, out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let m = Infinity;
    for (let o = -rad; o <= rad; o++) m = Math.min(m, a[(i + o + N) % N]);
    out[i] = m;
  }
  return out;
}
