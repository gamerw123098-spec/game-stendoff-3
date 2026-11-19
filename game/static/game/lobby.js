import { loadProfile } from './profile.js';
import { SPRAYS, chooseSpray, chosenSpray, drawSpray } from './sprays.js';
import { DEVICE_NAMES, askDevice, changeDevice } from './device.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const loader = $('startup-screen');
if (loader) window.setTimeout(() => loader.classList.add('done'), 420);
const uiSfx = new Sfx(0.35);
const soundToggles = [...document.querySelectorAll('#ui-sound-toggle, #settings-sound-toggle')];
const uiSoundsEnabled = () => { try { return localStorage.getItem('poligon.uiSounds') === '1'; } catch { return false; } };
function setSoundPreference(enabled, persist = true) {
  soundToggles.forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = `ЗВУК: ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`;
  });
  if (persist) try { localStorage.setItem('poligon.uiSounds', enabled ? '1' : '0'); } catch { /* работает до перезагрузки */ }
}
setSoundPreference(uiSoundsEnabled(), false);
soundToggles.forEach((soundToggle) => soundToggle.addEventListener('click', () => {
  const enabled = soundToggle.getAttribute('aria-pressed') !== 'true';
  setSoundPreference(enabled);
  if (enabled) { uiSfx.unlock(); uiSfx.click(); }
}));
document.addEventListener('click', (event) => {
  if (event.target.closest('.sound-toggle')) return;
  if (uiSoundsEnabled() && event.target.closest('button, [data-tab-link]')) {
    uiSfx.unlock();
    uiSfx.click();
  }
}, true);

const showDevice = (device) => {
  $('device-name').textContent = DEVICE_NAMES[device];
  $('settings-device-name').textContent = DEVICE_NAMES[device];
};
askDevice().then(showDevice);
[$('change-device'), $('settings-change-device')].forEach((button) => button.addEventListener('click', () => changeDevice().then(showDevice)));

function remember(key, value) {
  try {
    if (key === 'nick') localStorage.setItem('poligon.nick', value);
    else sessionStorage.setItem(key, value);
  } catch {
    // Без хранилища игрок просто введёт ник ещё раз на странице игры.
  }
}

const nickInput = $('nick');
try {
  nickInput.value = localStorage.getItem('poligon.nick') || '';
} catch {
  nickInput.value = '';
}

// ---------- Вход по коду ----------
const codeInput = $('join-code');
codeInput.autocapitalize = 'characters';
codeInput.spellcheck = false;
// Код латинский, а раскладка у игрока часто русская. На обычной клавиатуре берём букву
// по положению клавиши, на экранной клавиатуре телефона заменяем похожие русские буквы.
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
codeInput.addEventListener('keydown', (event) => {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (!letter || event.ctrlKey || event.metaKey || event.altKey || !/[а-яё]/i.test(event.key)) return;
  event.preventDefault();
  codeInput.setRangeText(letter, codeInput.selectionStart, codeInput.selectionEnd, 'end');
  codeInput.dispatchEvent(new Event('input'));
});
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase()
    .replace(/[А-ЯЁ]/g, (char) => LOOKALIKE[char] ?? '')
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
});

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  remember('nick', nickInput.value.trim());
  // Страница игры увидит отметку и войдёт сама, без второго вопроса про ник.
  remember('poligon.autojoin', code);
  location.href = `/room/${encodeURIComponent(code)}/?nick=${encodeURIComponent(nickInput.value.trim())}`;
});

if (!location.hash || location.hash === '#play') {
  if (!nickInput.value) nickInput.focus();
  else codeInput.focus();
}

