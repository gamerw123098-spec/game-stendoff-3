// Вкладки главного меню «Кейсы», «Инвентарь» и «Профиль»: открытие кейса и выбор скинов.
import { Sfx } from './audio.js';
import { api, loadProfile, storeCode } from './profile.js';
import { renderWeaponIcon } from './scene.js';
import { drawSpray } from './sprays.js';

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
  card.dataset.skinId = skin.id;
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
  if ($('standard-case-count')) $('standard-case-count').textContent = profile.standardCases || 0;
  if ($('premium-case-count')) $('premium-case-count').textContent = profile.premiumCases || 0;
  if ($('open-standard-case')) $('open-standard-case').disabled = (profile.standardCases || 0) < 1 || spinning;
  if ($('open-premium-case')) $('open-premium-case').disabled = (profile.premiumCases || 0) < 1 || spinning;
  if ($('buy-standard-case')) $('buy-standard-case').disabled = profile.credits < 100 || spinning;
  if ($('buy-premium-case')) $('buy-premium-case').disabled = profile.gold < 30 || spinning;
  $('profile-code').textContent = profile.code;
  let savedNick = '';
  try { savedNick = localStorage.getItem('poligon.nick') || ''; } catch { /* серверный ник остаётся источником данных */ }
  const stats = {
    nick: profile.nick || savedNick || 'Игрок',
    level: Math.floor((profile.wins || 0) / 5) + 1,
    wins: profile.wins || 0,
    items: profile.items.reduce((sum, item) => sum + item.count, 0),
    cases: profile.cases,
  };
  for (const [key, value] of Object.entries(stats)) {
    const target = $(`profile-${key === 'items' ? 'item-count' : key === 'cases' ? 'case-count' : key === 'nick' ? 'display-nick' : key}`);
    if (target) target.textContent = value;
  }
  const achievements = $('achievement-list');
  if (achievements) {
    const items = stats.items;
    achievements.querySelectorAll('.achievement').forEach((badge, index) => {
      const unlocked = index === 0 ? stats.wins >= 1 : index === 1 ? items >= 5 : items >= 20;
      badge.classList.toggle('unlocked', unlocked);
      badge.setAttribute('aria-label', `${badge.textContent}: ${unlocked ? 'получено' : 'ещё не получено'}`);
    });
  }

  const counts = new Map(profile.items.map((item) => [item.skin, item.count]));
  const equipped = new Set(Object.values(profile.equipped));
  const mine = $('my-items');
  mine.replaceChildren();
  for (const skin of filteredSkins([...counts.keys()])) {
    const worn = equipped.has(skin.id);
    const itemInfo = profile.items.find((item) => item.skin === skin.id);
    const listed = itemInfo?.listed || 0;
    const unavailable = listed >= (counts.get(skin.id) || 0);
    const card = skinCard(skin, { tag: 'button', count: counts.get(skin.id), worn, got: unavailable });
    card.setAttribute('aria-pressed', worn);
    card.disabled = unavailable;
    card.title = unavailable ? 'Выставлено на рынке' : worn ? 'Снять скин' : 'Надеть скин';
    if (unavailable) {
      const label = document.createElement('small');
      label.className = 'worn';
      label.textContent = 'На рынке';
      card.append(label);
    }
    card.addEventListener('click', () => equip(skin.id, !worn));
    mine.append(card);
  }
  $('empty-note').hidden = counts.size > 0;
  renderMarketSkinOptions();

  const all = $('all-items');
  if (all && !all.dataset.built) {
    all.replaceChildren();
    for (const skin of sortedSkins(Object.keys(catalog.skins))) all.append(skinCard(skin));
    all.dataset.built = '1';
  }
  all?.querySelectorAll('.skin-card').forEach((card) => card.classList.toggle('got', counts.has(card.dataset.skinId)));
  renderGoldStore();
}

function filteredSkins(ids) {
  let skins = sortedSkins(ids);
  const search = $('inventory-search')?.value.trim().toLocaleLowerCase('ru') || '';
  const rarity = $('inventory-rarity')?.value || '';
  const sort = $('inventory-sort')?.value || 'rarity';
  skins = skins.filter((skin) => (!rarity || skin.rarity === rarity)
    && (!search || `${skin.name} ${catalog.weapons[skin.weapon]}`.toLocaleLowerCase('ru').includes(search)));
  if (sort === 'name') skins.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (sort === 'weapon') skins.sort((a, b) => catalog.weapons[a.weapon].localeCompare(catalog.weapons[b.weapon], 'ru'));
  return skins;
}

