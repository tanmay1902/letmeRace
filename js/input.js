// Keyboard, gamepad and touch input -> normalised driver controls.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.pressed = new Set();      // edge-triggered actions this frame
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.usingPad = false;
    this.prevPad = [];
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; el.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
  }

  // returns true once per press
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  update(dt) {
    const k = this.keys, T = this.touch;
    let left = k.has('ArrowLeft') || k.has('KeyA') || T.left;
    let right = k.has('ArrowRight') || k.has('KeyD') || T.right;
    let gas = k.has('ArrowUp') || k.has('KeyW') || T.gas;
    let brk = k.has('ArrowDown') || k.has('KeyS') || k.has('Space') || T.brake;

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null; for (const p of pads) if (p && p.connected) { pad = p; break; }
    let padSteer = null, padGas = 0, padBrake = 0;
    if (pad) {
      const ax = pad.axes[0] || 0;
      const dz = 0.08;
      const a = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
      padGas = pad.buttons[7]?.value || 0; padBrake = pad.buttons[6]?.value || 0;
      if (pad.buttons[0]?.pressed) padGas = Math.max(padGas, 1);
      if (pad.buttons[1]?.pressed) padBrake = Math.max(padBrake, 1);
      if (Math.abs(a) > 0 || padGas > 0.02 || padBrake > 0.02) this.usingPad = true;
      if (this.usingPad) padSteer = -Math.sign(a) * Math.pow(Math.abs(a), 1.4);
      const edge = (i, code) => { const p = !!pad.buttons[i]?.pressed; if (p && !this.prevPad[i]) this.pressed.add(code); this.prevPad[i] = p; };
      edge(5, 'KeyE'); edge(4, 'KeyQ'); edge(3, 'KeyC'); edge(9, 'Escape'); edge(2, 'KeyR'); edge(8, 'KeyR');
    }
    if (left || right || gas || brk) this.usingPad = false;

    if (padSteer !== null && this.usingPad) {
      this.steer = padSteer; this.throttle = padGas; this.brake = padBrake;
    } else {
      // keyboard smoothing: positive steer = left
      const target = (left ? 1 : 0) - (right ? 1 : 0);
      const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 8 : 3.2);
      const d = target - this.steer;
      this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      this.throttle += ((gas ? 1 : 0) - this.throttle) * Math.min(1, dt * 10);
      this.brake += ((brk ? 1 : 0) - this.brake) * Math.min(1, dt * 14);
      if (!gas && this.throttle < 0.01) this.throttle = 0;
      if (!brk && this.brake < 0.01) this.brake = 0;
    }
  }
  endFrame() { this.pressed.clear(); }
}
