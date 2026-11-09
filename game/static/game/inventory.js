// Вкладки главного меню «Кейсы», «Инвентарь» и «Профиль»: открытие кейса и выбор скинов.
import { Sfx } from './audio.js';
import { api, loadProfile, storeCode } from './profile.js';
import { renderWeaponIcon } from './scene.js';

const catalog = JSON.parse(document.getElementById('catalog').textContent);
const $ = (id) => document.getElementById(id);
const sfx = new Sfx(0.4);

const CARD_STEP = 158; // ширина карточки вместе с отступом
const WIN_INDEX = 46;
const SPIN_MS = 5600;

let profile = null;
let spinning = false;
let lastSkin = null;

function skinCard(skin, { tag = 'div', count = 0, worn = false, got = false } = {}) {
  const card = document.createElement(tag);
  card.className = 'skin-card';
  if (tag === 'button') card.type = 'button';
  card.style.setProperty('--rarity', catalog.rarities[skin.rarity].color);
  card.classList.toggle('on', worn);
  card.classList.toggle('got', got);

  const url = renderWeaponIcon(skin.weapon, skin);
  let picture;
  if (url) {
    picture = document.createElement('img');
    picture.src = url;
    picture.alt = '';
  } else {
    picture = document.createElement('div');
    picture.className = 'no-image';
  }
  const title = document.createElement('b');
  title.textContent = skin.name;
  const weapon = document.createElement('small');
  weapon.textContent = catalog.weapons[skin.weapon];
  card.append(picture, title, weapon);

  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = `×${count}`;
    card.append(badge);
  }
  if (worn) {
    const label = document.createElement('small');
    label.className = 'worn';
    label.textContent = 'Надет';
    card.append(label);
  }
  return card;
}

function sortedSkins(ids) {
  const rarityOrder = Object.keys(catalog.rarities);
  return ids
    .map((id) => catalog.skins[id])
    .filter(Boolean)
    .sort((a, b) => rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity)
      || catalog.order.indexOf(a.weapon) - catalog.order.indexOf(b.weapon));
}

function render() {
  // Главное меню обновит счётчик кейсов в шапке.
  window.dispatchEvent(new CustomEvent('poligon:profile', { detail: profile }));
  $('case-count').textContent = profile.cases;
  $('open-case').disabled = profile.cases < 1 || spinning;
  $('profile-code').textContent = profile.code;

  const counts = new Map(profile.items.map((item) => [item.skin, item.count]));
  const equipped = new Set(Object.values(profile.equipped));
  const mine = $('my-items');
  mine.replaceChildren();
  for (const skin of sortedSkins([...counts.keys()])) {
    const worn = equipped.has(skin.id);
    const card = skinCard(skin, { tag: 'button', count: counts.get(skin.id), worn });
    card.setAttribute('aria-pressed', worn);
    card.title = worn ? 'Снять скин' : 'Надеть скин';
    card.addEventListener('click', () => equip(skin.id, !worn));
    mine.append(card);
  }
  $('empty-note').hidden = counts.size > 0;

  const all = $('all-items');
  all.replaceChildren();
  for (const skin of sortedSkins(Object.keys(catalog.skins))) {
    all.append(skinCard(skin, { got: counts.has(skin.id) }));
  }
}

function showError(text) {
  $('inv-error').textContent = text;
  $('inv-error').hidden = !text;
}

async function equip(skin, value) {
  showError('');
  try {
    const result = await api('/api/equip/', { code: profile.code, skin, equip: value });
    if (!result.ok) {
      showError(result.data.error);
      return false;
    }
    profile = result.data;
    render();
    return true;
  } catch {
    showError('Нет связи с сервером. Попробуйте ещё раз.');
    return false;
  }
}

// Случайная карточка для ленты рулетки. Результат на неё не влияет: его выбирает сервер.
function fillerSkin() {
  const names = Object.keys(catalog.rarities);
  let roll = Math.random() * 100;
  let rarity = names[0];
  for (const name of names) {
    roll -= catalog.rarities[name].weight;
    if (roll <= 0) {
      rarity = name;
      break;
    }
  }
  const options = Object.values(catalog.skins).filter((skin) => skin.rarity === rarity);
  return options[Math.floor(Math.random() * options.length)];
}

