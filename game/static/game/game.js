// Клиент: подключение к серверу, управление, плавное движение других игроков и интерфейс.
import * as THREE from 'three';
import { Sfx } from './audio.js';
import { loadProfile } from './profile.js';
import { Battlefield, Effects, Impacts, PlayerModel, SprayLayer, ViewModel, buildWorld } from './scene.js';
import { chosenSpray } from './sprays.js';
import { askDevice } from './device.js';
import { TouchControls, enterFullscreen } from './touch.js';

const config = JSON.parse(document.getElementById('room-config').textContent);
const $ = (id) => document.getElementById(id);
const TOUCH = (await askDevice()) === 'phone';
const ACTION_NAME = TOUCH ? 'кнопку БОМБА' : 'E';
let touchControls = null;

const RADIUS = 0.35;
const GRAVITY = 18;
const JUMP_SPEED = 6.4;
const HEIGHT_STAND = 1.8;
const HEIGHT_CROUCH = 1.35;
const SEND_INTERVAL = 0.05;
const INTERP_DELAY = 0.1;
const FOV = 78;
const FOV_SCOPED = 20;

// Поля снимка состояния с сервера (см. Room.snapshot)
const F = {
  ID: 0, X: 1, Y: 2, Z: 3, YAW: 4, PITCH: 5, HP: 6, ALIVE: 7, WEAPON: 8, AMMO: 9, RELOAD: 10, CROUCH: 11, TEAM: 12, PROT: 13,
  MONEY: 14, ARMOR: 15, PRIMARY: 16, SECONDARY: 17, BUY: 18,
  HE: 19, FLASH: 20, SMOKE: 21, KIT: 22, ACT: 23, ACT_PROGRESS: 24, LIFE: 25,
};
const THROW_KEYS = { KeyG: 'he', KeyF: 'flash', KeyC: 'smoke' };
// Команда 0 — террористы (оранжевые), команда 1 — антитеррористы (синие).
const TEAM_CLASS = ['t', 'ct'];

function load(key, fallback) {
  try {
    const value = localStorage.getItem(`poligon.${key}`);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(`poligon.${key}`, value);
  } catch {
    // Настройки просто не сохранятся (например, в приватном окне).
  }
}

const settings = {
  sens: Number(load('sens', 1)) || 1,
  volume: Number(load('volume', 0.5)),
  quality: load('quality', TOUCH ? 'low' : 'medium'),
  autoShop: load('autoShop', '1') === '1',
};

const sfx = new Sfx(settings.volume);

const state = {
  ws: null,
  joined: false,
  connected: false,
  welcome: null,
  myId: null,
  weapons: null,
  boxes: [],
  roster: new Map(),
  remotes: new Map(),
  phase: '',
  round: 0,
  winner: -1,
  timeLeft: 0,
  scores: [0, 0],
  serverOffset: null,
  ping: 0,
  latest: null,
  bomb: null, // [состояние: 0 у игрока, 1 на земле, 2 заложена; x; y; z; id носителя; точка]
  attackers: 0,
  hostId: null,
  results: null,
  showResults: false,
  killedBy: null,
  version: 0, // номер последнего полученного важного события
  syncAskedAt: 0,
  sprays: [], // [номер, игрок, рисунок, x, y, z, нормаль x, y, z, поворот, ник]
  nextSpray: 0,
};

const me = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0, punch: 0,
  eye: 1.65,
  crouch: false,
  onGround: true,
  alive: false,
  life: 0,
  hp: 100,
  team: 0,
  weapon: 'pistol',
  lastWeapon: 'knife',
  switchAt: 0,
  pendingWeapon: null, // выбранное оружие, о котором сервер ещё не сообщил
  primary: null,
  secondary: 'pistol',
  armor: 0,
  money: 0,
  buyLeft: 0,
  grenades: { he: 0, flash: 0, smoke: 0 },
  nextThrow: 0,
  kit: false,
  using: false,
  ammo: 0,
  reloading: false,
  scoped: false,
  nextShot: 0,
  firing: false,
  fireHeld: false,
  spread: 0,
  stepPhase: 0,
};

const keys = new Set();
let locked = false;
let everLocked = false;
let shopOpen = false;
let shopPending = false;
let lockedThisMatch = false; // игрок уже вошёл в игру с начала этого матча
let lastSend = 0;
let boardHeld = false;
let cursorFree = false; // игрок отпустил курсор клавишей P: меню при этом не открывается

// ---------- Three.js ----------
let renderer;
let scene;
let camera;
let viewModel;
let effects;
let battlefield;
let impacts;
let muzzleLight;
let muzzleUntil = 0;
let sky;
let sprayLayer;

function pixelRatio() {
  const device = window.devicePixelRatio || 1;
  if (settings.quality === 'low') return TOUCH ? 1 : 0.7; // экран телефона мал: меньше 1 будет мыльно
  if (settings.quality === 'high') return Math.min(device, 2);
  return Math.min(device, 1);
}

/** Размер карты теней: на слабом качестве тени нарисованы заранее и ничего не стоят. */
function shadowSize() {
  if (settings.quality === 'low') return 0;
  return settings.quality === 'high' ? 4096 : 2048; // карты большие: при меньшем размере тени грубые
}

function initGraphics() {
  renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false;
  // Плёночная цветокоррекция: мягкие светлые участки и более живые цвета.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = shadowSize() > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('stage').append(renderer.domElement);

  camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.05, 420);
  camera.rotation.order = 'YXZ';
  viewModel = new ViewModel(camera.aspect);
  // Вспышка выстрела на мгновение освещает всё вокруг.
  muzzleLight = new THREE.PointLight(0xffc27a, 0, 10, 2);
  loadWorld(state.welcome.world);

  renderer.domElement.addEventListener('mousedown', () => {
    if (!locked && !$('hud').hidden) requestLock();
  });
  if (settings.quality === 'high') setupBloom();
}

// ---------- Свечение и сглаживание (только на высоком качестве) ----------
let composer = null;
let renderPass = null;

async function setupBloom() {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('./vendor/jsm/postprocessing/EffectComposer.js'),
      import('./vendor/jsm/postprocessing/RenderPass.js'),
      import('./vendor/jsm/postprocessing/UnrealBloomPass.js'),
      import('./vendor/jsm/postprocessing/OutputPass.js'),
    ]);
    const ratio = renderer.getPixelRatio();
    // Сглаживание в самом буфере: края стен и оружия без «лесенки».
    const target = new THREE.WebGLRenderTarget(window.innerWidth * ratio, window.innerHeight * ratio, {
      type: THREE.HalfFloatType, samples: 4,
    });
    const nextComposer = new EffectComposer(renderer, target);
    renderPass = new RenderPass(scene, camera);
    nextComposer.addPass(renderPass);
    // Яркие места (вспышки, солнце, светящиеся скины) мягко светятся.
    nextComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.45, 0.88));
    nextComposer.addPass(new OutputPass());
    composer = nextComposer;
  } catch (error) {
    // Если видеокарта не умеет такие буферы, играем без свечения.
    console.warn('Свечение отключено:', error);
    composer = null;
  }
}

function renderWorld() {
  if (composer) {
    renderPass.scene = scene;
    composer.render();
  } else {
    renderer.clear();
    renderer.render(scene, camera);
  }
}

/** Строит карту заново: при первом входе и когда ведущий выбрал другую карту. */
function loadWorld(world) {
  for (const remote of state.remotes.values()) {
    if (remote.model) remote.model.dispose();
    remote.model = null;
  }
  scene = new THREE.Scene();
  const built = buildWorld(scene, world, state.welcome.mode, { shadows: shadowSize(), renderer });
  sky = built.sky;
  // Оружие в руках отражает то же небо, что и карта.
  viewModel.scene.environment = built.environment;
  effects = new Effects(scene);
  battlefield = new Battlefield(scene, state.welcome.smokeRadius);
  impacts = new Impacts(scene);
  sprayLayer?.clear();
  sprayLayer = new SprayLayer(scene);
  sprayLayer.reset(state.sprays);
  scene.add(muzzleLight);
  state.boxes = world.boxes;
  buildRadar(world);
}

window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  viewModel.camera.aspect = camera.aspect;
  viewModel.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Сеть ----------
function send(message) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