function renderGoldStore() {
  const grid = $('gold-store-grid');
  if (!grid || $('tab-market')?.hidden) return;
  if (!grid.dataset.built) {
    for (const skin of sortedSkins(Object.keys(catalog.skins))) {
      const entry = document.createElement('article');
      entry.className = 'market-card';
      entry.dataset.skinId = skin.id;
      entry.append(skinCard(skin));
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'primary';
      buy.dataset.storeSkin = skin.id;
      buy.addEventListener('click', async () => {
        buy.disabled = true;
        try {
          const result = await api('/api/store/skin/', { code: profile.code, skin: skin.id });
          if (!result.ok) showError(result.data.error);
          else { profile = result.data; showError(''); }
        } catch { showError('Нет связи с сервером. Попробуйте ещё раз.'); }
        render();
      });
      entry.append(buy);
      grid.append(entry);
    }
    grid.dataset.built = '1';
  }
  const owned = new Set(profile.items.map((item) => item.skin));
  grid.querySelectorAll('.market-card').forEach((entry) => {
    const skin = catalog.skins[entry.dataset.skinId];
    const buy = entry.querySelector('[data-store-skin]');
    const price = catalog.goldPrices[skin.rarity];
    const isOwned = owned.has(skin.id);
    buy.textContent = isOwned ? `Ещё один · ${price} G` : `Купить · ${price} G`;
    buy.disabled = profile.gold < price || spinning;
    entry.querySelector('.skin-card')?.classList.toggle('got', isOwned);
  });
}

function renderMarketSkinOptions() {
  const select = $('market-skin');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  const equipped = new Set(Object.values(profile.equipped));
  const available = profile.items.filter((item) => item.count > (item.listed || 0))
    .map((item) => catalog.skins[item.skin]).filter((skin) => skin && !equipped.has(skin.id));
  if (!available.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Нет свободных скинов';
    select.append(option);
    select.disabled = true;
    $('market-list-form').querySelector('button[type="submit"]').disabled = true;
    return;
  }
  select.disabled = false;
  $('market-list-form').querySelector('button[type="submit"]').disabled = false;
  available.forEach((skin) => {
    const option = document.createElement('option');
    option.value = skin.id;
    option.textContent = `${catalog.weapons[skin.weapon]} · ${skin.name}`;
    select.append(option);
  });
  if (available.some((skin) => skin.id === previous)) select.value = previous;
}

async function refreshMarket() {
  const grid = $('market-listings');
  if (!grid || $('tab-market')?.hidden) return;
  try {
    const result = await api('/api/market/', { code: profile.code, action: 'listings' });
    if (!result.ok) throw new Error('market unavailable');
    const { listings } = result.data;
    grid.replaceChildren();
    if (!listings.length) {
      const empty = document.createElement('p');
      empty.className = 'sub-line';
      empty.textContent = 'Объявлений пока нет. Выставьте первый скин из инвентаря.';
      grid.append(empty);
      return;
    }
    for (const listing of listings) {
      const entry = document.createElement('article');
      entry.className = 'market-card';
      entry.append(skinCard(listing.skin));
      const seller = document.createElement('small');
      seller.className = 'market-seller';
      seller.textContent = `Продавец: ${listing.seller}`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = listing.mine ? '' : 'primary';
      action.textContent = listing.mine ? 'Снять с продажи' : `Купить · ${listing.price} G`;
      action.disabled = !listing.mine && profile.gold < listing.price;
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          const result = await api('/api/market/', { code: profile.code, action: listing.mine ? 'cancel' : 'buy', listing: listing.id });
          if (!result.ok) { showError(result.data.error); action.disabled = false; return; }
          profile = result.data.profile;
          showError('');
          refreshMarket();
        } catch { showError('Нет связи с сервером. Попробуйте ещё раз.'); }
        render();
      });
      entry.append(seller, action);
      grid.append(entry);
    }
  } catch {
    grid.textContent = 'Не удалось загрузить объявления. Попробуйте обновить страницу.';
  }
}

async function buyCase(type) {
  if (!profile || spinning) return;
  const button = $(type === 'standard' ? 'buy-standard-case' : 'buy-premium-case');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/case/buy/', { code: profile.code, type });
    if (!result.ok) { showError(result.data.error); return; }
    profile = result.data;
    showError('');
  } catch { showError('Нет связи с сервером. Попробуйте ещё раз.'); }
  finally { render(); }
}

async function listMarketSkin(event) {
  event.preventDefault();
  if (!profile) return;
  const price = Number($('market-price').value);
  const submit = $('market-list-form').querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api('/api/market/', { code: profile.code, action: 'list', skin: $('market-skin').value, price });
    if (!result.ok) { showError(result.data.error); return; }
    profile = result.data.profile;
    showError('');
  } catch { showError('Нет связи с сервером. Попробуйте ещё раз.'); }
  finally { submit.disabled = ![...$('market-skin').options].some((option) => option.value); }
  render();
  refreshMarket();
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

function rewardCard(reward) {
  if (reward.type !== 'spray') return skinCard(catalog.skins[reward.id]);
  const card = document.createElement('div');
  card.className = 'skin-card case-spray-card';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  drawSpray(canvas, reward.id, '');
  const title = document.createElement('b');
  title.textContent = catalog.sprays[reward.id] || 'Коллекционный спрей';
  const kind = document.createElement('small');
  kind.textContent = 'Спрей';
  card.append(canvas, title, kind);
  return card;
}