function spinTo(skinId) {
  const track = $('track');
  track.replaceChildren();
  for (let i = 0; i < WIN_INDEX + 8; i++) {
    const skin = i === WIN_INDEX ? catalog.skins[skinId] : fillerSkin();
    track.append(skinCard(skin));
  }
  $('result').hidden = true;
  $('roulette').hidden = false;

  const center = track.parentElement.clientWidth / 2;
  // Лента останавливается в случайном месте выигрышной карточки, чтобы каждый раз было по-разному.
  const inside = 12 + Math.random() * 126;
  const distance = WIN_INDEX * CARD_STEP + inside - center;
  const quick = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = quick ? 1 : SPIN_MS;
  track.style.transform = 'translateX(0)';

  // Лента двигается покадрово: CSS-анимация такого длинного слоя на слабой графике не отрисовывалась.
  return new Promise((resolve) => {
    const start = performance.now();
    let lastCard = Math.floor(center / CARD_STEP);
    const step = (now) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      const offset = distance * (1 - (1 - progress) ** 4);
      track.style.transform = `translateX(${-offset}px)`;
      const card = Math.floor((offset + center) / CARD_STEP);
      if (card !== lastCard) {
        lastCard = card;
        sfx.tick();
      }
      if (progress < 1) requestAnimationFrame(step);
      else setTimeout(resolve, 250);
    };
    requestAnimationFrame(step);
  });
}

function showResult(skinId) {
  const skin = catalog.skins[skinId];
  const rarity = catalog.rarities[skin.rarity];
  lastSkin = skin;
  const image = $('result-image');
  const url = renderWeaponIcon(skin.weapon, skin);
  image.hidden = !url;
  if (url) image.src = url;
  $('result').style.setProperty('--rarity', rarity.color);
  $('result-rarity').textContent = rarity.name;
  $('result-name').textContent = `${catalog.weapons[skin.weapon]} · ${skin.name}`;
  $('result-equip').disabled = false;
  $('result-equip').textContent = 'Надеть';
  $('result').hidden = false;
  sfx.kill();
  $('result-equip').focus();
}

async function openCase() {
  if (spinning || !profile || profile.cases < 1) return;
  sfx.unlock();
  showError('');
  spinning = true;
  $('open-case').disabled = true;
  try {
    const result = await api('/api/case/open/', { code: profile.code });
    if (!result.ok) {
      showError(result.data.error);
      return;
    }
    await spinTo(result.data.skin);
    profile = result.data.profile;
    showResult(result.data.skin);
  } catch {
    showError('Нет связи с сервером. Попробуйте ещё раз.');
    $('roulette').hidden = true;
  } finally {
    spinning = false;
    if (profile) render();
  }
}

function buildOdds() {
  const list = $('odds');
  for (const rarity of Object.values(catalog.rarities)) {
    const item = document.createElement('li');
    item.style.setProperty('--rarity', rarity.color);
    const name = document.createElement('span');
    name.textContent = rarity.name;
    const chance = document.createElement('b');
    chance.textContent = `${String(rarity.weight).replace('.', ',')}%`;
    item.append(name, chance);
    list.append(item);
  }
}

$('open-case').addEventListener('click', openCase);
$('result-close').addEventListener('click', () => { $('roulette').hidden = true; });
$('result-equip').addEventListener('click', async () => {
  if (lastSkin && await equip(lastSkin.id, true)) {
    $('result-equip').textContent = 'Надет';
    $('result-equip').disabled = true;
  }
});

$('restore-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const code = $('restore-code').value.trim().toUpperCase();
  try {
    const result = await api('/api/profile/', { code });
    if (!result.ok) {
      alert(result.data.error);
      return;
    }
    storeCode(result.data.code);
    profile = result.data;
    $('restore-code').value = '';
    render();
  } catch {
    showError('Нет связи с сервером. Попробуйте ещё раз.');
  }
});

buildOdds();
profile = await loadProfile();
if (profile) render();
else showError('Не удалось загрузить профиль. Проверьте, что сервер запущен.');
