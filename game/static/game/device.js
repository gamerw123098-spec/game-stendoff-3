// На чём играет человек: телефон или компьютер. Спрашиваем при каждом заходе на сайт.
const SESSION_KEY = 'poligon.device';
const REMEMBER_KEY = 'poligon.lastDevice';

export const DEVICE_NAMES = { phone: 'Телефон или планшет', pc: 'Компьютер' };

function read(storage, key) {
  try {
    const value = storage.getItem(key);
    return value === 'phone' || value === 'pc' ? value : null;
  } catch {
    return null;
  }
}

function save(device) {
  for (const [storage, key] of [[sessionStorage, SESSION_KEY], [localStorage, REMEMBER_KEY]]) {
    try {
      storage.setItem(key, device);
    } catch {
      // Без хранилища вопрос просто появится ещё раз.
    }
  }
}

function apply(device) {
  document.body.classList.toggle('touch', device === 'phone');
  return device;
}

/** Показывает вопрос и возвращает выбранное устройство. */
function showDialog() {
  const looksLikePhone = window.matchMedia('(pointer: coarse)').matches;
  const dialog = document.createElement('div');
  dialog.className = 'device-ask';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'device-title');
  const box = document.createElement('div');
  box.className = 'device-box';
  const title = document.createElement('h2');
  title.id = 'device-title';
  title.textContent = 'На чём вы играете?';
  const note = document.createElement('p');
  note.textContent = 'От этого зависит управление: кнопки на экране или клавиатура и мышь.';
  const row = document.createElement('div');
  row.className = 'device-row';
  box.append(title, note, row);
  dialog.append(box);
  return new Promise((resolve) => {
    for (const device of ['phone', 'pc']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.device = device;
      button.textContent = DEVICE_NAMES[device];
      if ((device === 'phone') === looksLikePhone) button.className = 'primary';
      button.addEventListener('click', () => {
        dialog.remove();
        save(device);
        resolve(apply(device));
      });
      row.append(button);
    }
    document.body.append(dialog);
  });
}

/** Устройство для этой вкладки. Вопрос задаётся один раз за заход на сайт. */
export function askDevice() {
  const known = read(sessionStorage, SESSION_KEY);
  if (known) return Promise.resolve(apply(known));
  // Главное меню, открытое из матча в новой вкладке, не должно спрашивать снова.
  const fromGame = document.referrer.startsWith(`${location.origin}/room/`);
  const last = read(localStorage, REMEMBER_KEY);
  if (fromGame && last) return Promise.resolve(apply(last));
  return showDialog();
}

export function changeDevice() {
  return showDialog();
}