function spinTo(reward) {
  const track = $('track');
  track.replaceChildren();
  for (let i = 0; i < WIN_INDEX + 8; i++) {
    track.append(i === WIN_INDEX ? rewardCard(reward) : skinCard(fillerSkin()));
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

function showResult(reward) {
  lastSkin = reward.type === 'skin' ? catalog.skins[reward.id] : null;
  const image = $('result-image');
  const spray = $('result-spray');
  if (lastSkin) {
    const url = renderWeaponIcon(lastSkin.weapon, lastSkin);
    image.hidden = !url;
    if (url) image.src = url;
    if (spray) spray.hidden = true;
    $('result').style.setProperty('--rarity', catalog.rarities[lastSkin.rarity].color);
    $('result-rarity').textContent = catalog.rarities[lastSkin.rarity].name;
    $('result-name').textContent = `${catalog.weapons[lastSkin.weapon]} · ${lastSkin.name}`;
  } else {
    image.hidden = true;
    if (spray) { spray.hidden = false; drawSpray(spray, reward.id, ''); }
    $('result').style.setProperty('--rarity', '#50d9ad');
    $('result-rarity').textContent = 'Коллекционный спрей';
    $('result-name').textContent = catalog.sprays[reward.id] || 'Новый спрей';
  }
  $('result-equip').hidden = !lastSkin;
  $('result-equip').disabled = !lastSkin;
  $('result-equip').textContent = 'Надеть';
  $('result').hidden = false;
  sfx.kill();
  (lastSkin ? $('result-equip') : $('result-close')).focus();
}

async function openCase(type = 'free') {
  const available = type === 'free' ? profile?.cases : type === 'standard' ? profile?.standardCases : profile?.premiumCases;
  if (spinning || !profile || !available) return;
  sfx.unlock();
  showError('');
  spinning = true;
  $('open-case').disabled = true;
  try {
    const result = await api('/api/case/open/', { code: profile.code, type });
    if (!result.ok) {
      showError(result.data.error);
      return;
    }
    const reward = result.data.reward || { type: 'skin', id: result.data.skin };
    await spinTo(reward);
    profile = result.data.profile;
    showResult(reward);
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
  const premium = { common: 35, rare: 30, epic: 22, legendary: 10, mythic: 3 };
  for (const [key, rarity] of Object.entries(catalog.rarities)) {
    const item = document.createElement('li');
    item.style.setProperty('--rarity', rarity.color);
    const name = document.createElement('span');
    name.textContent = rarity.name;
    const chance = document.createElement('b');
    const standard = rarity.weight * 0.86;
    const special = premium[key] * 0.9;
    chance.textContent = `${String(rarity.weight).replace('.', ',')} / ${String(Number(standard.toFixed(2))).replace('.', ',')} / ${String(Number(special.toFixed(2))).replace('.', ',')}%`;
    item.append(name, chance);
    list.append(item);
  }
  const spray = document.createElement('li');
  spray.style.setProperty('--rarity', '#50d9ad');
  const label = document.createElement('span');
  label.textContent = 'Спрей';
  const chance = document.createElement('b');
  chance.textContent = '0% / 14% / 10%';
  spray.append(label, chance);
  list.append(spray);
}

$('open-case').addEventListener('click', openCase);
window.addEventListener('poligon:tab', (event) => {
  if (event.detail === 'market' && profile) { renderGoldStore(); refreshMarket(); }
});
if ($('buy-standard-case')) $('buy-standard-case').addEventListener('click', () => buyCase('standard'));
if ($('buy-premium-case')) $('buy-premium-case').addEventListener('click', () => buyCase('premium'));
if ($('open-standard-case')) $('open-standard-case').addEventListener('click', () => openCase('standard'));
if ($('open-premium-case')) $('open-premium-case').addEventListener('click', () => openCase('premium'));
if ($('market-list-form')) $('market-list-form').addEventListener('submit', listMarketSkin);
if ($('inventory-rarity')) {
  for (const [id, rarity] of Object.entries(catalog.rarities)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = rarity.name;
    $('inventory-rarity').append(option);
  }
  ['inventory-search', 'inventory-rarity', 'inventory-sort'].forEach((id) => $(id).addEventListener('input', () => profile && render()));
  $('inventory-rarity').addEventListener('change', () => profile && render());
  $('inventory-sort').addEventListener('change', () => profile && render());
}
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
    if ($('market-listings')) refreshMarket();
  } catch {
    showError('Нет связи с сервером. Попробуйте ещё раз.');
  }
});

buildOdds();
profile = await loadProfile();
if (profile) render();
else showError('Не удалось загрузить профиль. Проверьте, что сервер запущен.');
if (profile && $('market-listings') && !$('tab-market').hidden) refreshMarket();
