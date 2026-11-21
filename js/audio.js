// Synthesised audio: turbo-hybrid V6 style engine, tyre squeal, wind, impacts.
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.bus = comp;
    this.player = this.makeEngine(1.0);
    this.rival = this.makeEngine(0.0);
    // noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.bus); src.start();
      return { f, g };
    };
    this.wind = mkNoise('lowpass', 600, 0.5);
    this.squeal = mkNoise('bandpass', 1800, 9);
    this.gravel = mkNoise('lowpass', 900, 1);
  }

  makeEngine(vol) {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = vol;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 2;
    const pre = ctx.createGain(); pre.gain.value = 0.35;
    const oscs = [
      ['sawtooth', 1, 0.5], ['square', 0.5, 0.25], ['sawtooth', 2, 0.18], ['triangle', 3, 0.12],
    ].map(([type, mult, g]) => {
      const o = ctx.createOscillator(); o.type = type;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(pre); o.start();
      return { o, mult };
    });
    // turbo whistle
    const turbo = ctx.createOscillator(); turbo.type = 'sine';
    const tg = ctx.createGain(); tg.gain.value = 0;
    turbo.connect(tg); tg.connect(out); turbo.start();
    pre.connect(shaper); shaper.connect(lp); lp.connect(out);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { out.connect(pan); pan.connect(this.bus); } else out.connect(this.bus);
    return { out, oscs, lp, pre, turbo, tg, pan };
  }

  setEngine(e, rpm, throttle, vol, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = rpm / 60 * 3 / 2;   // V6 firing frequency halved for body
    for (const { o, mult } of e.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.02);
    e.lp.frequency.setTargetAtTime(900 + throttle * 2600 + rpm * 0.12, t, 0.05);
    e.pre.gain.setTargetAtTime(0.18 + throttle * 0.32, t, 0.04);
    e.out.gain.setTargetAtTime(vol, t, 0.08);
    e.turbo.frequency.setTargetAtTime(2500 + rpm * 0.35, t, 0.1);
    e.tg.gain.setTargetAtTime(throttle * 0.012 * vol, t, 0.1);
    if (e.pan) e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }

  update(player, rival) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = player.phys;
    this.setEngine(this.player, p.rpm, p.throttle, 0.55);
    if (rival) this.setEngine(this.rival, rival.phys.rpm, rival.phys.throttle, rival.vol, rival.pan);
    else this.setEngine(this.rival, 4000, 0, 0);
    const v = Math.abs(p.vx);
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, v * v * 0.00003), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + v * 12, t, 0.1);
    const slide = Math.max(0, Math.max(Math.abs(p.slipR), Math.abs(p.slipF) * 0.8) - 0.09);
    const sq = (p.surfaceName === 'asphalt' || p.surfaceName === 'kerb') && v > 5 ? Math.min(0.22, slide * 2.2) : 0;
    this.squeal.g.gain.setTargetAtTime(sq, t, 0.05);
    const rough = (p.surfaceName === 'gravel' || p.surfaceName === 'grass') ? Math.min(0.4, v * 0.01) : (p.surfaceName === 'kerb' ? Math.min(0.15, v * 0.004) : 0);
    this.gravel.g.gain.setTargetAtTime(rough, t, 0.05);
  }

  impact(strength) {
    if (!this.ctx || strength < 1) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + strength * 40;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, strength * 0.06), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(f); f.connect(g); g.connect(this.bus); src.start(t, Math.random()); src.stop(t + 0.45);
  }

  beep(freq = 880, dur = 0.18) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
