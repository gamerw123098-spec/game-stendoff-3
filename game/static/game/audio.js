// Все звуки синтезируются на лету, поэтому файлы со звуками не нужны.
// Выстрел собирается из нескольких слоёв: щелчок, хлопок, низкий удар, механика и эхо.
// Чем дальше источник, тем тише, глуше и «гулче» звук: так проще понять, где стреляют.

const WEAPON_SOUNDS = {
  // crack: высокий хлопок, body: середина, thump: низ (Гц), length: длина хвоста, mech: звук затвора
  rifle: { crack: 3200, body: 900, thump: 85, gain: 0.55, length: 0.22, mech: 'bolt' },
  carbine: { crack: 2600, body: 700, thump: 70, gain: 0.62, length: 0.26, mech: 'bolt' },
  smg: { crack: 3800, body: 1300, thump: 110, gain: 0.42, length: 0.14, mech: 'tick' },
  sniper: { crack: 2200, body: 500, thump: 52, gain: 0.95, length: 0.55, mech: 'action' },
  pistol: { crack: 4200, body: 1500, thump: 130, gain: 0.45, length: 0.16, mech: 'slide' },
  magnum: { crack: 2400, body: 650, thump: 62, gain: 0.85, length: 0.38, mech: 'none' },
  knife: { swish: true, gain: 0.22 },
  tac_pistol: { crack: 2600, body: 700, thump: 90, gain: 0.16, length: 0.09, mech: 'slide', quiet: true },
  auto_pistol: { crack: 4400, body: 1600, thump: 140, gain: 0.38, length: 0.12, mech: 'tick' },
  heavy_pistol: { crack: 2300, body: 620, thump: 60, gain: 0.8, length: 0.34, mech: 'slide' },
  smg2: { crack: 3500, body: 1150, thump: 105, gain: 0.44, length: 0.15, mech: 'tick' },
  pdw: { crack: 4100, body: 1400, thump: 120, gain: 0.4, length: 0.13, mech: 'tick' },
  shotgun: { crack: 1800, body: 420, thump: 48, gain: 1.0, length: 0.5, mech: 'pump' },
  auto_shotgun: { crack: 1900, body: 460, thump: 52, gain: 0.95, length: 0.42, mech: 'bolt' },
  bullpup: { crack: 3000, body: 850, thump: 82, gain: 0.55, length: 0.22, mech: 'bolt' },
  battle: { crack: 2100, body: 600, thump: 62, gain: 0.72, length: 0.32, mech: 'bolt' },
  dmr: { crack: 2000, body: 560, thump: 56, gain: 0.85, length: 0.42, mech: 'bolt' },
  heavy_sniper: { crack: 1500, body: 380, thump: 40, gain: 1.15, length: 0.75, mech: 'action' },
  lmg: { crack: 2400, body: 700, thump: 68, gain: 0.66, length: 0.26, mech: 'tick' },
};

const SHOT_SAMPLES = {
  pistol: 'shot-pistol', tac_pistol: 'shot-pistol', auto_pistol: 'shot-pistol',
  magnum: 'shot-pistol', heavy_pistol: 'shot-pistol',
  shotgun: 'shot-shotgun', auto_shotgun: 'shot-shotgun',
  rifle: 'shot-rifle', carbine: 'shot-rifle', bullpup: 'shot-rifle',
  battle: 'shot-rifle', dmr: 'shot-rifle',
  smg: 'shot-rifle', smg2: 'shot-rifle', pdw: 'shot-rifle', lmg: 'shot-rifle',
  sniper: 'demo-single-shot', heavy_sniper: 'demo-single-shot',
};