// ---------- Создание игры ----------
const targetField = $('target-field');
const targetInput = $('target');
const targetLabel = $('target-label');
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    // В гонке вооружений цель одна: пройти всё оружие, поэтому поля нет.
    const hasTarget = radio.dataset.target !== '';
    targetField.hidden = !hasTarget;
    targetInput.disabled = !hasTarget;
    if (!hasTarget) return;
    targetInput.min = radio.dataset.min;
    targetInput.max = radio.dataset.max;
    targetInput.value = radio.dataset.target;
    targetLabel.textContent = `Играем до (${radio.dataset.unit})`;
  });
});

$('create-form').addEventListener('submit', (event) => {
  if (!nickInput.value.trim()) {
    event.preventDefault();
    nickInput.focus();
    nickInput.setCustomValidity('Сначала введите ник');
    nickInput.reportValidity();
    return;
  }
  remember('nick', nickInput.value.trim());
  remember('poligon.autojoin', '*');
  let createNick = $('create-nick');
  if (!createNick) {
    createNick = document.createElement('input');
    createNick.type = 'hidden';
    createNick.name = 'nick';
    createNick.id = 'create-nick';
    event.currentTarget.append(createNick);
  }
  createNick.value = nickInput.value.trim();
});
nickInput.addEventListener('input', () => nickInput.setCustomValidity(''));

// ---------- Список игр ----------
const list = $('room-list');

