// Управление на телефоне: джойстик, обзор пальцем и кнопки на экране.
// Кнопки посылают те же события, что клавиатура и мышь, поэтому правила игры едины для всех.

const STICK_RADIUS = 56;
const STICK_DEAD = 0.14;
const LOOK_SPEED = 2.3; // палец проходит меньше точек, чем мышь

const BUTTONS = [
  { id: 'fire', label: 'ОГОНЬ', mouse: 0, hold: true, look: true },
  { id: 'fire-left', label: 'ОГОНЬ', mouse: 0, hold: true, look: true },
  { id: 'aim', label: 'ПРИЦЕЛ', mouse: 2 },
  { id: 'jump', label: 'ПРЫЖОК', key: 'Space', hold: true },
  { id: 'crouch', label: 'СЕСТЬ', key: 'ShiftLeft', toggle: true },
  { id: 'reload', label: 'ПЕРЕЗ.', key: 'KeyR' },
  { id: 'use', label: 'БОМБА', key: 'KeyE', hold: true, only: 'defuse' },
  { id: 'he', label: 'ГРАН.', key: 'KeyG', only: 'shop', group: 'tools' },
  { id: 'flash', label: 'ВСПЫШ.', key: 'KeyF', only: 'shop', group: 'tools' },
  { id: 'smoke', label: 'ДЫМ', key: 'KeyC', only: 'shop', group: 'tools' },
  { id: 'spray', label: 'СПРЕЙ', key: 'KeyT', group: 'tools' },
  { id: 'inspect', label: 'ОСМОТР', key: 'KeyV', group: 'tools' },
  { id: 'menu', label: 'МЕНЮ', pause: true, group: 'system' },
  { id: 'score', label: 'СЧЁТ', key: 'Tab', hold: true, group: 'system' },
  { id: 'shop', label: 'МАГАЗ.', key: 'KeyB', only: 'shop', group: 'system' },
  { id: 'chat', label: 'ЧАТ', chat: true, group: 'system' },
];

function sendKey(type, code) {
  document.dispatchEvent(new KeyboardEvent(type, { code }));
}

function sendMouse(type, button) {
  document.dispatchEvent(new MouseEvent(type, { button }));
}

/** Экран на весь телефон и горизонтально. Не все браузеры это умеют, и это не мешает игре. */
export function enterFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request || document.fullscreenElement) return;
  try {
    const result = request.call(root, { navigationUI: 'hide' });
    result?.then?.(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  } catch {
    // На iPhone полноэкранного режима нет.
  }
}

export class TouchControls {
  constructor({ parent, look, pause, chat }) {
    this.look = look;
    this.pause = pause;
    this.chat = chat;
    this.forward = 0;
    this.strafe = 0;
    this.stick = null; // { id, x, y }
    this.lookers = new Map(); // палец → последняя точка
    this.held = new Map(); // кнопка → отпустить
    this.editing = false;
    this.layout = this._readLayout();

    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.hidden = true;
    this.pad = document.createElement('div');
    this.pad.id = 'touch-pad';
    this.base = document.createElement('div');
    this.base.id = 'touch-stick';
    this.base.hidden = true;
    this.knob = document.createElement('i');
    this.base.append(this.knob);
    const groups = { tools: document.createElement('div'), system: document.createElement('div') };
    groups.tools.id = 'touch-tools';
    groups.system.id = 'touch-system';
    this.root.append(this.pad, this.base, groups.tools, groups.system);
    this.buttons = BUTTONS.map((spec) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'touch-btn';
      button.id = `touch-${spec.id}`;
      button.textContent = spec.label;
      this._placeButton(button, spec.id);
      this._wire(button, spec);
      (groups[spec.group] || this.root).append(button);
      return { button, spec };
    });
    parent.prepend(this.root);

    this.pad.addEventListener('pointerdown', (event) => this._padDown(event));
    this.pad.addEventListener('pointermove', (event) => this._padMove(event));
    for (const type of ['pointerup', 'pointercancel']) this.pad.addEventListener(type, (event) => this._padUp(event));
    document.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  setActive(active) {
    this.root.hidden = !active;
    if (!active) this.reset();
  }

  _readLayout() {
    try { return JSON.parse(localStorage.getItem('poligon.touchLayout') || '{}'); }
    catch { return {}; }
  }

