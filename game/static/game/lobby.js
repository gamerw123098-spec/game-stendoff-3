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
  location.href = `/room/${encodeURIComponent(code)}/`;
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