function renderRooms(rooms) {
  list.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Пока никого нет. Создайте первую игру.';
    list.append(empty);
    return;
  }
  for (const room of rooms) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/room/${room.code}/`;
    link.addEventListener('click', () => {
      remember('nick', nickInput.value.trim());
      remember('poligon.autojoin', room.code);
    });

    const code = document.createElement('b');
    code.textContent = room.code;
    const mode = document.createElement('span');
    mode.textContent = `${room.modeName}, ${room.mapName}`;
    const count = document.createElement('span');
    count.className = 'count';
    const people = room.bots ? `${room.humans} + ${room.bots} бот.` : `${room.humans}`;
    count.textContent = `${people} · ${room.waiting ? 'ждут игроков' : 'идёт матч'}`;

    link.append(code, mode, count);
    item.append(link);
    list.append(item);
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/rooms/');
    if (response.ok) renderRooms((await response.json()).rooms);
  } catch {
    // Сервер мог перезапускаться: следующая попытка будет через несколько секунд.
  }
}

refresh();
setInterval(refresh, 3000);

// ---------- Главное меню: вкладки ----------
const TABS = ['play', 'cases', 'inventory', 'sprays', 'market', 'profile', 'settings'];
let inventoryLoaded = false;

function showTab(name) {
  const tab = TABS.includes(name) ? name : 'play';
  for (const id of TABS) $(`tab-${id}`).hidden = id !== tab;
  document.querySelectorAll('[role="tab"]').forEach((link) => {
    const on = link.dataset.tabLink === tab;
    link.classList.toggle('on', on);
    link.setAttribute('aria-selected', on);
  });
  // Кейсы и скины рисуются трёхмерным движком: грузим его только когда он нужен.
  if (['cases', 'inventory', 'market'].includes(tab) && !inventoryLoaded) {
    inventoryLoaded = true;
    import('./inventory.js');
  }
  window.dispatchEvent(new CustomEvent('poligon:tab', { detail: tab }));
  if (tab === 'profile') $('profile-nick').value = nickInput.value;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

// ---------- Карточка игрока вверху ----------
function renderChip(profile) {
  $('chip-nick').textContent = nickInput.value.trim() || 'Игрок';
  if (!profile) return;
  $('chip-gold').textContent = profile.gold ?? 0;
  $('chip-credits').textContent = profile.credits ?? 0;
  const caseCount = (profile.cases || 0) + (profile.standardCases || 0) + (profile.premiumCases || 0);
  $('cases-badge').hidden = caseCount < 1;
  $('cases-badge').textContent = caseCount;
  $('inv-cases').textContent = caseCount ? `Кейсов: ${caseCount}` : '';
}

nickInput.addEventListener('input', () => renderChip(null));
window.addEventListener('poligon:profile', (event) => renderChip(event.detail));
let ownedSprays = new Set(['smile']);
loadProfile().then((profile) => {
  renderChip(profile);
  if (profile?.sprays) { ownedSprays = new Set(profile.sprays); renderSprays(); }
});
window.addEventListener('poligon:profile', (event) => {
  ownedSprays = new Set(event.detail?.sprays || ['smile']);
  renderSprays();
});

// ---------- Спреи ----------
function sprayCanvas(id, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawSpray(canvas, id, nickInput.value.trim());
  return canvas;
}

function renderSprays() {
  let chosen = chosenSpray();
  if (!ownedSprays.has(chosen)) { chosen = 'smile'; chooseSpray(chosen); }
  const grid = $('spray-grid');
  grid.replaceChildren();
  for (const spray of SPRAYS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'spray-card';
    const owned = ownedSprays.has(spray.id);
    card.classList.toggle('on', spray.id === chosen);
    card.classList.toggle('locked', !owned);
    card.disabled = !owned;
    card.setAttribute('aria-pressed', spray.id === chosen);
    const name = document.createElement('b');
    name.textContent = spray.name;
    card.append(sprayCanvas(spray.id, 160), name);
    if (!owned) {
      const label = document.createElement('small');
      label.textContent = 'Найдите в кейсе';
      card.append(label);
    } else if (spray.id === chosen) {
      const label = document.createElement('small');
      label.textContent = 'Выбран';
      card.append(label);
    }
    card.addEventListener('click', () => {
      if (!owned) return;
      chooseSpray(spray.id);
      renderSprays();
    });
    grid.append(card);
  }
  drawSpray($('chip-spray'), chosen, nickInput.value.trim());
  $('inv-spray').textContent = SPRAYS.find((s) => s.id === chosen)?.name ?? '';
}

renderSprays();
nickInput.addEventListener('change', renderSprays);

// ---------- Профиль: ник ----------
$('nick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  nickInput.value = $('profile-nick').value.trim();
  remember('nick', nickInput.value);
  renderChip(null);
  renderSprays();
  $('nick-saved').hidden = false;
  setTimeout(() => { $('nick-saved').hidden = true; }, 1500);
});

function renderProfileHistory(profile) {
  const stats = document.querySelector('.profile-stats');
  if (stats) {
    for (const [id, label] of [['profile-played', '\u041c\u0430\u0442\u0447\u0438'], ['profile-losses', '\u041f\u043e\u0440\u0430\u0436\u0435\u043d\u0438\u044f']]) {
      if (!$(id)) { const cell = document.createElement('div'); const value = document.createElement('b'); value.id = id; value.textContent = '0'; const caption = document.createElement('small'); caption.textContent = label; cell.append(value, caption); stats.append(cell); }
    }
  }
  const matches = $('match-history');
  if (matches) {
    matches.replaceChildren();
    if (!profile?.recentMatches?.length) {
      const empty = document.createElement('p'); empty.className = 'sub-line'; empty.textContent = '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0445 \u043c\u0430\u0442\u0447\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.'; matches.append(empty);
    } else profile.recentMatches.forEach((match) => {
      const row = document.createElement('article'); row.className = `history-row ${match.result === 'L' ? 'loss' : match.result === 'D' ? 'draw' : ''}`;
      const modes = { tdm: '\u041a\u043e\u043c\u0430\u043d\u0434\u043d\u044b\u0439 \u0431\u043e\u0439', rounds: '\u0420\u0430\u0443\u043d\u0434\u044b', defuse: '\u041e\u0431\u0435\u0437\u0432\u0440\u0435\u0436\u0438\u0432\u0430\u043d\u0438\u0435', ffa: '\u041a\u0430\u0436\u0434\u044b\u0439 \u0437\u0430 \u0441\u0435\u0431\u044f', gungame: '\u0413\u043e\u043d\u043a\u0430 \u0432\u043e\u043e\u0440\u0443\u0436\u0435\u043d\u0438\u0439' };
      const title = document.createElement('b'); title.textContent = `${modes[match.mode] || match.mode} / ${match.map}`;
      const result = document.createElement('span'); result.className = 'history-result'; result.textContent = match.result === 'W' ? '\u041f\u041e\u0411\u0415\u0414\u0410' : match.result === 'L' ? '\u041f\u041e\u0420\u0410\u0416\u0415\u041d\u0418\u0415' : '\u041d\u0418\u0427\u042c\u042f';
      const kda = document.createElement('small'); kda.textContent = `\u0423/\u0421/\u041f ${match.kills}/${match.deaths}/${match.assists}`;
      row.append(title, result, kda); matches.append(row);
    });
  }
  const drops = $('drop-history');
  if (drops) {
    drops.replaceChildren();
    if (!profile?.recentDrops?.length) {
      const empty = document.createElement('p'); empty.className = 'sub-line'; empty.textContent = '\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0445 \u043a\u0435\u0439\u0441\u043e\u0432 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.'; drops.append(empty);
    } else profile.recentDrops.forEach((drop) => {
      const row = document.createElement('article'); row.className = 'history-row';
      const title = document.createElement('b'); title.textContent = `${drop.type === 'spray' ? '\u0421\u043f\u0440\u0435\u0439' : '\u0421\u043a\u0438\u043d'} / ${drop.name || drop.id}`;
      const source = document.createElement('small'); source.textContent = `\u041a\u0435\u0439\u0441: ${drop.case}`;
      const time = document.createElement('small'); time.textContent = new Date(drop.date).toLocaleDateString('ru-RU');
      row.append(title, time, source); drops.append(row);
    });
  }
  const played = $('profile-played'); if (played) played.textContent = profile?.matchesPlayed ?? 0;
  const losses = $('profile-losses'); if (losses) losses.textContent = profile?.matchesLost ?? 0;
}
window.addEventListener('poligon:profile', (event) => renderProfileHistory(event.detail));
loadProfile().then(renderProfileHistory);

const volumeSetting = $('volume-setting');
const qualitySetting = $('quality-setting');
const scaleSetting = $('ui-scale-setting');
const fullscreenSetting = $('fullscreen-setting');
if (volumeSetting) {
  let volume = 0.5;
  try { volume = Number(localStorage.getItem('poligon.volume') ?? 0.5); } catch { /* use default */ }
  volumeSetting.value = String(Math.max(0, Math.min(1, volume)));
  $('volume-label').textContent = `${Math.round(Number(volumeSetting.value) * 100)}%`;
  volumeSetting.addEventListener('input', () => {
    const value = Number(volumeSetting.value);
    $('volume-label').textContent = `${Math.round(value * 100)}%`;
    try { localStorage.setItem('poligon.volume', String(value)); } catch { /* session preference */ }
  });
}
if (qualitySetting) {
  let quality = 'medium';
  try { quality = localStorage.getItem('poligon.quality') || quality; } catch { /* use default */ }
  qualitySetting.value = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  qualitySetting.addEventListener('change', () => { try { localStorage.setItem('poligon.quality', qualitySetting.value); } catch { /* session preference */ } });
}
if (scaleSetting) {
  let scale = '1';
  try { scale = localStorage.getItem('poligon.uiScale') || scale; } catch { /* use default */ }
  scaleSetting.value = ['0.9', '1', '1.1'].includes(scale) ? scale : '1';
  document.documentElement.style.setProperty('--ui-scale', scaleSetting.value);
  scaleSetting.addEventListener('change', () => {
    document.documentElement.style.setProperty('--ui-scale', scaleSetting.value);
    try { localStorage.setItem('poligon.uiScale', scaleSetting.value); } catch { /* session preference */ }
  });
}
fullscreenSetting?.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* browser or device does not allow fullscreen */ }
});
