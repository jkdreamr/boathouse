/** Cheap procedural bird calls through WebAudio; created on the first user gesture, silent where audio is unavailable. */
export type CallKind = 'gull' | 'tern' | 'heron' | 'willet' | 'pelican';

export class BirdCalls {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private cool = 0;

  constructor(private muted: () => boolean) {
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      try {
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0.32;
        this.out.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.6);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  tick(dt: number) {
    this.cool -= dt;
  }

  /** Play a call heard from `dist` metres away. Returns false if it was skipped. */
  play(kind: CallKind, dist: number) {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.muted() || ctx.state !== 'running' || this.cool > 0 || dist > 160) return false;
    this.cool = 0.9;
    const g = Math.min(1, 14 / (8 + dist)) ** 1.6;
    const t0 = ctx.currentTime + 0.02 + dist / 343;
    const bus = ctx.createGain();
    bus.gain.value = g;
    // distant calls lose their highs
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 / (1 + dist / 40);
    bus.connect(lp).connect(this.out);
    if (kind === 'gull') {
      const n = 2 + Math.floor(Math.random() * 4);
      const base = 780 + Math.random() * 160;
      for (let i = 0; i < n; i++) this.note(bus, t0 + i * 0.27, 0.22, base * 1.45, base, 'sawtooth', 1350, 2.2, 0.5);
    } else if (kind === 'tern') {
      const f = 1700 + Math.random() * 250;
      this.note(bus, t0, 0.34, f * 1.12, f * 0.86, 'sawtooth', 2400, 1.6, 0.45, 48);
    } else if (kind === 'willet') {
      for (let i = 0; i < 2; i++) this.note(bus, t0 + i * 0.16, 0.11, 2100, 2650, 'triangle', 2400, 1.2, 0.5);
    } else if (kind === 'heron') {
      this.note(bus, t0, 0.45, 210, 150, 'sawtooth', 520, 1.4, 0.7, 31);
      this.hiss(bus, t0, 0.42, 480, 0.4);
    } else {
      this.hiss(bus, t0, 0.3, 300, 0.25);
    }
    return true;
  }

  private note(dst: AudioNode, t: number, dur: number, f0: number, f1: number, type: OscillatorType, bp: number, q: number, peak: number, rasp = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = bp;
    f.Q.value = q;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(peak, t + 0.025);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(e).connect(dst);
    if (rasp > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = rasp;
      const depth = ctx.createGain();
      depth.gain.value = peak * 0.6;
      lfo.connect(depth).connect(e.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dst: AudioNode, t: number, dur: number, bp: number, peak: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = bp;
    f.Q.value = 1.5;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(e).connect(dst);
    s.start(t);
    s.stop(t + dur + 0.05);
  }
}