const RELOADS = {
  // Последовательность звуков перезарядки по времени (секунды)
  rifle: [[0.25, 'magOut'], [1.3, 'magIn'], [1.85, 'bolt']],
  carbine: [[0.3, 'magOut'], [1.4, 'magIn'], [2.0, 'bolt']],
  smg: [[0.2, 'magOut'], [1.2, 'magIn'], [1.75, 'bolt']],
  sniper: [[0.4, 'magOut'], [1.8, 'magIn'], [2.5, 'action']],
  pistol: [[0.15, 'magOut'], [0.8, 'magIn'], [1.15, 'slide']],
  magnum: [[0.3, 'magOut'], [1.2, 'magIn'], [1.9, 'click']],
  tac_pistol: [[0.2, 'magOut'], [0.85, 'magIn'], [1.25, 'slide']],
  auto_pistol: [[0.2, 'magOut'], [0.95, 'magIn'], [1.4, 'slide']],
  heavy_pistol: [[0.25, 'magOut'], [1.1, 'magIn'], [1.7, 'slide']],
  smg2: [[0.25, 'magOut'], [1.3, 'magIn'], [1.85, 'bolt']],
  pdw: [[0.3, 'magOut'], [1.6, 'magIn'], [2.2, 'bolt']],
  // Дробовик заряжают по одному патрону
  shotgun: [[0.3, 'shell'], [0.75, 'shell'], [1.2, 'shell'], [1.65, 'shell'], [2.1, 'shell'], [2.6, 'pump']],
  auto_shotgun: [[0.35, 'magOut'], [1.8, 'magIn'], [2.6, 'bolt']],
  bullpup: [[0.3, 'magOut'], [1.4, 'magIn'], [2.0, 'bolt']],
  battle: [[0.3, 'magOut'], [1.5, 'magIn'], [2.2, 'bolt']],
  dmr: [[0.35, 'magOut'], [1.6, 'magIn'], [2.3, 'bolt']],
  heavy_sniper: [[0.45, 'magOut'], [2.0, 'magIn'], [2.9, 'action']],
  lmg: [[0.4, 'click'], [1.0, 'magOut'], [2.6, 'magIn'], [3.6, 'click'], [4.1, 'bolt']],
};

export class Sfx {
  constructor(volume = 0.5) {
    this.ctx = null;
    this.volume = volume;
    this.muted = false;
    this.actions = new Map();
  }

