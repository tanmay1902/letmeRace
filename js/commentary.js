// Live race commentary: event detection + spoken lines (Web Speech API) + captions.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fill = (s, d) => s.replace(/\{(\w+)\}/g, (_, k) => (d[k] ?? ''));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// Two commentators: a play-by-play lead (L) and an analyst (A).
const LINES = {
  intro: [
    ['L', 'Welcome to {track}. {n} cars on the grid, {laps} laps ahead of us.'],
    ['L', "Good afternoon and welcome to {track}. It's {laps} laps today, and the tension is building."],
    ['L', "We're live at {track}. {laps} laps, {n} drivers, one winner."],
  ],
  introTT: [
    ['L', 'Welcome to {track}. A clear track and a stopwatch. Time to find the limit.'],
    ['L', 'Time trial at {track}. No traffic, no excuses. Just you and the lap.'],
  ],
  lights: [['L', 'The lights are coming on...'], ['L', 'Engines screaming, lights are coming on.']],
  start: [
    ['L', "Lights out, and away we go!"],
    ['L', "And it's lights out! We are racing!"],
    ['L', "Away they go at {track}!"],
  ],
  startTT: [['L', 'And the clock is running!'], ['L', 'Off you go. The lap has started.']],
  goodStart: [['A', 'What a launch! You picked up {n} places off the line!'], ['A', 'Brilliant getaway. Up {n} positions already!']],
  badStart: [['A', "Oh, that's a poor start. You've dropped {n} places."], ['A', 'Bogged down off the line, and that cost you {n} positions.']],
  playerOvertake: [
    ['L', "You're through on {name}! Up to {pos}!"],
    ['L', "Lovely move! {name} is passed, and you're {pos}."],
    ['L', "Down the inside, and that's {pos}! {name} could do nothing about it."],
    ['L', "Past {name}! Now you're up to {pos}."],
    ['A', 'Superb overtake on {name}. That is {pos} now.'],
  ],
  playerOvertaken: [
    ['L', '{name} gets by! You drop to {pos}.'],
    ['L', "Oh, {name} is through. You've lost a place, down to {pos}."],
    ['A', "{name} makes the move stick. You're {pos} now."],
    ['L', "And {name} snatches the position. Down to {pos}."],
  ],
  playerLead: [
    ['L', 'You take the lead! You are leading the race!'],
    ['L', 'Into the lead! P1, and the race is yours to lose!'],
  ],
  leaderChange: [
    ['L', '{name} takes the lead of the race!'],
    ['L', 'A new leader! {name} goes to the front!'],
  ],
  aiOvertake: [
    ['L', '{name} passes {other} for {pos}.'],
    ['A', 'Nice move from {name} on {other}. That is {pos}.'],
    ['L', "And {name} is through on {other}."],
  ],
  chaos: [['L', 'Positions changing everywhere!'], ['L', 'It is frantic out there! Cars going side by side!']],
  battleAhead: [
    ['A', "You're all over the back of {name}. The gap is just {gap} seconds."],
    ['L', "Closing in on {name}! Less than {gap} seconds now."],
    ['A', "{name} is under real pressure. You're right there in the mirrors."],
  ],
  battleBehind: [
    ['A', '{name} is right on your gearbox. Just {gap} seconds behind.'],
    ['L', "Watch your mirrors. {name} is closing in!"],
  ],
  tow: [['A', "You're getting a great tow from {name}. That slipstream is worth a few kilometres an hour."], ['A', 'Tucked into the slipstream of {name}. Free speed!']],
  playerCrash: [
    ['L', "Big impact! You've hit the wall!"],
    ['L', "Ooh! That's a heavy one into the barrier!"],
    ['A', "That'll hurt. Straight into the wall."],
  ],
  playerScrape: [['A', 'Just brushed the wall there. Very close to the limit.'], ['A', 'A little kiss with the barrier. Careful!']],
  playerContact: [['L', 'Contact! You and {name} touched!'], ['L', 'Wheel to wheel, and there is contact with {name}!']],
  aiCrash: [['L', '{name} is in the wall!'], ['L', 'Trouble for {name}! Into the barriers!']],
  playerOff: [
    ['A', "You're off the track! Through the {surface}."],
    ['L', 'Wide! Into the {surface}!'],
    ['A', "Ran out of road there. That's the {surface}."],
  ],
  aiOff: [['L', '{name} runs wide, into the {surface}!'], ['A', '{name} has gone off at that corner.']],
  playerSpin: [['L', "You've spun it! Around you go!"], ['L', "Lost it! A full spin!"], ['A', 'Too much, too soon. And that is a spin.']],
  aiSpin: [['L', '{name} has spun!'], ['L', 'And {name} loses it! A spin!']],
  playerReset: [['A', 'Back on track. Get your head down and go again.']],
  fastestLap: [
    ['L', '{name} sets the fastest lap. {time}.'],
    ['A', 'Fastest lap of the race for {name}, a {time}.'],
  ],
  playerFastest: [
    ['L', "That's the fastest lap of the race! {time}!"],
    ['A', 'Purple sectors everywhere! Fastest lap, {time}.'],
  ],
  playerPB: [['A', 'Personal best for you. {time}.'], ['A', 'Quicker again! A {time}.']],
  playerSlow: [['A', 'A {time}. Some time lost on that one.'], ['A', '{time}. Not the cleanest lap.']],
  record: [['L', "New track record! {time}! Unbelievable pace!"]],
  finalLap: [
    ['L', 'The leader starts the final lap!'],
    ['L', "Final lap here at {track}! It's all on the line!"],
  ],
  halfway: [['A', "We're at half distance. {leader} leads, and you're running {pos}."]],
  lapsToGo: [['L', '{n} laps to go. {leader} leads the way.']],
  win: [
    ['L', "And you win it! Victory at {track}! What a drive!"],
    ['L', "Chequered flag! You are the winner! A fantastic performance!"],
  ],
  podium: [['L', "Across the line in {pos}! That's a podium finish!"], ['L', '{pos} at the flag! On the podium today!']],
  points: [['L', 'You take the chequered flag in {pos}.'], ['L', 'Across the line, {pos}. A solid result.']],
  back: [['L', 'You finish {pos}. A tough day at {track}.'], ['L', '{pos} at the flag. Plenty to learn from that one.']],
  aiWin: [['L', '{name} wins the race at {track}!'], ['L', 'Chequered flag for {name}! Race winner!']],
  ttFinish: [['L', "Session complete. Your best lap: {time}."]],
  topSpeed: [['A', "Look at that top speed! {speed} kilometres an hour!"]],
  wrongWay: [['A', "Er, you're going the wrong way!"]],
  filler: [
    ['A', "Tyre management is going to be key here. They're cooking in these corners."],
    ['A', 'The downforce on these cars is incredible. Over four g in the fast corners.'],
    ['A', 'Braking from over three hundred down to second gear in a few seconds. Remarkable.'],
    ['A', 'Watch the traction out of the slow corners. Easy to overcook it with this much power.'],
    ['L', '{leader} leads, with {second} in second.'],
    ['L', "You're running {pos}. {lapsLeft} laps remaining."],
    ['A', 'Use all the kerb on exit, but stay off the grass. It is like ice out there.'],
    ['A', 'Late on the brakes, smooth on the throttle. That is how you go fast here.'],
  ],
  fillerCity: [
    ['A', 'No margin for error on these streets. Kiss a wall here, and your race is over.'],
    ['A', 'The light is fading over the harbour. What a setting for a street race.'],
    ['A', "Overtaking is tough round here. You've got to be brave on the brakes."],
  ],
  landmark: [
    ['L', 'Flat out past {place}!'],
    ['L', 'Sweeping by {place} now.'],
    ['A', 'Through the {place} section. Tricky little stretch, this one.'],
    ['L', 'And past {place}!'],
  ],
  fillerCampus: [
    ['A', 'The hostel residents have got the best seats in the house today.'],
    ['A', 'From the hostels to the Library, this circuit runs right through the heart of IISER Mohali.'],
    ['A', 'Tight and twisty around the hostel loop. There is no room for mistakes in there.'],
    ['L', 'The Main road straight is the overtaking spot. Get a good exit out of the final corner.'],
    ['A', 'Normally these roads see bicycles and late-night canteen runs. Not three hundred kilometres an hour!'],
  ],
  fillerGP: [
    ['A', 'Big gravel traps around Valle Verde. They will catch anyone who gets it wrong.'],
    ['A', 'That long main straight is the best overtaking chance. Get a good exit and use the tow.'],
  ],
  fillerTT: [
    ['A', 'Smooth inputs. Every hundredth counts.'],
    ['A', 'Hit every apex and let the car run out to the kerb on exit.'],
    ['A', 'Your best so far is {best}. Can you go quicker?'],
  ],
};

