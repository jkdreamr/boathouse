/** Procedural WebAudio: creek ambience, catch/finish sounds. Fails silently where audio is unavailable. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private wash: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
      this.noise = buf;
      const white = ctx.createBuffer(1, len, ctx.sampleRate);
      const wd = white.getChannelData(0);
      for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      this.ambience = ctx.createGain();
      this.ambience.gain.value = 0.22;
      src.connect(lp).connect(this.ambience).connect(this.master);
      src.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.08;
      lfo.connect(lfoGain).connect(this.ambience.gain);
      lfo.start();

      const wsrc = ctx.createBufferSource();
      wsrc.buffer = white;
      wsrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.6;
      this.wash = ctx.createGain();
      this.wash.gain.value = 0;
      wsrc.connect(bp).connect(this.wash).connect(this.master);
      wsrc.start();
      this.noise = white;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Hull hiss scales with boat speed. */
  setSpeed(v: number) {
    if (!this.wash || !this.ctx) return;
    this.wash.gain.setTargetAtTime(Math.min(0.05, v * 0.009), this.ctx.currentTime, 0.3);
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  private clunk(freq: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  catch() {
    this.burst(900, 0.8, 0.35, 0.35);
    this.clunk(160, 0.25);
  }

  finish() {
    this.clunk(240, 0.18);
    this.burst(2600, 0.7, 0.5, 0.2);
  }
}