  /** Браузер разрешает звук только после действия пользователя (клика). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.ctx = new AudioCtor();

    // Общая громкость и мягкий ограничитель, чтобы взрывы не хрипели.
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);

    // Browsers may suspend an idle audio context (tab switching, power saving).
    // Resume it on the next real user gesture instead of silently losing SFX.
    const resume = () => {
      if (this.ctx?.state !== 'running') this.ctx?.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resume();
    });

    // Эхо площадки: импульсная характеристика генерируется из затухающего шума.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 3.2);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    const length = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.samples = {};
    this.loadSamples();
  }

  async loadSamples() {
    const files = [
      ['shot-rifle', 'shot-rifle.wav'], ['shot-pistol', 'shot-pistol.wav'],
      ['shot-shotgun', 'shot-shotgun.wav'], ['demo-single-shot', 'demo-single-shot.wav'],
      ['bomb-explosion', 'bomb-explosion.mp3'], ['bomb-defuse', 'bomb-defuse.mp3'],
      ['footstep', 'footstep.ogg'],
    ];
    await Promise.all(files.map(async ([name, filename]) => {
      try {
        const response = await fetch(`/static/game/sounds/${filename}`);
        if (!response.ok) return;
        this.samples[name] = await this.ctx.decodeAudioData(await response.arrayBuffer());
      } catch { /* use synthesized fallback if an asset cannot be decoded */ }
    }));
  }

  playSample(name, gain, distance, pan, maxDuration = Infinity, playbackRate = 1, wet = 0.18) {
    const buffer = this.samples?.[name];
    if (!buffer || !this.ctx) return false;
    const source = this.ctx.createBufferSource();
    const envelope = this.ctx.createGain();
    const duration = Math.min(buffer.duration, maxDuration / playbackRate);
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const bus = this._bus(gain, { distance, pan, wet });
    source.connect(envelope);
    envelope.connect(bus);
    const now = this.ctx.currentTime;
    const fade = Math.min(0.075, duration * 0.2);
    envelope.gain.setValueAtTime(1, now);
    envelope.gain.setValueAtTime(1, now + duration - fade);
    envelope.gain.linearRampToValueAtTime(0.001, now + duration);
    source.addEventListener('ended', () => {
      source.disconnect(); envelope.disconnect();
      this._releaseBus(bus);
    }, { once: true });
    source.start(now, 0, duration);
    this._holdBus(bus);
    return true;
  }

  _holdBus(bus) {
    bus._audioRefs = (bus._audioRefs || 0) + 1;
    clearTimeout(bus._audioCleanup);
  }

  _releaseBus(bus) {
    bus._audioRefs = Math.max(0, (bus._audioRefs || 0) - 1);
    if (bus._audioRefs) return;
    bus._audioCleanup = setTimeout(() => {
      if (bus._audioRefs) return;
      for (const node of bus._audioNodes || [bus]) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    }, 300);
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        // Первые отражения плотнее, дальше длинный тихий хвост.
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay * (i < rate * 0.01 ? 0.3 : 1);
      }
    }
    return buffer;
  }

  setVolume(value) {
    this.volume = value;
    if (this.master) this.master.gain.value = this.muted ? 0 : value;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /**
   * Выход для одного звука: громкость, панорама, глушение высоких частот и эхо по расстоянию.
   * distance в метрах, pan от -1 (слева) до 1 (справа).
   */
  _bus(gain, { distance = 0, pan = 0, wet = 0.15 } = {}) {
    const t = this.ctx.currentTime;
    const input = this.ctx.createGain();
    input.gain.value = gain / (1 + distance / 12);

    const muffle = this.ctx.createBiquadFilter();
    input._audioNodes = [input, muffle];
    muffle.type = 'lowpass';
    muffle.frequency.setValueAtTime(Math.max(900, 18000 / (1 + distance / 6)), t);
    input.connect(muffle);

    let last = muffle;
    if (pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      input._audioNodes.push(panner);
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      muffle.connect(panner);
      last = panner;
    }
    last.connect(this.master);

    // Далёкие выстрелы слышны в основном эхом.
    const send = this.ctx.createGain();
    input._audioNodes.push(send);
    send.gain.value = Math.min(0.9, wet + distance / 60);
    last.connect(send);
    send.connect(this.reverb);
    return input;
  }

  _noise(out, { type = 'bandpass', freq = 1000, q = 0.8, length = 0.1, attack = 0.001, gain = 1, sweepTo = null, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + length);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter);
    filter.connect(env);
    env.connect(out);
    this._holdBus(out);
    source.addEventListener('ended', () => {
      source.disconnect(); filter.disconnect(); env.disconnect();
      this._releaseBus(out);
    }, { once: true });
    source.start(t, Math.random() * 1.5, length + 0.05);
  }

  _tone(out, { from, to = from, length = 0.1, gain = 1, type = 'sine', delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + length);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(env);
    env.connect(out);
    this._holdBus(out);
    osc.addEventListener('ended', () => {
      osc.disconnect(); env.disconnect();
      this._releaseBus(out);
    }, { once: true });
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  // ---------- Механика оружия ----------
  _mech(out, kind, delay = 0) {
    const click = (freq, at, gain = 0.5, length = 0.03) =>
      this._noise(out, { type: 'highpass', freq, q: 0.7, length, gain, delay: delay + at });
    switch (kind) {
      case 'bolt': // затвор отходит и возвращается
        click(3500, 0.0, 0.25);
        click(2600, 0.045, 0.3);
        break;
      case 'tick':
        click(4500, 0.0, 0.18, 0.02);
        break;
      case 'slide':
        click(3000, 0.0, 0.35);
        this._tone(out, { from: 900, to: 500, length: 0.05, gain: 0.08, type: 'triangle', delay: delay + 0.03 });
        click(2400, 0.07, 0.4);
        break;
      case 'action': // винтовка с ручным затвором
        click(1800, 0.0, 0.4, 0.05);
        this._noise(out, { freq: 1400, q: 1.2, length: 0.12, gain: 0.25, sweepTo: 2600, delay: delay + 0.05 });
        click(2200, 0.22, 0.45, 0.05);
        break;
      case 'magOut':
        click(1600, 0.0, 0.45, 0.06);
        this._noise(out, { freq: 900, q: 2, length: 0.12, gain: 0.25, sweepTo: 600, delay: delay + 0.04 });
        break;
      case 'magIn':
        this._noise(out, { freq: 700, q: 1.5, length: 0.1, gain: 0.3, sweepTo: 1300, delay });
        click(2300, 0.1, 0.6, 0.05);
        break;
      case 'click':
        click(3000, 0.0, 0.5);
        break;
      case 'shell': // патрон в трубчатый магазин
        click(2200, 0.0, 0.4, 0.04);
        this._tone(out, { from: 700, to: 420, length: 0.06, gain: 0.08, type: 'triangle', delay: delay + 0.02 });
        break;
      case 'pump': // помпа назад и вперёд
        this._noise(out, { freq: 900, q: 1.4, length: 0.09, gain: 0.45, sweepTo: 1800, delay });
        click(2600, 0.1, 0.55, 0.04);
        this._noise(out, { freq: 1600, q: 1.4, length: 0.08, gain: 0.4, sweepTo: 900, delay: delay + 0.16 });
        click(3200, 0.25, 0.6, 0.04);
        break;
      default:
    }
  }

  // ---------- Выстрелы ----------
  shot(kind, distance = 0, pan = 0) {
    if (!this.ctx) return;
    const sound = WEAPON_SOUNDS[kind] || WEAPON_SOUNDS.rifle;
    if (sound.swish) {
      this.knife(distance, pan);
      return;
    }
    const sample = SHOT_SAMPLES[kind] || 'shot-rifle';
    // Limit each clip to one report so a single trigger press cannot replay a burst.
    const shotLength = kind.includes('shotgun') ? 0.48
      : ['sniper', 'heavy_sniper', 'magnum', 'heavy_pistol'].includes(kind) ? 0.4
        : 0.3;
    if (this.playSample(sample, sound.gain * 0.58, distance, pan, shotLength, 1, 0.06)) {
      return;
    }
    const out = this._bus(sound.gain * (0.92 + Math.random() * 0.16), { distance, pan, wet: sound.quiet ? 0.05 : 0.22 });
    const vary = 0.94 + Math.random() * 0.12;
    if (sound.quiet) {
      // С глушителем: глухой хлопок и звон затвора, без грохота.
      this._noise(out, { freq: sound.body, q: 1.2, length: 0.08, gain: 1.2, sweepTo: sound.body * 0.5 });
      if (distance < 8) this._mech(out, sound.mech, 0.02);
      return;
    }
    // 1. Резкий щелчок в первые миллисекунды
    this._noise(out, { type: 'highpass', freq: sound.crack * vary, q: 0.6, length: 0.035, gain: 1.4 });
    // 2. Основной хлопок
    this._noise(out, { freq: sound.body * vary, q: 0.9, length: sound.length * 0.6, gain: 1.3, sweepTo: sound.body * 0.35 });
    // 3. Низкий удар, который чувствуется «в груди»
    this._tone(out, { from: sound.thump * 2.2, to: sound.thump * 0.6, length: sound.length * 0.7, gain: 1.1 });
    this._noise(out, { type: 'lowpass', freq: 400, q: 0.5, length: sound.length, gain: 0.8 });
    // 4. Механика затвора слышна только вблизи
    const mechDelay = { sniper: 0.45, heavy_sniper: 0.6, shotgun: 0.25 }[kind] ?? 0.035;
    if (distance < 6 && sound.mech !== 'none') this._mech(out, sound.mech, mechDelay);
  }

  /** Пуля пролетела рядом: короткий свист. */
  whiz(pan = 0) {
    if (!this.ctx) return;
    const out = this._bus(0.35, { pan, wet: 0.02 });
    this._noise(out, { freq: 5000, q: 6, length: 0.14, gain: 0.9, sweepTo: 1800, attack: 0.02 });
  }

  /** Шипение баллончика с краской и стук шарика внутри. */
  spray(distance = 0, pan = 0) {
    if (!this.ctx || distance > 30) return;
    const out = this._bus(0.32, { distance, pan, wet: 0.04 });
    this._noise(out, { type: 'highpass', freq: 3200, q: 0.6, length: 0.38, gain: 0.8, attack: 0.03 });
    this._noise(out, { freq: 6500, q: 1.5, length: 0.32, gain: 0.35, attack: 0.05, sweepTo: 5200 });
    this._noise(out, { freq: 2600, q: 8, length: 0.03, gain: 0.5, delay: 0.42 });
    this._noise(out, { freq: 2600, q: 8, length: 0.03, gain: 0.4, delay: 0.5 });
  }

  knife(distance = 0, pan = 0) {
    if (!this.ctx) return;
    const out = this._bus(0.3, { distance, pan, wet: 0.05 });
    this._noise(out, { freq: 1800, q: 2.5, length: 0.2, gain: 1, sweepTo: 4500, attack: 0.04 });
  }

  impact(material, distance = 0, pan = 0) {
    if (!this.ctx || distance > 40) return;
    const out = this._bus(0.18, { distance, pan, wet: 0.1 });
    if (material === 'flesh') {
      this._noise(out, { type: 'lowpass', freq: 600, length: 0.09, gain: 1 });
      this._tone(out, { from: 160, to: 70, length: 0.08, gain: 0.6 });
    } else if (material === 'metal') {
      this._tone(out, { from: 2100 + Math.random() * 600, to: 1700, length: 0.25, gain: 0.35, type: 'triangle' });
      this._noise(out, { type: 'highpass', freq: 3500, length: 0.05, gain: 0.6 });
    } else {
      this._noise(out, { freq: 1800, q: 1, length: 0.07, gain: 0.8 });
      this._noise(out, { type: 'highpass', freq: 5000, length: 0.12, gain: 0.25, delay: 0.02 }); // осыпается крошка
    }
  }

  // ---------- Шаги и движение ----------
  step(distance, pan, loud = 1) {
    if (!this.ctx || distance > 26) return;
    // Use the supplied, natural footstep recording, but crop its trailing
    // voice/noise. Slight pitch variation keeps repeated steps from sounding identical.
    const proximity = Math.max(0.08, (1 + distance / 8) ** -1.45);
    const gain = 0.78 * loud * proximity;
    if (this.playSample('footstep', gain, distance, pan, 0.3, 0.94 + Math.random() * 0.12, 0.035)) return;
    const out = this._bus(0.58 * loud * proximity, { distance, pan, wet: 0.03 });
    const vary = 0.85 + Math.random() * 0.3;
    // Пятка и подошва
    this._noise(out, { type: 'lowpass', freq: 380 * vary, length: 0.06, gain: 1 });
    this._noise(out, { freq: 2200 * vary, q: 1.2, length: 0.05, gain: 0.35, delay: 0.025 });
  }

  defuse(distance = 0, pan = 0) {
    if (!this.ctx) return;
    if (this.playSample('bomb-defuse', 0.8, distance, pan, Infinity, 1, 0.05)) return;
    this.beep(true);
  }

  plant(distance = 0, pan = 0) {
    if (!this.ctx) return;
    const out = this._bus(0.48, { distance, pan, wet: 0.04 });
    this._noise(out, { type: 'highpass', freq: 2400, length: 0.045, gain: 0.5 });
    this._noise(out, { type: 'lowpass', freq: 620, length: 0.16, gain: 0.55, sweepTo: 180 });
    this._tone(out, { from: 760, to: 1180, length: 0.2, gain: 0.24, type: 'triangle', delay: 0.08 });
  }

  startBombAction(id, kind, distance = 0, pan = 0) {
    const active = this.actions.get(id);
    if (active?.kind === kind) return;
    this.stopBombAction(id);
    if (!this.ctx) return;
    if (kind === 1) {
      this.plant(distance, pan);
      this.actions.set(id, { kind, source: null });
      return;
    }
    if (kind !== 2) return;

    const buffer = this.samples?.['bomb-defuse'];
    if (!buffer) {
      this.beep(true);
      this.actions.set(id, { kind, source: null });
      return;
    }
    const source = this.ctx.createBufferSource();
    const bus = this._bus(0.8, { distance, pan, wet: 0.05 });
    source.buffer = buffer;
    source.connect(bus);
    this._holdBus(bus);
    source.addEventListener('ended', () => {
      source.disconnect();
      this._releaseBus(bus);
      const current = this.actions.get(id);
      if (current?.source === source) current.source = null;
    }, { once: true });
    this.actions.set(id, { kind, source });
    source.start();
  }

  stopBombAction(id) {
    const active = this.actions.get(id);
    this.actions.delete(id);
    if (!active?.source) return;
    try { active.source.stop(); } catch { /* sample already ended */ }
  }

  land() {
    if (!this.ctx) return;
    const out = this._bus(0.4, { wet: 0.05 });
    this._noise(out, { type: 'lowpass', freq: 300, length: 0.12, gain: 1 });
    this._noise(out, { freq: 1600, q: 1, length: 0.07, gain: 0.3, delay: 0.03 });
  }

  reload(kind = 'rifle') {
    if (!this.ctx) return;
    const out = this._bus(0.45, { wet: 0.05 });
    for (const [at, part] of RELOADS[kind] || RELOADS.rifle) this._mech(out, part, at);
  }

  draw() {
    if (!this.ctx) return;
    const out = this._bus(0.3, { wet: 0.03 });
    this._noise(out, { freq: 1200, q: 1.5, length: 0.12, gain: 0.5, sweepTo: 2600, attack: 0.03 });
    this._mech(out, 'click', 0.1);
  }

  empty() {
    if (!this.ctx) return;
    this._mech(this._bus(0.4, { wet: 0.02 }), 'click');
  }

  // ---------- Попадания и интерфейс ----------
  hit(head) {
    if (!this.ctx) return;
    const out = this._bus(0.28, { wet: 0 });
    if (head) {
      // Металлический «дзынь» по каске
      this._tone(out, { from: 2600, to: 2500, length: 0.28, gain: 0.5, type: 'triangle' });
      this._tone(out, { from: 3720, to: 3600, length: 0.2, gain: 0.3, type: 'sine' });
    } else {
      this._tone(out, { from: 1300, to: 900, length: 0.06, gain: 0.6, type: 'square' });
    }
  }

  kill() {
    if (!this.ctx) return;
    const out = this._bus(0.2, { wet: 0.05 });
    this._tone(out, { from: 660, to: 660, length: 0.12, gain: 0.6, type: 'triangle' });
    this._tone(out, { from: 990, to: 990, length: 0.22, gain: 0.6, type: 'triangle', delay: 0.09 });
  }

  hurt() {
    if (!this.ctx) return;
    const out = this._bus(0.45, { wet: 0 });
    this._noise(out, { type: 'lowpass', freq: 500, length: 0.18, gain: 1 });
    this._tone(out, { from: 120, to: 60, length: 0.2, gain: 0.7 });
  }

  click() {
    if (!this.ctx) return;
    this._tone(this._bus(0.12, { wet: 0 }), { from: 1800, to: 1500, length: 0.04, gain: 0.5, type: 'triangle' });
  }

  money() {
    if (!this.ctx) return;
    const out = this._bus(0.12, { wet: 0.05 });
    this._tone(out, { from: 1500, to: 1500, length: 0.08, gain: 0.5, type: 'triangle' });
    this._tone(out, { from: 2000, to: 2000, length: 0.15, gain: 0.5, type: 'triangle', delay: 0.07 });
  }

  beep(high) {
    if (!this.ctx) return;
    const out = this._bus(0.16, { wet: 0.1 });
    this._tone(out, { from: high ? 1050 : 760, length: high ? 0.32 : 0.14, gain: 0.7, type: 'square' });
  }

  roundStart() {
    if (!this.ctx) return;
    const out = this._bus(0.18, { wet: 0.2 });
    [523, 659, 784].forEach((freq, i) => this._tone(out, { from: freq, length: 0.35, gain: 0.5, type: 'triangle', delay: i * 0.11 }));
  }

  victory(won) {
    if (!this.ctx) return;
    const out = this._bus(0.22, { wet: 0.3 });
    const notes = won ? [523, 659, 784, 1047] : [440, 392, 349, 262];
    notes.forEach((freq, i) => this._tone(out, { from: freq, length: 0.5, gain: 0.5, type: 'triangle', delay: i * 0.16 }));
  }

  // ---------- Гранаты и бомба ----------
  throwing() {
    if (!this.ctx) return;
    const out = this._bus(0.3, { wet: 0.03 });
    this._mech(out, 'click'); // чека
    this._noise(out, { freq: 900, q: 1.2, length: 0.25, gain: 0.6, sweepTo: 2400, attack: 0.08, delay: 0.08 });
  }

  boom(kind, distance = 0, pan = 0) {
    if (!this.ctx) return;
    if (kind === 'bomb' && this.playSample('bomb-explosion', 1.1, distance, pan)) return;
    if (kind === 'smoke') {
      const out = this._bus(0.35, { distance, pan, wet: 0.1 });
      this._mech(out, 'click');
      this._noise(out, { type: 'highpass', freq: 2500, length: 2.2, gain: 0.5, attack: 0.15, delay: 0.05 });
      return;
    }
    if (kind === 'flash') {
      const out = this._bus(0.9, { distance, pan, wet: 0.35 });
      this._noise(out, { type: 'highpass', freq: 2000, length: 0.25, gain: 1.4 });
      this._tone(out, { from: 200, to: 60, length: 0.3, gain: 0.8 });
      return;
    }
    const big = kind === 'bomb';
    const out = this._bus(big ? 1.6 : 1.1, { distance, pan, wet: big ? 0.6 : 0.4 });
    this._noise(out, { type: 'highpass', freq: 1500, length: 0.08, gain: 1.4 }); // ударная волна
    this._noise(out, { type: 'lowpass', freq: big ? 700 : 1100, length: big ? 2.2 : 1.1, gain: 1.4, sweepTo: 120 });
    this._tone(out, { from: big ? 90 : 120, to: 25, length: big ? 1.8 : 0.9, gain: 1.4 });
    this._noise(out, { freq: 3000, q: 0.8, length: 0.9, gain: 0.25, delay: 0.25 }); // осколки и мусор
  }

  /** Звон в ушах после ослепления. */
  ringing(seconds) {
    if (!this.ctx) return;
    const out = this._bus(0.06, { wet: 0 });
    this._tone(out, { from: 3100, to: 2900, length: Math.max(0.4, seconds), gain: 0.8 });
  }

  tick() {
    if (!this.ctx) return;
    this._tone(this._bus(0.08, { wet: 0 }), { from: 1500, to: 1000, length: 0.025, gain: 1, type: 'square' });
  }
}