export class Commentary {
  constructor() {
    this.mode = 'voice';        // voice | captions | off
    this.queue = [];
    this.speaking = false;
    this.voices = { L: null, A: null };
    this.lastSpoke = 0;
    this.cool = new Map();
    this.captionEl = null;
    this.synth = window.speechSynthesis || null;
    if (this.synth) {
      const load = () => this.pickVoices();
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }

  pickVoices() {
    const all = this.synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!all.length) return;
    const score = (v) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/en-GB/i.test(v.lang) ? 2 : 0) + (/google|microsoft/i.test(v.name) ? 1 : 0);
    const sorted = all.slice().sort((a, b) => score(b) - score(a));
    const male = sorted.find((v) => /male|guy|david|mark|ryan|george|brian|christopher|eric|james|thomas/i.test(v.name) && !/female/i.test(v.name));
    const female = sorted.find((v) => /female|zira|hazel|susan|libby|sonia|aria|jenny|emma|natasha|clara/i.test(v.name));
    this.voices.L = male || sorted[0];
    this.voices.A = (female && female !== this.voices.L) ? female : (sorted.find((v) => v !== this.voices.L) || sorted[0]);
  }

  setMode(m) { this.mode = m; if (m !== 'voice') this.synth?.cancel(); this.render([]); }
  attach(el) { this.captionEl = el; }

  // ---------------------------------------------------------- race lifecycle
  reset(g) {
    this.g = g;
    this.queue = []; this.cool.clear();
    this.synth?.cancel(); this.speaking = false;
    this.t = 0; this.lastSpoke = 0;
    this.prevOrder = null; this.orderT = 0; this.recentPasses = [];
    this.fastest = Infinity; this.track = {};
    this.startPos = null; this.saidTopSpeed = false;
    this.perCar = new Map();
    this.captions = [];
    this.render([]);
    const tt = g.settings.ai === 0;
    this.say(tt ? 'introTT' : 'intro', { track: g.trackName, n: g.cars.length, laps: g.settings.laps }, 3);
  }

  pause() { this.synth?.cancel(); this.speaking = false; this.queue = []; }
  stop() { this.pause(); this.render([]); }

  // ---------------------------------------------------------- explicit events from the game
  onLights() { this.say('lights', {}, 2, 'lights', 30); }
  onStart() {
    const g = this.g;
    this.queue = []; this.synth?.cancel(); this.speaking = false;
    this.say(g.settings.ai === 0 ? 'startTT' : 'start', { track: g.trackName }, 4);
    this.startPos = g.standings().indexOf(g.player) + 1;
    this.startCheckAt = this.t + 6;
  }
  onLap(car, lt, lapsDone) {
    const g = this.g, P = car === g.player;
    const isFastest = lt < this.fastest;
    if (isFastest) this.fastest = lt;
    const time = this.speakTime(lt);
    if (P) {
      if (g.isRecord) this.say('record', { time }, 3);
      else if (isFastest && g.cars.length > 1 && lapsDone > 1) this.say('playerFastest', { time }, 2);
      else if (lt <= car.best + 0.001 && lapsDone > 1) this.say('playerPB', { time }, 1);
      else if (lapsDone > 1 && lt > car.best + 1.5) this.say('playerSlow', { time }, 0, 'slow', 60);
    } else if (isFastest && lapsDone > 1) {
      this.say('fastestLap', { name: car.name, time }, 1, 'fl', 20);
    }
    // race distance milestones (leader based)
    const order = g.standings();
    if (car === order[0] && !car.finished && g.settings.ai > 0) {
      const laps = g.settings.laps, left = laps - lapsDone;
      if (left === 1) this.say('finalLap', { track: g.trackName }, 3);
      else if (laps >= 5 && lapsDone === Math.floor(laps / 2)) this.say('halfway', { leader: this.nm(order[0]), pos: ordinal(order.indexOf(g.player) + 1) }, 1);
      else if (left > 1 && left <= 3 && laps >= 5) this.say('lapsToGo', { n: left, leader: this.nm(order[0]) }, 1);
    }
  }
  onFinish(car, pos) {
    const g = this.g;
    if (g.settings.ai === 0) { if (car === g.player) this.say('ttFinish', { time: this.speakTime(car.best) }, 4); return; }
    if (car === g.player) {
      this.queue = []; this.synth?.cancel(); this.speaking = false;
      const n = g.cars.length;
      const key = pos === 1 ? 'win' : pos <= 3 ? 'podium' : pos <= Math.ceil(n / 2) ? 'points' : 'back';
      this.say(key, { pos: ordinal(pos), track: g.trackName }, 4);
    } else if (pos === 1) {
      this.say('aiWin', { name: car.name, track: g.trackName }, 3);
    }
  }
  onImpact(car, strength, other) {
    const g = this.g, P = car === g.player;
    if (other) {
      if (P || other === g.player) this.say('playerContact', { name: (P ? other : car).name }, 2, 'contact', 12);
      return;
    }
    if (P) {
      if (strength > 14) this.say('playerCrash', {}, 3, 'crash', 8);
      else if (strength > 5) this.say('playerScrape', {}, 1, 'scrape', 25);
    } else if (strength > 16) this.say('aiCrash', { name: car.name }, 1, 'aicrash' + car.k, 20);
  }
  onReset(car) { if (car === this.g.player) this.say('playerReset', {}, 1, 'reset', 30); }
  onWrongWay() { this.say('wrongWay', {}, 2, 'wrong', 20); }

  // ---------------------------------------------------------- continuous detection
  update(dt) {
    const g = this.g; if (!g) return;
    this.t += dt;
    if (g.state === 'racing' || g.state === 'finished') this.detect(dt);
    this.pump();
  }

  detect(dt) {
    const g = this.g, P = g.player, multi = g.cars.length > 1;
    const order = g.standings();
    const myPos = order.indexOf(P) + 1;

    // start result
    if (this.startCheckAt && this.t > this.startCheckAt) {
      this.startCheckAt = 0;
      const d = this.startPos - myPos;
      if (multi && d >= 2) this.say('goodStart', { n: d }, 2);
      else if (multi && d <= -2) this.say('badStart', { n: -d }, 2);
    }

    // overtakes (sampled)
    this.orderT -= dt;
    if (multi && this.orderT <= 0) {
      this.orderT = 0.4;
      if (this.prevOrder) {
        const prevIdx = new Map(this.prevOrder.map((c, i) => [c, i]));
        let aiPasses = 0;
        order.forEach((c, i) => {
          const was = prevIdx.get(c);
          if (was === undefined || i >= was || c.finished) return;
          const passed = this.prevOrder[i];       // car that held this spot before
          if (!passed || passed.finished) return;
          if (c === P) {
            if (i === 0) this.say('playerLead', {}, 3, 'lead', 6);
            else this.say('playerOvertake', { name: passed.name, pos: ordinal(i + 1) }, 3, 'pass', 3);
          } else if (passed === P) {
            this.say('playerOvertaken', { name: c.name, pos: ordinal(myPos) }, 3, 'passed', 3);
          } else {
            aiPasses++;
            if (i === 0) this.say('leaderChange', { name: c.name }, 2, 'leaderchg', 8);
            else if (i < 5) this.say('aiOvertake', { name: c.name, other: passed.name, pos: ordinal(i + 1) }, 0, 'aipass', 12);
          }
        });
        const now = this.t;
        this.recentPasses = this.recentPasses.filter((t) => now - t < 4);
        for (let k = 0; k < aiPasses; k++) this.recentPasses.push(now);
        if (this.recentPasses.length >= 4) { this.say('chaos', {}, 1, 'chaos', 25); this.recentPasses = []; }
      }
      this.prevOrder = order.slice();
    }

    // battles with car ahead / behind
    if (multi && !P.finished) {
      const v = Math.max(20, Math.abs(P.phys.vx));
      const ahead = order[myPos - 2], behind = order[myPos];
      const st = this.st(P);
      if (ahead && !ahead.finished) {
        const gap = (ahead.prog - P.prog) / v;
        st.battleA = gap < 0.7 ? st.battleA + dt : 0;
        if (st.battleA > 4) { this.say('battleAhead', { name: ahead.name, gap: gap.toFixed(1) }, 1, 'battleA', 30); st.battleA = 0; }
      }
      if (behind && !behind.finished) {
        const gap = (P.prog - behind.prog) / v;
        st.battleB = gap < 0.5 ? st.battleB + dt : 0;
        if (st.battleB > 5) { this.say('battleBehind', { name: behind.name, gap: gap.toFixed(1) }, 1, 'battleB', 35); st.battleB = 0; }
      }
      // slipstream
      st.tow = P.phys.draft < 0.86 && v > 50 ? st.tow + dt : 0;
      if (st.tow > 1.5 && ahead) { this.say('tow', { name: ahead.name }, 0, 'tow', 45); st.tow = 0; }
    }

    // top speed
    const kph = Math.abs(P.phys.vx) * 3.6;
    if (!this.saidTopSpeed && kph > 318) { this.saidTopSpeed = true; this.say('topSpeed', { speed: Math.round(kph) }, 0); }

    // off-track and spins for every car
    for (const c of g.cars) {
      if (c.finished) continue;
      const st = this.st(c), p = c.phys, isP = c === P;
      const off = (p.surfaceName === 'grass' || p.surfaceName === 'gravel') && Math.abs(p.vx) > 14;
      st.off = off ? st.off + dt : 0;
      if (st.off > 0.35 && !st.offSaid) {
        st.offSaid = true;
        if (isP) this.say('playerOff', { surface: p.surfaceName }, 2, 'off', 10);
        else if (order.indexOf(c) < 6) this.say('aiOff', { name: c.name, surface: p.surfaceName }, 0, 'aioff', 15);
      }
      if (!off && st.off === 0) st.offSaid = false;
      const hd = Math.atan2(Math.sin(p.h - g.track.heading[c.loc.idx]), Math.cos(p.h - g.track.heading[c.loc.idx]));
      const spinning = Math.abs(hd) > 1.4 && Math.abs(p.r) > 1.2;
      if (spinning && !st.spun) {
        st.spun = true;
        if (isP) this.say('playerSpin', {}, 3, 'spin', 8);
        else this.say('aiSpin', { name: c.name }, 1, 'aispin', 15);
      }
      if (Math.abs(hd) < 0.4) st.spun = false;
    }

    // landmark call-outs (campus buildings etc.)
    const lm = g.track.landmarks;
    if (lm && !this.speaking && !this.queue.length && this.t - this.lastSpoke > 5) {
      for (const L of lm) {
        if (Math.hypot(L.x - P.phys.x, L.z - P.phys.z) > 45) continue;
        this.say('landmark', { place: /^(Hostel|Academic|Community|Shopping|Sports)/.test(L.name) ? L.name : 'the ' + L.name }, 0, 'lm:' + L.name, 120);
        break;
      }
    }

    // filler when it goes quiet
    if (this.t - this.lastSpoke > 14 && !this.speaking && !this.queue.length && g.state === 'racing') {
      const tt = g.settings.ai === 0;
      const local = g.settings.track === 'city' ? LINES.fillerCity : g.settings.track === 'iiser' ? LINES.fillerCampus : LINES.fillerGP;
      const pool = tt ? LINES.fillerTT.concat(local) : LINES.filler.concat(local, local);
      const line = pick(pool);
      const d = {
        leader: this.nm(order[0]), second: order[1] ? this.nm(order[1]) : '', pos: ordinal(myPos),
        lapsLeft: Math.max(1, g.settings.laps - Math.max(0, P.lapsDone)),
        best: isFinite(P.best) ? this.speakTime(P.best) : 'still to come',
      };
      if (tt && line[1].includes('{best}') && !isFinite(P.best)) return;
      this.enqueue(line[0], fill(line[1], d), 0);
    }
  }

  st(c) {
    if (!this.perCar.has(c)) this.perCar.set(c, { battleA: 0, battleB: 0, tow: 0, off: 0, offSaid: false, spun: false });
    return this.perCar.get(c);
  }
  nm(c) { return c === this.g.player ? 'you' : c.name; }
  speakTime(t) {
    if (!isFinite(t)) return '';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m > 0 ? `${m} minute ${s.toFixed(2)}` : `${s.toFixed(2)} seconds`;
  }

  // ---------------------------------------------------------- output
  say(key, data, prio = 1, coolKey = null, coolSec = 0) {
    if (this.mode === 'off') return;
    if (coolKey) {
      const until = this.cool.get(coolKey) || -1;
      if (this.t < until) return;
      this.cool.set(coolKey, this.t + coolSec);
    }
    const [who, text] = pick(LINES[key]);
    this.enqueue(who, fill(text, data), prio);
  }

  enqueue(who, text, prio) {
    const item = { who, text, prio, t: this.t };
    // an urgent line may cut off low-priority chatter
    if (this.speaking && this.current && prio >= 3 && this.current.prio <= 1) { this.synth?.cancel(); this.speaking = false; }
    this.queue.push(item);
    if (this.queue.length > 6) this.queue.sort((a, b) => b.prio - a.prio).length = 6;
  }

  pump() {
    if (this.mode === 'off') { this.queue = []; return; }
    // expire stale lines
    this.queue = this.queue.filter((q) => this.t - q.t < (q.prio >= 3 ? 7 : q.prio >= 2 ? 5 : 3.5));
    const voice = this.mode === 'voice' && this.synth;
    if (this.speaking) {
      // safety: captions-only mode or a stuck engine
      if (!voice || this.t - this.speakStart > 12) this.speaking = false; else return;
    }
    if (!voice && this.t - this.lastSpoke < 2.2) return;
    if (!this.queue.length) return;
    this.queue.sort((a, b) => b.prio - a.prio || a.t - b.t);
    const item = this.queue.shift();
    this.current = item;
    this.lastSpoke = this.t; this.speakStart = this.t;
    this.caption(item);
    if (voice) {
      const u = new SpeechSynthesisUtterance(item.text);
      const v = this.voices[item.who];
      if (v) u.voice = v;
      const excited = item.prio >= 3;
      u.rate = item.who === 'L' ? (excited ? 1.18 : 1.08) : 1.0;
      u.pitch = item.who === 'L' ? (excited ? 1.15 : 1.0) : 0.9;
      u.volume = 1;
      this.speaking = true;
      u.onend = u.onerror = () => { if (this.current === item) { this.speaking = false; this.lastSpoke = this.t; } };
      this.synth.speak(u);
    }
  }

  caption(item) {
    this.captions.push({ ...item, at: performance.now() });
    if (this.captions.length > 3) this.captions.shift();
    this.render(this.captions);
  }
  render(list) {
    const el = this.captionEl; if (!el) return;
    if (this.mode === 'off') { el.innerHTML = ''; return; }
    el.innerHTML = list.map((c, i) =>
      `<div class="cap ${i === list.length - 1 ? 'now' : ''}"><span class="who ${c.who}">${c.who === 'L' ? 'COMMENTARY' : 'ANALYST'}</span>${c.text}</div>`).join('');
  }
  tick() {
    // fade old captions
    if (!this.captionEl || !this.captions?.length) return;
    const now = performance.now();
    const keep = this.captions.filter((c) => now - c.at < 9000);
    if (keep.length !== this.captions.length) { this.captions = keep; this.render(keep); }
  }
}