function connect(name, team, profile) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws/room/${config.code}/`);
  state.ws = ws;
  ws.addEventListener('open', () => send({ t: 'join', name, team, profile }));
  ws.addEventListener('message', (event) => handle(JSON.parse(event.data)));
  ws.addEventListener('close', () => {
    if (state.fatal) return;
    showLost(state.joined
      ? 'Соединение с сервером прервалось. Проверьте, что он запущен и компьютеры в одной сети.'
      : 'Не удалось подключиться к серверу. Возможно, школьная сеть блокирует подключение.');
  });
}

function showLost(reason) {
  setCursorFree(false);
  releaseLock();
  state.connected = false;
  $('overlay').hidden = false;
  $('join-panel').hidden = true;
  $('menu-panel').hidden = true;
  $('lost-panel').hidden = false;
  $('lost-reason').textContent = reason;
}

function handle(msg) {
  if (msg.v !== undefined && msg.t !== 's') state.version = Math.max(state.version, msg.v);
  switch (msg.t) {
    case 'sync': onSync(msg); break;
    case 's': onSnapshot(msg); break;
    case 'welcome': onWelcome(msg); break;
    case 'roster':
      state.hostId = msg.host;
      onRoster(msg.players);
      break;
    case 'spawn': onSpawn(msg); break;
    case 'shot': onShot(msg); break;
    case 'hit': onHit(msg); break;
    case 'kill': onKill(msg); break;
    case 'phase': onPhase(msg); break;
    case 'settings': onSettings(msg); break;
    case 'results': onResults(msg); break;
    case 'boom': onBoom(msg); break;
    case 'bomb': onBombEvent(msg); break;
    case 'spray': onSpray(msg.row); break;
    case 'throw':
      if (msg.id !== state.myId) {
        const thrower = state.remotes.get(msg.id);
        if (thrower) sfx.throwing();
      }
      break;
    case 'reward':
      if (msg.ids.includes(state.myId)) {
        state.hasNewCase = true;
        $('banner-sub').textContent = '+1 кейс! Откройте его в главном меню';
        renderResults();
      }
      break;
    case 'correct':
      me.x = msg.x; me.y = msg.y; me.z = msg.z;
      me.vx = me.vy = me.vz = 0;
      break;
    case 'pong':
      if (msg.c !== null) state.ping = Math.round(performance.now() - msg.c);
      break;
    case 'error':
      state.fatal = true;
      if (state.joined) {
        showLost(msg.msg);
      } else {
        $('join-error').textContent = msg.msg;
        $('join-error').hidden = false;
        $('join-btn').disabled = false;
        $('join-btn').textContent = 'В бой';
      }
      break;
    default:
  }
}

function onWelcome(msg) {
  state.welcome = msg;
  state.myId = msg.id;
  state.weapons = msg.weapons;
  state.version = msg.v;
  state.joined = true;
  state.connected = true;
  state.phase = msg.phase;
  state.results = msg.results;
  state.showResults = !!msg.results;
  state.sprays = msg.sprays || [];
  const loadStart = performance.now();
  initGraphics();
  state.loadMs = Math.round(performance.now() - loadStart);
  if (TOUCH) {
    touchControls = new TouchControls({ parent: $('hud'), look: applyLook, pause: releaseLock });
    $('slots').addEventListener('pointerdown', (event) => {
      const index = [...$('slots').children].indexOf(event.target);
      const code = ['Digit1', 'Digit2', 'Digit3', 'Digit5'][index];
      if (code) document.dispatchEvent(new KeyboardEvent('keydown', { code }));
      if (code) document.dispatchEvent(new KeyboardEvent('keyup', { code }));
    });
  }
  buildSlots();
  // Код виден весь матч, чтобы позвать друга можно было в любой момент.
  const roomCode = document.createElement('div');
  roomCode.id = 'room-code';
  roomCode.textContent = `Код игры: ${config.code}`;
  $('hud').append(roomCode);
  buildHostSettings();
  applyModeUi();
  $('join-panel').hidden = true;
  setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);
  requestAnimationFrame(frame);
  if (inMatch()) {
    $('hud').hidden = false;
    showMenuIfUnlocked();
    if (!TOUCH) requestLock(); // на телефоне нужно нажатие: без него нет ни звука, ни полного экрана
  } else {
    updatePhaseUi();
  }
}

/** Подписи и магазин зависят от режима, поэтому обновляются при каждой смене настроек. */
function applyModeUi() {
  const msg = state.welcome;
  const ffa = msg.flags.ffa;
  $('team-a-name').textContent = ffa ? 'Вы' : msg.teams[0];
  $('team-b-name').textContent = ffa ? 'Лидер' : msg.teams[1];
  $('board-a').textContent = ffa ? 'Игроки' : msg.teams[0];
  $('board-b').textContent = msg.teams[1];
  document.querySelector('.board-cols').classList.toggle('single', ffa);
  $('goal').textContent = `до ${msg.target}`;
  $('wallet').hidden = !msg.flags.shop;
  $('map-note').textContent = `${msg.modeName} · ${msg.world.name}`;
  touchControls?.setMode(msg.flags.shop, msg.mode === 'defuse');
  $('shop-cols').replaceChildren();
  buildShop();
  renderWaiting();
}

function onSettings(msg) {
  // На новой карте старых рисунков нет: сервер их тоже стёр.
  if (msg.world && msg.world.id !== state.welcome.world.id) state.sprays = [];
  Object.assign(state.welcome, msg);
  if (renderer) loadWorld(msg.world);
  impacts?.clear();
  applyModeUi();
}

function onRoster(players, host) {
  state.roster = new Map(players.map((p) => [p.id, p]));
  renderBoard();
  renderWaiting();
}

function inMatch() {
  return state.phase !== 'lobby' && state.phase !== 'end';
}

function onSpawn(msg) {
  const remote = state.remotes.get(msg.id);
  if (remote) remote.buffer.length = 0;
  if (msg.id !== state.myId) return;
  me.x = msg.x; me.y = msg.y; me.z = msg.z;
  me.vx = me.vy = me.vz = 0;
  me.yaw = msg.yaw;
  me.pitch = 0;
  me.punch = 0;
  me.life = msg.life;
  me.alive = true;
  me.crouch = false;
  me.fireHeld = false;
  me.eye = state.welcome.eye[0];
  me.buyLeft = state.welcome.buyTime;
  me.pendingWeapon = null;
  clearDamageArcs();
  state.killedBy = null;
  setScoped(false);
  showHints();
  // Магазин открывается сам. Если игрок сейчас в меню, то сразу после выхода из него.
  if (settings.autoShop) {
    if (locked || !everLocked) openShop();
    else shopPending = true;
  }
}

function ensureRemote(id) {
  let remote = state.remotes.get(id);
  if (!remote) {
    remote = { buffer: [], model: null, view: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, crouch: false, alive: true }, lastX: 0, lastZ: 0, stepPhase: 0 };
    state.remotes.set(id, remote);
  }
  return remote;
}

/**
 * Сервер на перегруженном компьютере иногда теряет сообщения. Снимок несёт номер версии:
 * если мы отстали, просим полную картину. Повторяем не чаще раза в секунду.
 */
function checkVersion(s) {
  if (s.v === undefined || s.v <= state.version) return;
  const nowMs = performance.now();
  if (nowMs - state.syncAskedAt < 1000) return;
  state.syncAskedAt = nowMs;
  send({ t: 'sync' });
}

function onSync(msg) {
  const settings = msg.settings;
  if (settings.world.id !== state.welcome.world.id || settings.mode !== state.welcome.mode
    || settings.target !== state.welcome.target) {
    onSettings(settings);
  }
  state.hostId = msg.roster.host;
  onRoster(msg.roster.players);
  if (msg.results && msg.phase.ph === 'end' && !state.results) {
    state.results = msg.results;
    state.showResults = true;
    renderResults();
  }
  if (msg.phase.ph !== state.phase) onPhase(msg.phase);
  if (msg.sprays) {
    const last = (rows) => (rows.length ? rows[rows.length - 1][0] : 0);
    if (msg.sprays.length !== state.sprays.length || last(msg.sprays) !== last(state.sprays)) {
      state.sprays = msg.sprays;
      sprayLayer?.reset(state.sprays);
    }
  }
  state.version = msg.v;
}

function onSnapshot(s) {
  checkVersion(s);
  const nowSec = performance.now() / 1000;
  const offset = s.ts - nowSec;
  state.serverOffset = state.serverOffset === null ? offset : state.serverOffset + (offset - state.serverOffset) * 0.05;
  state.latest = s;
  state.phase = s.ph;
  state.timeLeft = s.tl;
  state.scores = s.sc;
  state.round = s.r;
  state.bomb = s.b;
  state.attackers = s.atk;
  if (battlefield) {
    battlefield.syncGrenades(s.g);
    battlefield.syncSmokes(s.sm);
  }

  const seen = new Set();
  for (const p of s.p) {
    const id = p[F.ID];
    seen.add(id);
    const remote = ensureRemote(id);
    remote.team = p[F.TEAM];
    remote.alive = !!p[F.ALIVE];
    remote.hp = p[F.HP];
    remote.weaponKind = state.weapons.order[p[F.WEAPON]];
    remote.protected = !!p[F.PROT];
    remote.reloading = !!p[F.RELOAD];
    remote.buffer.push({ ts: s.ts, x: p[F.X], y: p[F.Y], z: p[F.Z], yaw: p[F.YAW], pitch: p[F.PITCH], crouch: !!p[F.CROUCH] });
    if (remote.buffer.length > 30) remote.buffer.shift();

    if (id === state.myId) {
      // Сообщение о появлении потерялось: берём новую жизнь прямо из снимка.
      if (p[F.ALIVE] && p[F.LIFE] > me.life) {
        onSpawn({ id, x: p[F.X], y: p[F.Y], z: p[F.Z], yaw: p[F.YAW], life: p[F.LIFE] });
      }
      const wasReloading = me.reloading;
      me.hp = p[F.HP];
      me.ammo = p[F.AMMO];
      me.reloading = !!p[F.RELOAD];
      me.team = p[F.TEAM];
      me.protected = !!p[F.PROT];
      const gained = p[F.MONEY] - me.money;
      if (gained > 0 && state.moneyKnown && inMatch()) showMoneyGain(gained);
      state.moneyKnown = true;
      me.money = p[F.MONEY];
      me.armor = p[F.ARMOR];
      me.primary = p[F.PRIMARY] < 0 ? null : state.weapons.order[p[F.PRIMARY]];
      me.secondary = p[F.SECONDARY] < 0 ? null : state.weapons.order[p[F.SECONDARY]];
      me.buyLeft = p[F.BUY];
      me.grenades = { he: p[F.HE], flash: p[F.FLASH], smoke: p[F.SMOKE] };
      me.kit = !!p[F.KIT];
      renderAction(p[F.ACT], p[F.ACT_PROGRESS]);
      // Оружие могло смениться на сервере: покупка, смерть. Выбор игрока не перебиваем, пока
      // сервер на него не ответил: при большом пинге ответ идёт дольше секунды.
      const serverWeapon = state.weapons.order[p[F.WEAPON]];
      if (me.pendingWeapon) {
        const waited = performance.now() - me.switchAt;
        if (serverWeapon === me.pendingWeapon || waited > 2000 + state.ping * 2) me.pendingWeapon = null;
      }
      if (serverWeapon !== me.weapon && !me.pendingWeapon) {
        if (me.weapon === 'bomb') me.fireHeld = false;
        me.weapon = serverWeapon;
        setScoped(false);
      }
      const alive = !!p[F.ALIVE];
      if (me.alive && !alive) {
        me.fireHeld = false;
        setScoped(false);
        if (shopOpen) closeShop(false);
      }
      me.alive = alive;
      if (me.reloading && !wasReloading) {
        state.reloadStart = performance.now();
        sfx.reload(me.weapon);
        setScoped(false);
      }
      if (viewModel) viewModel.setTeam(me.team);
    }
  }
  for (const [id, remote] of state.remotes) {
    if (!seen.has(id)) {
      if (remote.model) remote.model.dispose();
      state.remotes.delete(id);
    }
  }
  if (shopOpen && me.buyLeft <= 0) closeShop();
  renderHud();
  if (shopOpen) renderShop();
}

// ---------- Режим мыши ----------
function lockFailed() {
  setCursorFree(false);
  // Браузер не даёт сразу вернуть курсор после Esc: нужно подождать секунду.
  $('lock-error').textContent = 'Браузер не дал захватить мышь. Подождите секунду и нажмите ещё раз.';
  $('lock-error').hidden = false;
  showMenuIfUnlocked();
}

function requestLock() {
  sfx.unlock();
  const canvas = renderer ? renderer.domElement : null;
  if (!canvas || document.pointerLockElement || shopOpen) return;
  $('lock-error').hidden = true;
  if (TOUCH) {
    // На телефоне мышь не захватывают: игра просто переходит в режим управления пальцами.
    enterFullscreen();
    if (!locked) lockChanged(true);
    return;
  }
  let result;
  try {
    result = canvas.requestPointerLock();
  } catch {
    result = null;
  }
  if (result && result.catch) result.catch(lockFailed);
}

function releaseLock() {
  if (TOUCH) {
    if (locked) lockChanged(false);
  } else if (document.pointerLockElement) {
    document.exitPointerLock();
  }
}

// ---------- Магазин ----------
function shortName(weapon) {
  const match = weapon.name.match(/«(.+)»/);
  return match ? match[1] : weapon.name;
}

function openShop() {
  if (shopOpen || !me.alive || me.buyLeft <= 0) return;
  shopOpen = true;
  setCursorFree(false);
  setScoped(false);
  keys.clear();
  me.fireHeld = false;
  boardHeld = false;
  $('overlay').hidden = true;
  $('shop').hidden = false;
  send({ t: 'shop', open: 1 });
  renderShop();
  // Курсор нужен, чтобы выбирать товары мышью.
  releaseLock();
}

function closeShop(relock = true) {
  if (!shopOpen) return;
  shopOpen = false;
  $('shop').hidden = true;
  send({ t: 'shop', open: 0 });
  if (relock) requestLock();
  else showMenuIfUnlocked();
}

function shopItem(id, title, price, details) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shop-item';
  button.dataset.item = id;
  const name = document.createElement('b');
  name.textContent = title;
  const cost = document.createElement('span');
  cost.className = 'price';
  cost.textContent = `$${price}`;
  const info = document.createElement('small');
  info.textContent = details;
  button.append(name, cost, info);
  button.addEventListener('click', () => send({ t: 'buy', item: id }));
  return button;
}

const SIGHT_NAMES = {
  iron: 'механический прицел', dot: 'коллиматор', holo: 'голографический прицел',
  scope2: 'прицел ×2', scope: 'оптика',
};

function weaponDetails(weapon) {
  const damage = weapon.pellets > 1 ? `${weapon.dmg}×${weapon.pellets}` : weapon.dmg;
  const parts = [`Урон ${damage}`, `${weapon.mag} патр.`];
  if (weapon.auto) parts.push('очередь');
  parts.push(SIGHT_NAMES[weapon.sight] || '');
  return parts.filter(Boolean).join(' · ');
}

function buildShop() {
  const { list, order, categories } = state.weapons;
  const root = $('shop-cols');
  if (!state.welcome.flags.shop) return;
  // Колонка на каждый раздел: пистолеты, пистолеты-пулемёты, дробовики и так далее.
  for (const [cat, title] of Object.entries(categories)) {
    const ids = order.filter((id) => list[id].cat === cat && cat !== 'knife');
    if (!ids.length) continue;
    const column = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    column.append(heading);
    for (const id of ids) column.append(shopItem(id, list[id].name, list[id].price, weaponDetails(list[id])));
    root.append(column);
  }
  const gear = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = 'Снаряжение';
  gear.append(heading);
  for (const [id, item] of Object.entries(state.welcome.armor)) {
    gear.append(shopItem(id, item.name, item.price, item.text));
  }
  if (state.welcome.mode === 'defuse') {
    gear.append(shopItem('kit', 'Набор сапёра', state.welcome.kitPrice, 'Обезвреживание вдвое быстрее'));
  }
  for (const [id, item] of Object.entries(state.welcome.grenades)) {
    gear.append(shopItem(id, item.name, item.price, `${item.text}. Бросок: ${item.key}`));
  }
  root.append(gear);
}

function shopItemState(id) {
  const { armor, grenades, kitPrice, weapons } = {
    armor: state.welcome.armor, grenades: state.welcome.grenades,
    kitPrice: state.welcome.kitPrice, weapons: state.weapons.list,
  };
  if (armor[id]) return { price: armor[id].price, has: me.armor >= armor[id].level };
  if (grenades[id]) {
    return { price: grenades[id].price, has: me.grenades[id] >= grenades[id].max, count: me.grenades[id] };
  }
  if (id === 'kit') return { price: kitPrice, has: me.kit, hidden: me.team === state.attackers };
  return { price: weapons[id].price, has: id === me.primary || id === me.secondary };
}

function renderShop() {
  setText('shop-money', `$${me.money}`);
  setText('shop-timer', `${Math.ceil(me.buyLeft)} с`);
  document.querySelectorAll('.shop-item').forEach((button) => {
    const { price, has, count, hidden } = shopItemState(button.dataset.item);
    button.hidden = !!hidden;
    button.disabled = has || me.money < price;
    button.classList.toggle('owned', has);
    const label = button.querySelector('.price');
    let text = `$${price}`;
    if (has) text = count > 1 ? `Есть ×${count}` : 'Есть';
    else if (count) text = `$${price} (есть ×${count})`;
    if (label.textContent !== text) label.textContent = text;
  });
}

// ---------- Гранаты ----------
function throwGrenade(kind) {
  const nowSec = performance.now() / 1000;
  if (!me.alive || !canShootNow() || me.grenades[kind] <= 0 || nowSec < me.nextThrow) return;
  me.nextThrow = nowSec + 0.8;
  send({ ...positionMessage('throw'), kind });
  viewModel.dip();
  sfx.throwing();
  setScoped(false);
}

function onBoom(msg) {
  if (!battlefield) return;
  const dx = msg.x - me.x;
  const dz = msg.z - me.z;
  sfx.boom(msg.kind, Math.hypot(dx, dz), panFor(dx, dz));
  if (msg.kind === 'he') battlefield.blast(msg.x, msg.y, msg.z, 7);
  else if (msg.kind === 'bomb') battlefield.blast(msg.x, msg.y, msg.z, 26);
  else if (msg.kind === 'flash') {
    battlefield.blast(msg.x, msg.y, msg.z, 5, 0xeaf4ff);
    const seconds = msg.blind?.[state.myId];
    if (seconds) blindMe(seconds);
  }
}

function blindMe(seconds) {
  const veil = $('flashbang');
  veil.style.transition = 'none';
  veil.style.opacity = '1';
  void veil.offsetWidth;
  // Экран остаётся белым первую треть времени и потом проясняется.
  veil.style.transition = `opacity ${(seconds * 0.67).toFixed(2)}s ease-in ${(seconds * 0.33).toFixed(2)}s`;
  veil.style.opacity = '0';
  sfx.ringing(seconds);
}

// ---------- Спреи ----------
const SPRAY_MAX = 1.1;
const SPRAY_MIN = 0.3;

/** Куда смотрит игрок: ближайшая стена, ящик или земля в пределах досягаемости. */
function sprayTarget() {
  const range = state.welcome.sprayRange || 6;
  const o = [me.x, me.y + me.eye, me.z];
  const cp = Math.cos(me.pitch);
  const d = [-Math.sin(me.yaw) * cp, Math.sin(me.pitch), -Math.cos(me.yaw) * cp];
  let best = null;
  if (d[1] < -1e-6) {
    const t = -o[1] / d[1];
    if (t <= range) best = { t, axis: 1, sign: 1, box: null };
  }
  const names = [['minx', 'maxx'], ['miny', 'maxy'], ['minz', 'maxz']];
  for (const box of state.boxes) {
    let near = 0;
    let far = best ? best.t : range;
    let axis = -1;
    let sign = 0;
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      const low = box[names[a][0]];
      const high = box[names[a][1]];
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < low || o[a] > high) ok = false;
        continue;
      }
      let t1 = (low - o[a]) / d[a];
      let t2 = (high - o[a]) / d[a];
      let s = -1; // луч вошёл через нижнюю грань: нормаль смотрит в минус
      if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
      if (t1 > near) { near = t1; axis = a; sign = s; }
      far = Math.min(far, t2);
      if (near > far) ok = false;
    }
    if (ok && axis >= 0 && near > 0 && (!best || near < best.t)) best = { t: near, axis, sign, box };
  }
  if (!best) return null;
  const point = o.map((v, i) => v + d[i] * best.t);
  const normal = [0, 0, 0];
  normal[best.axis] = best.sign;
  // Рисунок не должен свисать за край: на узкой стене или бочке он становится меньше.
  let size = SPRAY_MAX;
  if (best.box) {
    const sides = [0, 1, 2].filter((a) => a !== best.axis);
    const width = (a) => best.box[names[a][1]] - best.box[names[a][0]];
    size = Math.max(SPRAY_MIN, Math.min(SPRAY_MAX, width(sides[0]), width(sides[1])));
    if (best.box.kind === 'barrel') size = Math.min(size, 0.6); // бочка круглая
    for (const a of sides) {
      const low = best.box[names[a][0]] + size / 2;
      const high = best.box[names[a][1]] - size / 2;
      point[a] = low <= high ? Math.min(high, Math.max(low, point[a])) : (low + high) / 2;
    }
  } else {
    point[1] = 0;
  }
  return { point: point.map((v) => Number(v.toFixed(3))), normal, size: Number(size.toFixed(2)) };
}

function doSpray() {
  if (!me.alive || !state.welcome) return;
  const nowMs = performance.now();
  if (nowMs < state.nextSpray) return;
  const hit = sprayTarget();
  if (!hit) {
    showToast('Подойдите ближе к стене или посмотрите на землю');
    return;
  }
  state.nextSpray = nowMs + 280;
  send({ t: 'spray', s: chosenSpray(), p: hit.point, n: hit.normal, size: hit.size, yaw: Number(me.yaw.toFixed(3)) });
}

function onSpray(row) {
  if (!row) return;
  state.sprays.push(row);
  if (state.sprays.length > 1500) {
    state.sprays.splice(0, state.sprays.length - 1500);
    sprayLayer?.reset(state.sprays);
  } else {
    sprayLayer?.add(row);
  }
  const mine = row[1] === state.myId;
  const dx = row[3] - me.x;
  const dz = row[5] - me.z;
  sfx.spray(mine ? 0 : Math.hypot(dx, dz), mine ? 0 : panFor(dx, dz));
}

// ---------- Бомба ----------
function siteAt(x, z) {
  const { sites, siteRadius } = state.welcome.world;
  return sites.find((site) => Math.hypot(x - site.x, z - site.z) <= siteRadius) ?? null;
}

/** Может ли игрок прямо сейчас заложить или обезвредить бомбу. */
function canAct() {
  const bomb = state.bomb;
  if (!bomb || !me.alive || state.phase !== 'live') return false;
  if (me.team === state.attackers) {
    return bomb[0] === 0 && bomb[4] === state.myId && me.y < 0.1 && siteAt(me.x, me.z) !== null;
  }
  return bomb[0] === 2 && Math.hypot(me.x - bomb[1], me.z - bomb[3]) <= state.welcome.bomb.defuseRange;
}

function onBombEvent(msg) {
  if (msg.ev === 'planted') {
    showBanner(`Бомба на точке ${msg.site}!`, me.team === state.attackers ? 'Защищайте её' : `Обезвредьте её: удерживайте ${ACTION_NAME} рядом`, 2.5);
    sfx.beep(true);
  } else if (msg.ev === 'dropped' && me.team === state.attackers) {
    showToast('Бомба упала. Подберите её');
  } else if (msg.ev === 'picked' && msg.id === state.myId) {
    showToast('Вы подобрали бомбу');
  }
}

function renderAction(kind, progress) {
  const bar = $('act-bar');
  bar.hidden = !kind;
  if (kind) {
    setText('act-text', kind === 1 ? 'Закладка бомбы…' : 'Обезвреживание…');
    $('act-fill').style.width = `${Math.round(progress * 100)}%`;
  }
}

function objectiveText() {
  const bomb = state.bomb;
  if (state.welcome.mode !== 'defuse' || !bomb || state.phase === 'warmup') return '';
  const attacking = me.team === state.attackers;
  if (bomb[0] === 2) {
    return attacking ? `Бомба заложена на точке ${bomb[5]}. Не дайте её обезвредить` : `Бомба на точке ${bomb[5]}! Подойдите и удерживайте ${ACTION_NAME}`;
  }
  if (!attacking) return 'Защищайте точки A и B';
  if (bomb[0] === 1) return 'Бомба упала. Подберите её (метка на мини-карте)';
  if (bomb[4] === state.myId) {
    if (siteAt(me.x, me.z)) {
      if (TOUCH) return 'Удерживайте кнопку БОМБА, чтобы заложить бомбу';
      return me.weapon === 'bomb' ? 'Удерживайте ЛКМ или E, чтобы заложить бомбу' : 'Достаньте бомбу (5) и удерживайте ЛКМ, или удерживайте E';
    }
    return TOUCH ? 'Бомба у вас. Идите на точку A или B' : 'Бомба у вас в инвентаре (клавиша 5). Идите на точку A или B';
  }
  return 'Прикройте того, кто несёт бомбу';
}

let nextBeep = 0;
function updateBombBeep(nowSec) {
  if (state.bomb?.[0] !== 2 || nowSec < nextBeep) return;
  const left = state.timeLeft;
  nextBeep = nowSec + (left > 20 ? 1 : left > 8 ? 0.5 : 0.22);
  sfx.beep(left <= 8);
}

// ---------- Мини-карта ----------
const RADAR_WIDTH = 164;
let radarBase = null;
let radarScale = 1;
let nextRadar = 0;

function buildRadar(world) {
  const canvas = $('radar');
  radarScale = RADAR_WIDTH / (world.halfX * 2);
  canvas.width = RADAR_WIDTH;
  canvas.height = Math.round(world.halfZ * 2 * radarScale);
  radarBase = document.createElement('canvas');
  radarBase.width = canvas.width;
  radarBase.height = canvas.height;
  const ctx = radarBase.getContext('2d');
  ctx.fillStyle = 'rgba(14,18,23,.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(190,200,210,.55)';
  for (const box of world.boxes) {
    if (box.kind === 'perimeter' || box.miny > 0) continue;
    ctx.fillRect(radarX(box.minx), radarZ(box.minz), (box.maxx - box.minx) * radarScale, (box.maxz - box.minz) * radarScale);
  }
  if (state.welcome.mode === 'defuse') {
    ctx.font = '700 12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const site of world.sites) {
      ctx.fillStyle = 'rgba(240,80,62,.32)';
      ctx.beginPath();
      ctx.arc(radarX(site.x), radarZ(site.z), world.siteRadius * radarScale, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#ff8a7a';
      ctx.fillText(site.id, radarX(site.x), radarZ(site.z));
    }
  }
}

function radarX(x) {
  return (x + state.welcome.world.halfX) * radarScale;
}

function radarZ(z) {
  return (z + state.welcome.world.halfZ) * radarScale;
}

function radarDot(ctx, x, z, color, size = 3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(radarX(x), radarZ(z), size, 0, 7);
  ctx.fill();
}

function renderRadar(nowSec) {
  if (nowSec < nextRadar || !radarBase) return;
  nextRadar = nowSec + 0.1;
  const ctx = $('radar').getContext('2d');
  ctx.clearRect(0, 0, radarBase.width, radarBase.height);
  ctx.drawImage(radarBase, 0, 0);

  // Враги на мини-карту не попадают: их надо искать глазами.
  if (!state.welcome.flags.ffa) {
    for (const [id, remote] of state.remotes) {
      if (id === state.myId || !remote.alive || remote.team !== me.team) continue;
      radarDot(ctx, remote.view.x, remote.view.z, me.team === 0 ? '#f0a64a' : '#6cb2ff');
    }
  }
  const bomb = state.bomb;
  if (bomb && (me.team === state.attackers || bomb[0] === 2)) {
    const blink = bomb[0] !== 2 || Math.floor(nowSec * 4) % 2 === 0;
    if (blink) radarDot(ctx, bomb[1], bomb[3], '#ff3b2b', 4);
  }
  if (me.alive) {
    const x = radarX(me.x);
    const z = radarZ(me.z);
    ctx.fillStyle = '#ffffff';
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(-me.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function showMoneyGain(amount) {
  const note = $('money-gain');
  note.textContent = `+$${amount}`;
  restartClass(note, 'show');
  sfx.money();
}

// ---------- Комната ожидания ----------
function buildHostSettings() {
  const modeSelect = $('set-mode');
  const mapSelect = $('set-map');
  for (const [id, mode] of Object.entries(state.welcome.modes)) {
    modeSelect.append(new Option(mode.name, id));
  }
  for (const [id, map] of Object.entries(state.welcome.maps)) {
    mapSelect.append(new Option(`${map.name}: ${map.text}`, id));
  }
  // Берём значения прямо из полей: ответ сервера на прошлое изменение мог ещё не прийти.
  const sendSettings = (keepTarget) => {
    const target = keepTarget ? Number($('set-target').value) || null : null;
    send({ t: 'settings', mode: modeSelect.value, map: mapSelect.value, target });
    sfx.click();
  };
  // Новый режим начинается со своей обычной цели, а смена карты цель не сбрасывает.
  modeSelect.addEventListener('change', () => sendSettings(false));
  mapSelect.addEventListener('change', () => sendSettings(true));
  $('set-target').addEventListener('change', () => sendSettings(true));
  $('set-start').addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    send({ t: 'start' });
  });
  $('set-bot-add').addEventListener('click', () => send({ t: 'bot', op: 'add' }));
  $('set-bot-remove').addEventListener('click', () => send({ t: 'bot', op: 'remove' }));
  document.querySelectorAll('[data-wait-team]').forEach((button) => {
    button.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      send({ t: 'team', team: Number(button.dataset.waitTeam) });
    });
  });
}

function badge(text, className) {
  const span = document.createElement('span');
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

function renderWaiting() {
  const w = state.welcome;
  if (!w || !$('waiting-panel')) return;
  const isHost = state.hostId === state.myId;
  const ffa = w.flags.ffa;
  const players = [...state.roster.values()];
  $('wait-count').textContent = `${players.length} из 16`;

  const groups = ffa
    ? [['Все против всех', players, '']]
    : [[w.teams[0], players.filter((p) => p.team === 0), 't'], [w.teams[1], players.filter((p) => p.team === 1), 'ct']];
  const root = $('wait-teams');
  root.replaceChildren();
  root.classList.toggle('single', ffa);
  for (const [title, members, color] of groups) {
    const section = document.createElement('section');
    section.className = `wait-team ${color}`;
    const heading = document.createElement('h3');
    heading.textContent = `${title} · ${members.length}`;
    const list = document.createElement('ul');
    for (const player of members) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = player.name;
      item.append(name);
      if (player.id === state.hostId) item.append(badge('ведущий', 'host'));
      if (player.id === state.myId) item.append(badge('вы', 'me'));
      if (player.bot) item.append(badge('бот', 'bot'));
      list.append(item);
    }
    if (!members.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Пока никого';
      list.append(empty);
    }
    section.append(heading, list);
    root.append(section);
  }
  $('wait-team-buttons').hidden = ffa;

  $('host-settings').hidden = !isHost;
  $('guest-settings').hidden = isHost;
  const host = state.roster.get(state.hostId);
  $('guest-summary').textContent = `${w.modeName} · карта «${w.world.name}» · до ${w.target}`;
  $('guest-wait').textContent = host ? `Ждём, когда ${host.name} начнёт игру` : 'Ждём ведущего';
  if (document.activeElement !== $('set-mode')) $('set-mode').value = w.mode;
  if (document.activeElement !== $('set-map')) $('set-map').value = w.world.id;
  const limits = w.modes[w.mode].target;
  $('set-target-field').hidden = !limits;
  if (limits && document.activeElement !== $('set-target')) {
    Object.assign($('set-target'), { min: limits[1], max: limits[2], value: w.target });
    $('set-target-label').textContent = w.flags.rounds ? 'Играем до побед в раундах' : 'Играем до убийств';
  }
  const lonelyTeam = !ffa && w.flags.rounds && groups.some(([, members]) => members.length === 0);
  $('start-hint').textContent = lonelyTeam
    ? 'В этом режиме нужны обе команды: позовите друга или добавьте бота'
    : '';
  $('mode-rules').textContent = w.modeText;
}

// ---------- Итоги матча ----------
function onResults(msg) {
  state.results = msg;
  state.showResults = false;
  renderResults();
  const mine = msg.rows.find((row) => row.id === state.myId);
  const won = msg.champ ? msg.mvp === state.myId : mine && mine.team === msg.winner;
  sfx.victory(!!won);
  // Сначала несколько секунд видна надпись о победе, потом экран с цифрами.
  setTimeout(() => {
    if (state.results !== msg || state.phase !== 'end') return;
    state.showResults = true;
    updatePhaseUi();
  }, 3000);
}

function resultTitle(r) {
  if (r.champ) return `Победитель: ${r.champ}`;
  if (r.winner >= 0) return `Победа ${winnerText(r.winner)}!`;
  return 'Ничья';
}

function statCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function renderResults() {
  const r = state.results;
  if (!r) return;
  const mine = r.rows.find((row) => row.id === state.myId);
  $('res-title').textContent = resultTitle(r);
  const parts = [`${r.modeName} · ${r.mapName}`];
  if (!r.champ && r.winner >= 0 && mine) parts.push(mine.team === r.winner ? 'Ваша команда победила' : 'Ваша команда проиграла');
  if (!r.champ && !state.welcome.flags.ffa) parts.push(`Счёт ${r.scores[0]} : ${r.scores[1]}`);
  $('res-sub').textContent = parts.join(' · ');
  $('res-case').hidden = !(r.rewarded?.includes(state.myId) || state.hasNewCase);

  const podium = $('res-podium');
  podium.replaceChildren();
  r.rows.slice(0, 3).forEach((row, index) => {
    const card = document.createElement('div');
    card.className = `podium-card place-${index + 1}${row.id === state.myId ? ' me' : ''}`;
    const place = document.createElement('b');
    place.className = 'place';
    place.textContent = index + 1;
    const name = document.createElement('strong');
    name.textContent = row.name;
    const line = document.createElement('span');
    line.textContent = `${row.k} убийств · ${row.d} смертей`;
    card.append(place, name, line);
    if (row.id === r.mvp) card.append(badge('MVP', 'mvp'));
    podium.append(card);
  });

  const chips = $('res-mine');
  chips.replaceChildren();
  chips.hidden = !mine;
  if (mine) {
    const items = [
      ['Убийства', mine.k], ['Смерти', mine.d], ['Помощь', mine.a],
      ['В голову', `${mine.hs}%`], ['Меткость', `${mine.acc}%`], ['Урон', mine.dmg],
    ];
    if (r.mode === 'defuse') items.push(['Бомба', `${mine.plants} / ${mine.defuses}`]);
    if (r.mode === 'gungame') items.push(['Ступень', `${mine.level} из ${state.welcome.target}`]);
    const title = document.createElement('h2');
    title.textContent = `Ваш результат: ${r.rows.indexOf(mine) + 1} место`;
    chips.append(title);
    for (const [label, value] of items) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      const big = document.createElement('b');
      big.textContent = value;
      const small = document.createElement('small');
      small.textContent = label;
      chip.append(big, small);
      chips.append(chip);
    }
  }

  $('res-obj-head').hidden = r.mode !== 'defuse';
  const body = $('res-body');
  body.replaceChildren();
  r.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    if (row.id === state.myId) tr.className = 'me';
    statCell(tr, index + 1);
    const nameCell = document.createElement('td');
    const name = document.createElement('span');
    name.textContent = row.name;
    name.className = r.champ || state.welcome.flags.ffa ? '' : TEAM_CLASS[row.team];
    nameCell.append(name);
    if (row.id === r.mvp) nameCell.append(badge('MVP', 'mvp'));
    if (row.bot) nameCell.append(badge('бот', 'bot'));
    tr.append(nameCell);
    for (const value of [row.k, row.d, row.a, `${row.hs}%`, `${row.acc}%`, row.dmg]) statCell(tr, value);
    if (r.mode === 'defuse') statCell(tr, `${row.plants} / ${row.defuses}`);
    statCell(tr, row.score, 'score');
    body.append(tr);
  });

  const isHost = state.hostId === state.myId;
  $('res-host').hidden = !isHost;
  const host = state.roster.get(state.hostId);
  $('res-wait').hidden = isHost;
  $('res-wait').textContent = host ? `Ждём, когда ${host.name} начнёт новую игру` : 'Ждём ведущего';
}

/** Что показать поверх игры: комнату ожидания, итоги или ничего. */
function updatePhaseUi() {
  const waiting = state.phase === 'lobby';
  const ended = state.phase === 'end' && state.results && state.showResults;
  if (waiting || ended) {
    setCursorFree(false);
    releaseLock();
    if (shopOpen) closeShop(false);
    $('hud').hidden = true;
    $('overlay').hidden = false;
    $('menu-panel').hidden = true;
    $('lost-panel').hidden = true;
    $('waiting-panel').hidden = !waiting;
    $('results-panel').hidden = !ended;
    if (waiting) renderWaiting();
    if (ended) renderResults();
    return;
  }
  $('waiting-panel').hidden = true;
  $('results-panel').hidden = true;
  if (state.joined) $('hud').hidden = false;
}

// ---------- Подсказки ----------
let hintsShown = false;
function showHints() {
  if (hintsShown || TOUCH) return; // на телефоне все действия подписаны на самих кнопках
  hintsShown = true;
  const flags = state.welcome.flags;
  const tips = ['WASD ходить', 'ЛКМ стрелять', 'R перезарядка', 'Пробел прыжок', 'Shift присесть'];
  if (flags.shop) tips.push('B магазин', 'G F C гранаты');
  if (state.welcome.mode === 'defuse') tips.push('E бомба');
  tips.push('T спрей', 'V осмотр', 'Tab счёт', 'Esc меню');
  const bar = $('hints');
  bar.replaceChildren(...tips.map((tip) => {
    const [key, ...rest] = tip.split(' ');
    const item = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key === 'G' ? 'G F C' : key;
    item.append(kbd, ` ${key === 'G' ? rest.slice(2).join(' ') : rest.join(' ')}`);
    return item;
  }));
  bar.hidden = false;
  setTimeout(() => { bar.classList.add('fade'); }, 22000);
  setTimeout(() => { bar.hidden = true; }, 23500);
}

let killNoteTimer;
function showKillNote(text, sub = '') {
  $('kill-text').textContent = text;
  $('kill-sub').textContent = sub;
  const note = $('kill-note');
  note.hidden = false;
  restartClass(note, 'show');
  clearTimeout(killNoteTimer);
  killNoteTimer = setTimeout(() => { note.hidden = true; }, 2200);
}

function skinFor(playerId, weapon) {
  const id = state.roster.get(playerId)?.skins?.[weapon];
  return id ? state.welcome.skins[id] ?? null : null;
}

function setCursorFree(value) {
  cursorFree = value;
  $('cursor-tip').hidden = !value;
}

function showMenuIfUnlocked() {
  if (cursorFree && inMatch()) return;
  if (locked || !state.joined || !state.connected) return;
  if (!inMatch()) {
    updatePhaseUi();
    return;
  }
  $('overlay').hidden = false;
  $('menu-panel').hidden = false;
  $('lost-panel').hidden = true;
  $('waiting-panel').hidden = true;
  $('results-panel').hidden = true;
  $('overlay').scrollTop = 0; // кнопка «Продолжить» наверху: на телефоне меню длиннее экрана
  // Перед первым входом в матч меню выглядит как приглашение, а не как пауза.
  $('menu-title').textContent = lockedThisMatch ? 'Пауза' : 'Матч начался!';
  $('resume').textContent = lockedThisMatch ? 'Продолжить' : 'Играть';
}

document.addEventListener('pointerlockchange', () => lockChanged(!!document.pointerLockElement));

/** Игра получила управление (мышь захвачена или на телефоне нажали «Играть») или потеряла его. */
function lockChanged(value) {
  locked = value;
  touchControls?.setActive(locked);
  if (locked) {
    everLocked = true;
    setCursorFree(false);
    lockedThisMatch = true;
    // Запрос захвата мог завершиться уже после открытия магазина.
    if (shopOpen) {
      releaseLock();
      return;
    }
    $('overlay').hidden = true;
    if (shopPending) {
      shopPending = false;
      openShop();
    }
  } else {
    me.fireHeld = false;
    boardHeld = false;
    renderBoardVisibility();
    if (!shopOpen) {
      keys.clear();
      showMenuIfUnlocked();
    }
  }
}

document.addEventListener('pointerlockerror', lockFailed);

document.addEventListener('mousemove', (event) => {
  if (!locked) return;
  // Некоторые браузеры изредка выдают огромный скачок мыши: такие значения отбрасываем.
  const dx = Math.max(-250, Math.min(250, event.movementX));
  const dy = Math.max(-250, Math.min(250, event.movementY));
  applyLook(dx, dy);
});

function applyLook(dx, dy) {
  // В прицеле мышь медленнее ровно во столько раз, во сколько он приближает.
  const scale = (0.0022 * settings.sens * (camera ? camera.fov : FOV)) / FOV;
  me.yaw -= dx * scale;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - dy * scale));
}

document.addEventListener('mousedown', (event) => {
  if (!locked) return;
  if (event.button === 0) {
    me.fireHeld = true;
  } else if (event.button === 2 && me.alive && !me.reloading) {
    // Правая кнопка прицеливает любое оружие, кроме ножа.
    setScoped(!me.scoped);
  }
});

document.addEventListener('mouseup', (event) => {
  if (event.button === 0) me.fireHeld = false;
});

document.addEventListener('contextmenu', (event) => {
  if (!$('hud').hidden && $('overlay').hidden) event.preventDefault();
});

document.addEventListener('wheel', (event) => {
  if (!locked) return;
  const owned = ownedWeapons();
  const step = event.deltaY > 0 ? 1 : -1;
  selectWeapon(owned[(owned.indexOf(me.weapon) + step + owned.length) % owned.length]);
}, { passive: true });

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

document.addEventListener('keydown', (event) => {
  if (cursorFree) {
    if (event.repeat) return;
    if (event.code === 'KeyP') requestLock();
    else if (event.code === 'Escape') {
      setCursorFree(false);
      showMenuIfUnlocked();
    }
    return;
  }
  if (shopOpen) {
    if (event.repeat) return;
    if (event.code === 'KeyB' || event.code === 'Escape') {
      event.preventDefault();
      closeShop();
    } else if (MOVE_KEYS.includes(event.code)) {
      // Игрок побежал: значит, закончил покупки.
      closeShop();
      keys.add(event.code);
    }
    return;
  }
  if (!locked) return;
  if (['Tab', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  keys.add(event.code);
  const slot = { Digit1: me.primary, Digit2: me.secondary, Digit3: 'knife', Digit4: 'bomb', Digit5: 'bomb' }[event.code];
  if (slot) selectWeapon(slot);
  else if (THROW_KEYS[event.code]) throwGrenade(THROW_KEYS[event.code]);
  else if (event.code === 'KeyQ') selectWeapon(ownedWeapons().includes(me.lastWeapon) ? me.lastWeapon : me.secondary || 'knife');
  else if (event.code === 'KeyR') send({ t: 'reload' });
  else if (event.code === 'KeyT') doSpray();
  else if (event.code === 'KeyV' && me.alive && !me.reloading) {
    setScoped(false);
    if (viewModel.inspect()) sfx.draw();
  }
  else if (event.code === 'KeyM') toggleMute();
  else if (event.code === 'KeyP') {
    setCursorFree(true);
    document.exitPointerLock();
  }
  else if (event.code === 'KeyL' && !$('perf-tip').hidden) switchToLowQuality();
  else if (event.code === 'KeyB') {
    if (me.alive && me.buyLeft > 0) openShop();
    else if (state.welcome.flags.shop) showToast('Магазин уже закрыт: он работает 20 секунд после появления');
    else showToast('В этом режиме нет магазина');
  } else if (event.code === 'Tab') {
    boardHeld = true;
    renderBoardVisibility();
  }
});

document.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  if (event.code === 'Tab') {
    boardHeld = false;
    renderBoardVisibility();
  }
});

function toggleMute() {
  const muted = sfx.toggleMute();
  showToast(muted ? 'Звук выключен' : 'Звук включён');
}

let toastTimer;
function showToast(text) {
  const note = $('netinfo');
  note.dataset.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { delete note.dataset.toast; }, 1400);
}

/** Бомба лежит в инвентаре у того террориста, который её несёт. */
function carryingBomb() {
  const bomb = state.bomb;
  return !!bomb && bomb[0] === 0 && bomb[4] === state.myId;
}

function ownedWeapons() {
  return [me.primary, me.secondary, 'knife', carryingBomb() ? 'bomb' : null].filter(Boolean);
}

function selectWeapon(name) {
  if (!name || name === me.weapon || !me.alive || !ownedWeapons().includes(name)) return;
  me.lastWeapon = me.weapon;
  me.weapon = name;
  me.switchAt = performance.now();
  me.pendingWeapon = name;
  me.nextShot = Math.max(me.nextShot, performance.now() / 1000 + 0.3);
  setScoped(false);
  sfx.draw();
  send({ t: 'weapon', w: name });
  renderSlots();
}

/** Прицеливание (правая кнопка мыши). Приближение и положение оружия плавно меняются в frame(). */
function setScoped(value) {
  const weapon = state.weapons?.list[me.weapon];
  me.scoped = !!value && !!weapon && weapon.cat !== 'knife' && weapon.cat !== 'bomb';
  $('crosshair').hidden = me.scoped;
}

// Насколько игрок сейчас прицелился: 0 от бедра, 1 полностью в прицеле.
let aimAmount = 0;
function updateAim(dt) {
  const weapon = state.weapons.list[me.weapon];
  const target = me.scoped && me.alive && !me.reloading ? 1 : 0;
  aimAmount += (target - aimAmount) * Math.min(1, dt * 14);
  if (aimAmount < 0.001) aimAmount = 0;
  const zoom = 1 + ((weapon?.zoom ?? 1) - 1) * aimAmount;
  const fov = FOV / zoom;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  // У снайперских винтовок настоящая оптика: когда она у глаза, видно только сетку.
  const scopeView = weapon?.sight === 'scope' && aimAmount > 0.9;
  $('scope').hidden = !scopeView;
  return { zoom, scopeView };
}

// ---------- Движение ----------
function hitsBox(x, y, z, height) {
  for (const box of state.boxes) {
    if (x + RADIUS > box.minx && x - RADIUS < box.maxx
      && z + RADIUS > box.minz && z - RADIUS < box.maxz
      && y + height > box.miny && y < box.maxy) {
      return box;
    }
  }
  return null;
}

function updateMovement(dt) {
  const frozen = state.phase === 'freeze';
  const weapon = state.weapons.list[me.weapon];
  const crouching = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (me.crouch && !crouching && hitsBox(me.x, me.y, me.z, HEIGHT_STAND)) {
    // Под низким препятствием встать нельзя.
  } else {
    me.crouch = crouching;
  }
  const height = me.crouch ? HEIGHT_CROUCH : HEIGHT_STAND;

  let forward = 0;
  let strafe = 0;
  // Пока игрок удерживает E на точке или у бомбы, он стоит на месте.
  const busy = me.using && canAct();
  if (!frozen && !busy) {
    if (keys.has('KeyW')) forward += 1;
    if (keys.has('KeyS')) forward -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    if (touchControls) {
      forward += touchControls.forward;
      strafe += touchControls.strafe;
    }
  }
  const speed = state.welcome.moveSpeed * weapon.speed * (me.crouch ? 0.52 : 1) * (me.scoped ? 0.55 : 1);
  const sin = Math.sin(me.yaw);
  const cos = Math.cos(me.yaw);
  let wishX = -sin * forward + cos * strafe;
  let wishZ = -cos * forward - sin * strafe;
  const length = Math.hypot(wishX, wishZ);
  if (length > 0) {
    // Джойстик, отклонённый не до конца, даёт медленный шаг; клавиши всегда дают полную скорость.
    const pace = Math.min(1, length);
    wishX = (wishX / length) * speed * pace;
    wishZ = (wishZ / length) * speed * pace;
  }
  const control = Math.min(1, dt * (me.onGround ? 13 : 2.8));
  me.vx += (wishX - me.vx) * control;
  me.vz += (wishZ - me.vz) * control;
  if (frozen || busy) me.vx = me.vz = 0;

  if (keys.has('Space') && me.onGround && !frozen) {
    me.vy = JUMP_SPEED;
    me.onGround = false;
  }
  me.vy -= GRAVITY * dt;

  // Оси считаются по очереди: так игрок скользит вдоль стены, а не застревает.
  const nextX = me.x + me.vx * dt;
  if (hitsBox(nextX, me.y, me.z, height)) me.vx = 0;
  else me.x = nextX;
  const nextZ = me.z + me.vz * dt;
  if (hitsBox(me.x, me.y, nextZ, height)) me.vz = 0;
  else me.z = nextZ;

  const fallSpeed = me.vy;
  const wasOnGround = me.onGround;
  me.y += me.vy * dt;
  me.onGround = false;
  if (me.y <= 0) {
    me.y = 0;
    me.vy = 0;
    me.onGround = true;
  } else {
    const box = hitsBox(me.x, me.y, me.z, height);
    if (box) {
      if (me.vy <= 0) {
        me.y = box.maxy;
        me.onGround = true;
      } else {
        me.y = box.miny - height;
      }
      me.vy = 0;
    }
  }

  if (me.onGround && !wasOnGround && fallSpeed < -4) sfx.land();

  const horizontal = Math.hypot(me.vx, me.vz);
  if (horizontal > 1 && me.onGround && !me.crouch) {
    me.stepPhase += horizontal * dt;
    if (me.stepPhase > 2.4) {
      me.stepPhase = 0;
      sfx.step(1.5, 0);
    }
  }

  const eyes = state.welcome.eye;
  const targetEye = me.crouch ? eyes[1] : eyes[0];
  me.eye += (targetEye - me.eye) * Math.min(1, dt * 14);
  return horizontal;
}

function renderTime() {
  return performance.now() / 1000 + (state.serverOffset ?? 0) - INTERP_DELAY;
}

function aimPitch() {
  return Math.max(-1.55, Math.min(1.55, me.pitch + me.punch));
}

function positionMessage(type) {
  return {
    t: type,
    x: Number(me.x.toFixed(3)),
    y: Number(me.y.toFixed(3)),
    z: Number(me.z.toFixed(3)),
    yaw: Number(me.yaw.toFixed(4)),
    pitch: Number(aimPitch().toFixed(4)),
    c: me.crouch ? 1 : 0,
    life: me.life,
  };
}

// ---------- Стрельба ----------
function canShootNow() {
  return state.phase === 'live' || state.phase === 'warmup';
}

function updateFiring(nowSec) {
  if (!me.fireHeld || !me.alive || !locked || !canShootNow()) return;
  const weapon = state.weapons.list[me.weapon];
  if (weapon.cat === 'bomb') return; // с бомбой в руках ЛКМ закладывает её (см. frame)
  if (nowSec < me.nextShot || me.reloading) return;
  if (weapon.mag && me.ammo <= 0) {
    sfx.empty();
    me.nextShot = nowSec + 0.25;
    send({ t: 'reload' });
    return;
  }
  me.nextShot = nowSec + weapon.interval;
  const scoped = me.scoped;
  send({
    ...positionMessage('shoot'),
    s: scoped ? 1 : 0,
    rt: Number(renderTime().toFixed(3)),
  });
  sfx.shot(me.weapon);
  viewModel.fire({ sniper: 1, shotgun: 0.9, mg: 0.5 }[weapon.cat] ?? 0.45);
  if (me.weapon !== 'knife' && !weapon.quiet) {
    lightMuzzle(v1.set(0.2, -0.1, -0.8).applyEuler(camera.rotation).add(camera.position));
  }
  // В прицеле отдача заметно меньше.
  me.punch += weapon.kick * (scoped ? 0.6 : 1);
  me.spread = Math.min(1, me.spread + 0.22);
  if (!weapon.auto) me.fireHeld = false;
  // Винтовка с ручным затвором после выстрела отводится от глаза, чтобы передёрнуть затвор.
  if (scoped && BOLT_ACTION.has(me.weapon)) setScoped(false);
}

const BOLT_ACTION = new Set(['sniper', 'heavy_sniper']);

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function lightMuzzle(at) {
  if (!muzzleLight) return;
  muzzleLight.position.copy(at);
  muzzleLight.intensity = 2.5;
  muzzleUntil = performance.now() + 55;
}

/** Какая грань коробки встретилась пуле: нужно, чтобы след лёг ровно на стену. */
function surfaceAt(o, e) {
  const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  const length = Math.hypot(...d) || 1;
  const dir = d.map((v) => v / length);
  if (e[1] < 0.03) return { normal: new THREE.Vector3(0, 1, 0), metal: false };
  let best = Infinity;
  let found = null;
  for (const box of state.boxes) {
    let near = -Infinity;
    let far = Infinity;
    let axis = -1;
    let sign = 1;
    const lows = [box.minx, box.miny, box.minz];
    const highs = [box.maxx, box.maxy, box.maxz];
    let miss = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dir[k]) < 1e-9) {
        if (o[k] < lows[k] || o[k] > highs[k]) miss = true;
        continue;
      }
      let t1 = (lows[k] - o[k]) / dir[k];
      let t2 = (highs[k] - o[k]) / dir[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > near) {
        near = t1;
        axis = k;
        sign = dir[k] > 0 ? -1 : 1;
      }
      far = Math.min(far, t2);
    }
    if (miss || near > far || near < 0 || near > length + 0.1 || near >= best) continue;
    best = near;
    const normal = new THREE.Vector3();
    normal.setComponent(axis, sign);
    found = { normal, metal: box.kind === 'container' };
  }
  return found;
}

/** Расстояние от точки до отрезка: пролетела ли пуля рядом с головой. */
function distanceToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

function onShot(msg) {
  if (!effects) return;
  const mine = msg.id === state.myId;
  const startPoint = new THREE.Vector3();
  if (mine) {
    // В прицеле оружие стоит по центру, поэтому и след идёт из центра.
    startPoint.set(me.scoped ? 0 : 0.17, me.scoped ? -0.07 : -0.15, -0.65).applyEuler(camera.rotation).add(camera.position);
  } else {
    // Вспышка и след начинаются на конце ствола, а не в груди стрелка.
    const shooter = state.remotes.get(msg.id)?.model;
    shooter?.fire();
    if (!shooter?.muzzlePosition(startPoint)) startPoint.set(msg.o[0], msg.o[1] - 0.25, msg.o[2]);
    const dx = msg.o[0] - me.x;
    const dz = msg.o[2] - me.z;
    const distance = Math.hypot(dx, dz);
    sfx.shot(msg.w, distance, panFor(dx, dz));
    // Оружие с глушителем почти не даёт вспышки.
    if (msg.w !== 'knife' && !state.weapons.list[msg.w]?.quiet) lightMuzzle(startPoint);
    // Пуля прошла рядом: слышен свист.
    if (me.alive && msg.w !== 'knife' && distance > 3) {
      const head = [me.x, me.y + me.eye, me.z];
      if (distanceToSegment(head, msg.o, msg.e) < 1.4) sfx.whiz(panFor(dx, dz));
    }
  }
  if (msg.w !== 'knife' && !mine && !state.weapons.list[msg.w]?.quiet) effects.flash(startPoint);

  // Дробовик присылает все дробинки сразу: у каждой свой след и своя отметина.
  const ends = msg.es || [msg.e];
  ends.forEach((e, index) => {
    const end = v2.set(e[0], e[1], e[2]);
    if (msg.w !== 'knife') effects.tracer(startPoint, end);
    const ex = e[0] - me.x;
    const ez = e[2] - me.z;
    const loud = index === 0; // звук попадания один на выстрел, иначе дробь звучит кашей
    if (msg.hit && index === 0) {
      impacts.blood(end);
      if (!mine) sfx.impact('flesh', Math.hypot(ex, ez), panFor(ex, ez));
    } else if (msg.w !== 'knife') {
      const surface = surfaceAt(msg.o, e);
      if (surface) {
        impacts.surface(end, surface.normal, surface.metal);
        if (loud) sfx.impact(surface.metal ? 'metal' : 'stone', Math.hypot(ex, ez), panFor(ex, ez));
      }
      effects.spark(end, false);
    }
  });
}

function panFor(dx, dz) {
  const distance = Math.hypot(dx, dz) || 1;
  return ((dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw)) / distance) * 0.8;
}

function restartClass(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function onHit(msg) {
  if (msg.by === state.myId) {
    const marker = $('hitmarker');
    marker.classList.toggle('head', msg.hs);
    restartClass(marker, 'show');
    sfx.hit(msg.hs);
  }
  state.remotes.get(msg.id)?.model?.hit();
  if (msg.id === state.myId) {
    restartClass($('damage'), 'show');
    sfx.hurt();
    showDamageArc(msg.by, msg.from);
  }
}

// Дуги «откуда попали»: по одной на стрелка, поворачиваются вместе с игроком.
const DAMAGE_ARC_MS = 2200;
const damageArcs = new Map();

function showDamageArc(attacker, from) {
  let arc = damageArcs.get(attacker);
  if (!arc) {
    const element = document.createElement('div');
    element.className = 'damage-arc';
    $('damage-arcs').append(element);
    arc = { element };
    damageArcs.set(attacker, arc);
  }
  [arc.x, arc.z] = from;
  arc.until = performance.now() + DAMAGE_ARC_MS;
}

function updateDamageArcs(nowMs) {
  for (const [attacker, arc] of damageArcs) {
    const left = arc.until - nowMs;
    if (left <= 0) {
      arc.element.remove();
      damageArcs.delete(attacker);
      continue;
    }
    const bearing = Math.atan2(me.x - arc.x, me.z - arc.z) - me.yaw;
    arc.element.style.transform = `rotate(${-bearing}rad)`;
    arc.element.style.opacity = Math.min(1, left / 800).toFixed(2);
  }
}

function clearDamageArcs() {
  for (const arc of damageArcs.values()) arc.element.remove();
  damageArcs.clear();
}

function playerName(id) {
  return state.roster.get(id)?.name ?? '?';
}

function feedName(id) {
  const span = document.createElement('span');
  span.textContent = playerName(id);
  const team = state.roster.get(id)?.team;
  span.className = TEAM_CLASS[team] ?? '';
  return span;
}

function onKill(msg) {
  const item = document.createElement('li');
  if (msg.killer === state.myId || msg.victim === state.myId) item.className = 'mine';
  const how = document.createElement('span');
  how.className = 'how';
  const special = { he: 'граната', bomb: 'бомба' }[msg.w];
  how.textContent = special ?? state.weapons.list[msg.w]?.name.split(' ')[0].toLowerCase() ?? '';
  if (msg.killer !== null) item.append(feedName(msg.killer));
  item.append(how);
  if (msg.hs) {
    const hs = document.createElement('span');
    hs.className = 'hs';
    hs.textContent = 'в голову';
    item.append(hs);
  }
  item.append(feedName(msg.victim));
  const feed = $('feed');
  feed.append(item);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => item.remove(), 6000);
  const weaponName = special ?? state.weapons.list[msg.w]?.name ?? '';
  if (msg.killer === state.myId && msg.victim !== state.myId) {
    sfx.kill();
    showKillNote(`Вы убили: ${playerName(msg.victim)}`, msg.hs ? 'Точно в голову!' : weaponName);
  }
  if (msg.victim === state.myId) {
    state.killedBy = msg.killer === null ? 'Взрыв бомбы' : `${playerName(msg.killer)}, ${weaponName.toLowerCase()}`;
  }
}

// ---------- Этапы матча ----------
let bannerTimer;
function showBanner(title, subtitle = '', seconds = 3) {
  $('banner-title').textContent = title;
  $('banner-sub').textContent = subtitle;
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  if (seconds > 0) bannerTimer = setTimeout(() => { $('banner').hidden = true; }, seconds * 1000);
}

function hideBanner() {
  $('banner').hidden = true;
  clearTimeout(bannerTimer);
}

function winnerText(winner) {
  return winner === 0 ? 'террористов' : 'антитеррористов';
}

const ROUND_REASONS = {
  exploded: 'Бомба взорвалась',
  defused: 'Бомба обезврежена',
  timeout: 'Время вышло',
};

function roundIntro(msg) {
  const side = state.welcome?.teams?.[me.team] ?? '';
  if (msg.swapped) return `Смена сторон! Теперь вы за команду «${side}». Деньги начисляются заново`;
  if (state.welcome?.mode !== 'defuse') return side ? `Вы за команду «${side}». Приготовьтесь…` : 'Приготовьтесь…';
  return me.team === msg.attackers ? 'Вы террорист: заложите бомбу на точке A или B' : 'Вы антитеррорист: защищайте точки A и B';
}

function onPhase(msg) {
  state.winner = msg.winner;
  state.phase = msg.ph;
  state.attackers = msg.attackers;
  // При смене сторон игроки переходят в другую команду. Снимок это подтвердит, но надпись нужна сразу.
  if (msg.swapped && state.welcome && !state.welcome.flags.ffa) me.team = 1 - me.team;
  if (msg.ph === 'lobby') {
    hideBanner();
    lockedThisMatch = false;
    hintsShown = false;
    state.results = null;
    state.hasNewCase = false;
    impacts?.clear();
  }
  if (msg.ph === 'end') lockedThisMatch = false;
  updatePhaseUi();
  if (inMatch() && !locked && !shopOpen) showMenuIfUnlocked();
  if (msg.ph === 'freeze') {
    showBanner(`Раунд ${msg.round}`, roundIntro(msg), 3);
    sfx.roundStart();
  } else if (msg.ph === 'live') {
    if (state.welcome?.flags.rounds) showBanner('В бой!', '', 1.2);
    else hideBanner();
    sfx.beep(true);
  } else if (msg.ph === 'round_end') {
    const reason = ROUND_REASONS[msg.reason];
    const score = `Счёт ${msg.scores[0]} : ${msg.scores[1]}`;
    showBanner(msg.winner < 0 ? 'Ничья в раунде' : `Раунд за командой ${winnerText(msg.winner)}`, reason ? `${reason}. ${score}` : score, 3.5);
  } else if (msg.ph === 'end') {
    let title = 'Ничья';
    if (msg.champ) title = `Победитель: ${msg.champ}`;
    else if (msg.winner >= 0) title = `Победа ${winnerText(msg.winner)}!`;
    showBanner(title, 'Сейчас покажем итоги матча', 3.2);
  } else if (msg.ph === 'warmup') {
    hideBanner();
  }
  renderBoardVisibility();
}

// ---------- Интерфейс ----------
const shown = {};
function setText(id, value) {
  if (shown[id] === value) return;
  shown[id] = value;
  $(id).textContent = value;
}

function buildSlots() {
  for (let i = 0; i < 4; i++) $('slots').append(document.createElement('li'));
  renderSlots();
}

function renderSlots() {
  const inSlots = [[1, me.primary], [2, me.secondary], [3, 'knife'], [5, carryingBomb() ? 'bomb' : null]];
  [...$('slots').children].forEach((item, index) => {
    const [key, id] = inSlots[index];
    const text = `${key} ${id ? shortName(state.weapons.list[id]) : '—'}`;
    if (item.textContent !== text) item.textContent = text;
    item.classList.toggle('on', id === me.weapon);
    item.classList.toggle('empty', !id);
    item.classList.toggle('bomb-slot', key === 5);
    item.hidden = key === 5 && !id;
  });
  const weapon = state.weapons.list[me.weapon];
  const skin = skinFor(state.myId, me.weapon);
  setText('weapon-name', skin ? `${weapon.name} · ${skin.name}` : weapon.name);
  setText('mag', weapon.mag ? `/ ${weapon.mag}` : '');
}

function formatTime(seconds) {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function renderHud() {
  setText('hp', me.alive ? me.hp : 0);
  $('hp-bar').style.width = `${me.alive ? me.hp : 0}%`;
  setText('money', `$${me.money}`);
  setText('armor', ['', 'Бронежилет', 'Жилет и шлем'][me.armor]);
  const canBuy = me.alive && me.buyLeft > 0 && !shopOpen;
  $('buy-note').hidden = !canBuy;
  if (canBuy) setText('buy-note', `B: магазин, ещё ${Math.ceil(me.buyLeft)} с`);
  const low = me.alive && me.hp <= 30;
  $('status').classList.toggle('low', low);
  $('damage').classList.toggle('low', low);
  const weapon = state.weapons.list[me.weapon];
  setText('ammo', weapon.mag ? me.ammo : '—');
  const lowAmmo = weapon.mag && me.ammo <= Math.ceil(weapon.mag * 0.2);
  $('reload-note').hidden = !(me.reloading || (lowAmmo && me.alive));
  setText('reload-note', me.reloading ? 'Перезарядка…' : TOUCH ? 'Мало патронов' : 'Мало патронов: нажмите R');
  $('gun').classList.toggle('low', !!lowAmmo && !me.reloading);
  const ffaMode = state.welcome.flags.ffa;
  setText('team-badge', ffaMode ? 'Каждый за себя' : `Вы: ${state.welcome.teams[me.team].toLowerCase()}`);
  $('team-badge').className = ffaMode ? '' : TEAM_CLASS[me.team];
  const ffa = state.welcome.flags.ffa;
  setText('score-a', ffa ? (state.roster.get(state.myId)?.k ?? 0) : state.scores[0]);
  setText('score-b', ffa ? state.scores[0] : state.scores[1]);
  setText('timer', state.phase === 'warmup' ? '—:—' : formatTime(state.timeLeft));
  $('timer').classList.toggle('bomb-time', state.bomb?.[0] === 2);
  const objective = objectiveText();
  $('objective').hidden = !objective;
  if (objective) setText('objective', objective);
  const nades = Object.entries(state.welcome.grenades)
    .filter(([id]) => me.grenades[id] > 0)
    .map(([id, item]) => `${item.key} ×${me.grenades[id]}`);
  setText('nades', me.alive ? nades.join(' · ') : '');

  const note = $('dead-note');
  if (state.phase === 'warmup') {
    const needTeam = state.latest.p.every((p) => p[F.TEAM] === 0) ? 'антитеррористов' : 'террористов';
    showBanner('Разминка', `Ждём игрока за ${needTeam}, или добавьте бота (Esc)`, 0);
  }
  if (!me.alive && !['end', 'round_end'].includes(state.phase)) {
    const respawns = state.welcome.flags.respawn || state.phase === 'warmup';
    const who = state.killedBy ? `Вас убил: ${state.killedBy}. ` : '';
    note.textContent = who + (respawns ? 'Возрождение через несколько секунд' : 'Ждём конца раунда');
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  renderBoardVisibility();
  renderBoardStatus();
}

function renderBoardVisibility() {
  $('board').hidden = !(boardHeld || state.phase === 'end');
  // В конце матча таблица стоит ниже надписи о победе и о полученном кейсе.
  $('board').classList.toggle('below-banner', state.phase === 'end');
}

function renderBoardStatus() {
  if ($('board').hidden || !state.latest) return;
  const dead = new Set(state.latest.p.filter((p) => !p[F.ALIVE]).map((p) => p[F.ID]));
  document.querySelectorAll('#board tbody tr').forEach((row) => {
    row.classList.toggle('dead', dead.has(Number(row.dataset.id)));
  });
}

function renderBoard() {
  [$('tbody-a'), $('tbody-b')].forEach((body) => body.replaceChildren());
  const players = [...state.roster.values()].sort((a, b) => b.k - a.k || a.d - b.d);
  for (const player of players) {
    const row = document.createElement('tr');
    row.dataset.id = player.id;
    if (player.id === state.myId) row.className = 'me';
    for (const value of [player.name, player.k, player.d]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    $(player.team === 0 || state.welcome?.flags.ffa ? 'tbody-a' : 'tbody-b').append(row);
  }
}

// ---------- Отрисовка других игроков ----------
function lerpAngle(a, b, t) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}

function updateRemotes(dt, rt) {
  for (const [id, remote] of state.remotes) {
    if (id === state.myId || !remote.buffer.length) continue;
    const buffer = remote.buffer;
    let older = buffer[0];
    let newer = buffer[buffer.length - 1];
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].ts <= rt) {
        older = buffer[i];
        newer = buffer[Math.min(i + 1, buffer.length - 1)];
        break;
      }
    }
    const span = newer.ts - older.ts;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - older.ts) / span)) : 0;
    const view = remote.view;
    view.x = older.x + (newer.x - older.x) * t;
    view.y = older.y + (newer.y - older.y) * t;
    view.z = older.z + (newer.z - older.z) * t;
    view.yaw = lerpAngle(older.yaw, newer.yaw, t);
    view.pitch = older.pitch + (newer.pitch - older.pitch) * t;
    view.crouch = newer.crouch;
    view.reloading = remote.reloading;
    view.alive = remote.alive;
    const moved = Math.hypot(view.x - remote.lastX, view.z - remote.lastZ);
    const speedNow = dt > 0 ? Math.min(moved / dt, 9) : 0;
    view.speed += (speedNow - view.speed) * Math.min(1, dt * 10);
    remote.lastX = view.x;
    remote.lastZ = view.z;

    // Когда все против всех, каждый выглядит как противник и без подписи.
    const ffa = state.welcome.flags.ffa;
    const colorTeam = ffa ? 1 : remote.team;
    if (!remote.model) remote.model = new PlayerModel(scene, colorTeam);
    const model = remote.model;
    model.setTeam(colorTeam);
    model.setWeapon(remote.weaponKind, skinFor(id, remote.weaponKind));
    model.setNameTag(state.roster.get(id)?.name ?? '', !ffa && remote.team === me.team && remote.alive);
    model.update(dt, view);

    // Погибшие исчезают через пару секунд; защищённые мигают.
    if (remote.alive) {
      remote.deadFor = 0;
      model.root.visible = !remote.protected || Math.floor(performance.now() / 120) % 2 === 0;
      remote.stepPhase += view.speed * dt;
      if (remote.stepPhase > 2.4 && !view.crouch && view.y < 0.05) {
        remote.stepPhase = 0;
        const dx = view.x - me.x;
        const dz = view.z - me.z;
        sfx.step(Math.hypot(dx, dz), panFor(dx, dz));
      }
    } else {
      remote.deadFor = (remote.deadFor || 0) + dt;
      model.root.visible = remote.deadFor < 3;
    }
  }
}

function spectateTarget() {
  if (!state.welcome.flags.rounds || state.phase === 'warmup') return null;
  for (const [id, remote] of state.remotes) {
    if (id !== state.myId && remote.alive && remote.team === me.team) return remote;
  }
  return null;
}

let orbit = 0;
function updateCamera(dt) {
  // В комнате ожидания и на итогах камера медленно облетает карту.
  if (!inMatch()) {
    orbit += dt * 0.08;
    const world = state.welcome.world;
    const radius = Math.max(world.halfX, world.halfZ) * 0.85;
    camera.position.set(Math.cos(orbit) * radius, 15, Math.sin(orbit) * radius);
    camera.lookAt(0, 0, 0);
    return;
  }
  if (me.alive) {
    camera.position.set(me.x, me.y + me.eye, me.z);
    camera.rotation.set(aimPitch(), me.yaw, 0);
    return;
  }
  const target = spectateTarget();
  if (target) {
    const view = target.view;
    const back = 3.1;
    camera.position.set(
      view.x + Math.sin(view.yaw) * back,
      view.y + 2.35,
      view.z + Math.cos(view.yaw) * back,
    );
    camera.rotation.set(-0.22, view.yaw, 0);
    return;
  }
  // Камера падает туда, где игрок погиб.
  me.eye = Math.max(0.4, me.eye - dt * 2.2);
  camera.position.set(me.x, me.y + me.eye, me.z);
  camera.rotation.set(me.pitch, me.yaw, Math.min(0.5, (1.65 - me.eye) * 0.55));
}

// ---------- Подсказка про медленную графику ----------
// Красивые материалы и тени нравятся не всем видеокартам. Если игра долго идёт рывками,
// предлагаем включить простую графику одной клавишей.
let slowWindows = 0;
let perfTipShown = false;
function checkPerformance(fps) {
  if (perfTipShown || settings.quality === 'low' || !inMatch() || !lockedThisMatch) return;
  slowWindows = fps < 25 ? slowWindows + 1 : Math.max(0, slowWindows - 1);
  if (slowWindows < 8) return;
  perfTipShown = true;
  $('perf-fps').textContent = fps;
  $('perf-tip').hidden = false;
  setTimeout(() => { $('perf-tip').hidden = true; }, 15000);
}

function switchToLowQuality() {
  save('quality', 'low');
  location.reload();
}

// ---------- Главный цикл ----------
let lastFrame = performance.now();
let fpsFrames = 0;
let fpsSince = performance.now();

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  const nowSec = performance.now() / 1000;

  // Закладывать бомбу можно клавишей E или левой кнопкой, держа бомбу в руках.
  const using = me.alive && (keys.has('KeyE') || (me.fireHeld && locked && me.weapon === 'bomb'));
  if (using !== me.using) {
    me.using = using;
    send({ t: 'use', on: using ? 1 : 0 });
  }

  let speed = 0;
  if (me.alive) {
    speed = updateMovement(dt);
    if (state.phase !== 'freeze' && nowSec - lastSend >= SEND_INTERVAL) {
      lastSend = nowSec;
      send(positionMessage('pos'));
    } else if (state.phase === 'freeze' && nowSec - lastSend >= 0.15) {
      lastSend = nowSec;
      send(positionMessage('pos'));
    }
    updateFiring(nowSec);
  }

  me.punch = Math.max(0, me.punch - dt * Math.max(0.05, me.punch * 7));
  me.spread = Math.max(0, me.spread - dt * 2.4);
  const moving = Math.min(speed / 5.5, 1);
  $('crosshair').style.setProperty('--gap', `${(5 + moving * 7 + me.spread * 13 + (me.onGround ? 0 : 8)).toFixed(1)}px`);

  updateRemotes(dt, renderTime());
  updateCamera(dt);
  sky.position.copy(camera.position);
  effects.update(dt);
  impacts.update(dt);
  if (muzzleLight.intensity && nowMs > muzzleUntil) muzzleLight.intensity = 0;
  battlefield.update(dt);
  battlefield.setBomb(state.bomb, dt, nowMs);
  updateBombBeep(nowSec);
  renderRadar(nowSec);
  updateDamageArcs(nowMs);
  $('smoke-veil').hidden = !battlefield.insideSmoke(camera.position.x, camera.position.y, camera.position.z);

  viewModel.setWeapon(me.weapon, skinFor(state.myId, me.weapon));
  renderSlots();
  const { scopeView } = updateAim(dt);
  // Доля пройденной перезарядки: по ней оружие в руках проходит все её шаги.
  const reloadTime = state.weapons.list[me.weapon]?.reload || 1;
  const reloadProgress = me.reloading ? Math.min(1, (nowMs - state.reloadStart) / (reloadTime * 1000)) : null;
  viewModel.update(dt, {
    speed: me.onGround ? speed : 0,
    reload: reloadProgress,
    aim: me.scoped ? 1 : 0,
    crouch: me.crouch,
    hidden: !me.alive || scopeView,
  });

  renderWorld();
  renderer.clearDepth();
  renderer.render(viewModel.scene, viewModel.camera);

  fpsFrames++;
  if (nowMs - fpsSince >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (nowMs - fpsSince));
    fpsFrames = 0;
    fpsSince = nowMs;
    checkPerformance(fps);
    const net = $('netinfo');
    net.textContent = net.dataset.toast || `FPS ${fps} · пинг ${state.ping} мс${sfx.muted ? ' · без звука' : ''}`;
  }
}

// ---------- Формы и меню ----------
const nickInput = $('nick');
nickInput.value = load('nick', '');

async function joinGame() {
  sfx.unlock();
  const name = nickInput.value.trim();
  save('nick', name);
  $('join-btn').disabled = true;
  $('join-btn').textContent = 'Загрузка…';
  $('join-error').hidden = true;
  // Без профиля тоже можно играть: просто не будет скинов и кейсов.
  const profile = await loadProfile();
  connect(name, null, profile?.code ?? null);
}

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  joinGame();
});

// С главной страницы игрок пришёл уже с ником: заходим сразу, без лишнего шага.
function readAutoJoin() {
  try {
    const value = sessionStorage.getItem('poligon.autojoin');
    sessionStorage.removeItem('poligon.autojoin');
    return value;
  } catch {
    return null;
  }
}
const autoJoin = readAutoJoin();
if ((autoJoin === config.code || autoJoin === '*') && nickInput.value.trim()) joinGame();

$('res-again').addEventListener('click', () => { sfx.click(); send({ t: 'start' }); });
$('res-lobby').addEventListener('click', () => { sfx.click(); send({ t: 'lobby' }); });

// Игрок мог надеть другой скин в инвентаре на соседней вкладке.
window.addEventListener('focus', () => {
  if (state.joined) send({ t: 'refresh' });
});

$('shop-close').addEventListener('click', () => closeShop());

const autoShopInput = $('auto-shop');
autoShopInput.checked = settings.autoShop;
autoShopInput.addEventListener('change', () => {
  settings.autoShop = autoShopInput.checked;
  save('autoShop', settings.autoShop ? '1' : '0');
});

$('resume').addEventListener('click', requestLock);
document.querySelectorAll('[data-addr]').forEach((element) => { element.textContent = config.base; });
$('reconnect').addEventListener('click', () => location.reload());

const shareInput = $('share-url');
shareInput.value = config.share;
shareInput.addEventListener('focus', () => shareInput.select());
$('share-copy').addEventListener('click', async () => {
  // Буфер обмена по http работает не везде, поэтому есть запасной способ.
  shareInput.focus();
  shareInput.select();
  let copied = false;
  try {
    await navigator.clipboard.writeText(config.share);
    copied = true;
  } catch {
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }
  $('share-copy').textContent = copied ? 'Готово' : 'Ctrl+C';
  setTimeout(() => { $('share-copy').textContent = 'Копировать'; }, 1500);
});

document.querySelectorAll('[data-team]').forEach((button) => {
  button.addEventListener('click', () => send({ t: 'team', team: Number(button.dataset.team) }));
});
$('bot-add').addEventListener('click', () => send({ t: 'bot', op: 'add' }));
$('bot-remove').addEventListener('click', () => send({ t: 'bot', op: 'remove' }));

const sensInput = $('sens');
sensInput.value = settings.sens;
$('sens-value').textContent = settings.sens.toFixed(2);
sensInput.addEventListener('input', () => {
  settings.sens = Number(sensInput.value);
  $('sens-value').textContent = settings.sens.toFixed(2);
  save('sens', settings.sens);
});

const volInput = $('vol');
volInput.value = settings.volume;
$('vol-value').textContent = `${Math.round(settings.volume * 100)}%`;
volInput.addEventListener('input', () => {
  settings.volume = Number(volInput.value);
  $('vol-value').textContent = `${Math.round(settings.volume * 100)}%`;
  save('volume', settings.volume);
  sfx.setVolume(settings.volume);
});

const qualitySelect = $('quality');
qualitySelect.value = settings.quality;
qualitySelect.addEventListener('change', () => {
  const before = settings.quality;
  settings.quality = qualitySelect.value;
  save('quality', settings.quality);
  // Материалы, тени и сглаживание задаются при загрузке, поэтому страница перезагружается.
  if (before !== settings.quality) location.reload();
});

// Для отладки и автоматических проверок.
window.__poligon = { state, me };