  _placeButton(button, id) {
    const point = this.layout[id];
    if (!point) return;
    button.style.left = `${point.x * 100}%`;
    button.style.top = `${point.y * 100}%`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  setEditing(editing) {
    this.editing = editing;
    this.root.classList.toggle('editing', editing);
    if (editing) {
      this.setActive(true);
      this.reset();
    }
  }

  saveLayout() {
    const bounds = this.root.getBoundingClientRect();
    for (const { button, spec } of this.buttons) {
      const rect = button.getBoundingClientRect();
      this.layout[spec.id] = {
        x: Math.max(0, Math.min(1, (rect.left - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (rect.top - bounds.top) / bounds.height)),
      };
    }
    try { localStorage.setItem('poligon.touchLayout', JSON.stringify(this.layout)); } catch {}
  }

  resetLayout() {
    this.layout = {};
    try { localStorage.removeItem('poligon.touchLayout'); } catch {}
    for (const { button } of this.buttons) {
      button.style.left = button.style.top = button.style.right = button.style.bottom = '';
    }
  }

  /** Гранаты и магазин есть не в каждом режиме, бомба только в обезвреживании. */
  setMode(shop, defuse) {
    for (const { button, spec } of this.buttons) {
      button.hidden = (spec.only === 'shop' && !shop) || (spec.only === 'defuse' && !defuse);
    }
  }

  reset() {
    for (const release of this.held.values()) release();
    this.held.clear();
    this.lookers.clear();
    this.stick = null;
    this.forward = this.strafe = 0;
    this.base.hidden = true;
  }

  _wire(button, spec) {
    let finger = null;
    let last = null;
    const press = () => {
      if (spec.pause) {
        this.pause();
        return;
      }
      if (spec.chat) {
        this.chat?.();
        return;
      }
      if (spec.toggle) {
        if (this.held.has(spec.id)) {
          this.held.get(spec.id)();
          this.held.delete(spec.id);
          return;
        }
        sendKey('keydown', spec.key);
        button.classList.add('on');
        this.held.set(spec.id, () => {
          sendKey('keyup', spec.key);
          button.classList.remove('on');
        });
        return;
      }
      button.classList.add('down');
      if (spec.mouse !== undefined) sendMouse('mousedown', spec.mouse);
      else sendKey('keydown', spec.key);
      const release = () => {
        button.classList.remove('down');
        if (spec.mouse !== undefined) sendMouse('mouseup', spec.mouse);
        else sendKey('keyup', spec.key);
      };
      if (spec.hold) this.held.set(spec.id, release);
      else release();
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (finger !== null) return;
      finger = event.pointerId;
      last = [event.clientX, event.clientY];
      button.setPointerCapture?.(event.pointerId);
      if (this.editing) {
        button.dataset.dragX = String(event.clientX - button.getBoundingClientRect().left);
        button.dataset.dragY = String(event.clientY - button.getBoundingClientRect().top);
        return;
      }
      press();
    });
    button.addEventListener('pointermove', (event) => {
      if (event.pointerId === finger && this.editing) {
        const bounds = this.root.getBoundingClientRect();
        const x = Math.max(0, Math.min(bounds.width - button.offsetWidth, event.clientX - bounds.left - Number(button.dataset.dragX)));
        const y = Math.max(0, Math.min(bounds.height - button.offsetHeight, event.clientY - bounds.top - Number(button.dataset.dragY)));
        button.style.left = `${x / bounds.width * 100}%`;
        button.style.top = `${y / bounds.height * 100}%`;
        button.style.right = button.style.bottom = 'auto';
        return;
      }
      if (event.pointerId !== finger || !spec.look) return;
      this.look((event.clientX - last[0]) * LOOK_SPEED, (event.clientY - last[1]) * LOOK_SPEED);
      last = [event.clientX, event.clientY];
    });
    const up = (event) => {
      if (event.pointerId !== finger) return;
      finger = null;
      if (this.editing) return;
      if (spec.hold && this.held.has(spec.id)) {
        this.held.get(spec.id)();
        this.held.delete(spec.id);
      }
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  _padDown(event) {
    event.preventDefault();
    this.pad.setPointerCapture?.(event.pointerId);
    if (event.clientX < window.innerWidth * 0.42 && !this.stick) {
      this.stick = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.base.hidden = false;
      this.base.style.left = `${event.clientX}px`;
      this.base.style.top = `${event.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.lookers.set(event.pointerId, [event.clientX, event.clientY]);
  }

  _padMove(event) {
    if (this.stick?.id === event.pointerId) {
      let dx = event.clientX - this.stick.x;
      let dy = event.clientY - this.stick.y;
      const distance = Math.hypot(dx, dy);
      if (distance > STICK_RADIUS) {
        dx *= STICK_RADIUS / distance;
        dy *= STICK_RADIUS / distance;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const strength = Math.min(distance, STICK_RADIUS) / STICK_RADIUS;
      this.strafe = strength < STICK_DEAD ? 0 : dx / STICK_RADIUS;
      this.forward = strength < STICK_DEAD ? 0 : -dy / STICK_RADIUS;
      return;
    }
    const last = this.lookers.get(event.pointerId);
    if (!last) return;
    this.look((event.clientX - last[0]) * LOOK_SPEED, (event.clientY - last[1]) * LOOK_SPEED);
    this.lookers.set(event.pointerId, [event.clientX, event.clientY]);
  }

  _padUp(event) {
    if (this.stick?.id === event.pointerId) {
      this.stick = null;
      this.forward = this.strafe = 0;
      this.base.hidden = true;
    }
    this.lookers.delete(event.pointerId);
  }
}
