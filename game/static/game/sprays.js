// Рисунки для спреев. Каждый рисуется кодом на холсте, поэтому картинки не нужны.
// Один и тот же код рисует превью в главном меню и спрей на стене в игре.

export const SPRAYS = [
  { id: 'smile', name: 'Смайлик' },
  { id: 'heart', name: 'Сердце' },
  { id: 'skull', name: 'Череп' },
  { id: 'crown', name: 'Корона' },
  { id: 'bolt', name: 'Молния' },
  { id: 'star', name: 'Звезда' },
  { id: 'gg', name: 'GG' },
  { id: 'fire', name: 'Огонь' },
  { id: 'cat', name: 'Кот' },
  { id: 'ghost', name: 'Призрак' },
  { id: 'eye', name: 'Глаз' },
  { id: 'rocket', name: 'Ракета' },
  { id: 'pizza', name: 'Пицца' },
  { id: 'cactus', name: 'Кактус' },
  { id: 'target', name: 'Мишень' },
  { id: 'sun', name: 'Солнце' },
  { id: 'moon', name: 'Луна' },
  { id: 'rainbow', name: 'Радуга' },
  { id: 'flower', name: 'Цветок' },
  { id: 'mushroom', name: 'Гриб' },
  { id: 'snowflake', name: 'Снежинка' },
  { id: 'watermelon', name: 'Арбуз' },
  { id: 'donut', name: 'Пончик' },
  { id: 'icecream', name: 'Мороженое' },
  { id: 'burger', name: 'Бургер' },
  { id: 'frog', name: 'Лягушка' },
  { id: 'duck', name: 'Уточка' },
  { id: 'paw', name: 'Лапка' },
  { id: 'robot', name: 'Робот' },
  { id: 'alien', name: 'Пришелец' },
  { id: 'ufo', name: 'Тарелка' },
  { id: 'bomb', name: 'Бомбочка' },
  { id: 'shuriken', name: 'Сюрикен' },
  { id: 'shield', name: 'Щит' },
  { id: 'diamond', name: 'Алмаз' },
  { id: 'music', name: 'Музыка' },
  { id: 'dice', name: 'Кубик' },
  { id: 'gamepad', name: 'Геймпад' },
  { id: 'rip', name: 'Надгробие' },
  { id: 'ez', name: 'EZ' },
  { id: 'wow', name: 'WOW' },
  { id: 'lol', name: 'LOL' },
  { id: 'e404', name: 'Ошибка 404' },
  { id: 'five', name: 'Пятёрка' },
  { id: 'name', name: 'Мой ник' },
];

const SPRAY_KEY = 'poligon.spray';

// Старые браузеры не умеют скруглённые прямоугольники: рисуем обычные.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h) {
    this.rect(x, y, w, h);
  };
}

export function chosenSpray() {
  try {
    const id = localStorage.getItem(SPRAY_KEY);
    return SPRAYS.some((s) => s.id === id) ? id : 'smile';
  } catch {
    return 'smile';
  }
}

export function chooseSpray(id) {
  try {
    localStorage.setItem(SPRAY_KEY, id);
  } catch {
    // Выбор просто не запомнится.
  }
}

// ---------- Кисти ----------
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Краска из баллончика: мягкий край и брызги вокруг. */
function paint(ctx, color, draw, blur = 0.025) {
  const S = ctx.canvas.width;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = S * blur;
  ctx.beginPath();
  draw();
  ctx.restore();
}

function outline(ctx, width, draw) {
  const S = ctx.canvas.width;
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = S * width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = S * 0.015;
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.restore();
}

/** Подтёки краски вниз от нижнего края рисунка. */
function drips(ctx, color, seed, xs) {
  const S = ctx.canvas.width;
  const r = rand(seed);
  ctx.save();
  ctx.fillStyle = color;
  for (const [x, y] of xs) {
    const length = S * (0.05 + r() * 0.12);
    const width = S * (0.012 + r() * 0.01);
    ctx.fillRect(x * S - width / 2, y * S, width, length);
    ctx.beginPath();
    ctx.arc(x * S, y * S + length, width * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function speckles(ctx, color, seed, count = 90) {
  const S = ctx.canvas.width;
  const r = rand(seed);
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const angle = r() * Math.PI * 2;
    const dist = S * (0.3 + r() * 0.2);
    ctx.globalAlpha = 0.3 + r() * 0.5;
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(angle) * dist, S / 2 + Math.sin(angle) * dist, S * (0.003 + r() * 0.006), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function circle(ctx, x, y, radius) {
  const S = ctx.canvas.width;
  ctx.moveTo(x * S + radius * S, y * S);
  ctx.arc(x * S, y * S, radius * S, 0, Math.PI * 2);
}

function poly(ctx, points) {
  const S = ctx.canvas.width;
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)));
  ctx.closePath();
}

function star(points, cx, cy, outer, inner, spikes = 5, turn = -Math.PI / 2) {
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = turn + (i * Math.PI) / spikes;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function heartPath(ctx, cx, cy, size) {
  const S = ctx.canvas.width;
  const x = cx * S;
  const y = cy * S;
  const k = size * S;
  ctx.moveTo(x, y + k * 0.9);
  ctx.bezierCurveTo(x - k * 1.4, y - k * 0.1, x - k * 0.75, y - k * 1.05, x, y - k * 0.45);
  ctx.bezierCurveTo(x + k * 0.75, y - k * 1.05, x + k * 1.4, y - k * 0.1, x, y + k * 0.9);
  ctx.closePath();
}

function text(ctx, value, size, color, y = 0.5) {
  const S = ctx.canvas.width;
  ctx.save();
  ctx.font = `900 ${Math.round(S * size)}px Impact, "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(value).width;
  const fit = Math.min(1, (S * 0.9) / Math.max(width, 1));
  ctx.translate(S / 2, S * y);
  ctx.rotate(-0.12);
  ctx.scale(fit, fit);
  ctx.lineJoin = 'round';
  ctx.lineWidth = S * Math.min(0.05, size * 0.13); // у мелких надписей контур тоньше, иначе буквы слипаются
  ctx.strokeStyle = '#111';
  ctx.strokeText(value, 0, 0);
  ctx.shadowColor = color;
  ctx.shadowBlur = S * 0.03;
  ctx.fillStyle = color;
  ctx.fillText(value, 0, 0);
  ctx.lineWidth = S * Math.min(0.012, size * 0.02);
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.strokeText(value, -S * 0.006, -S * 0.006);
  ctx.restore();
}

/** Линия краски выбранного цвета. */
function brush(ctx, color, width, draw) {
  const S = ctx.canvas.width;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = S * width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.restore();
}

/** Заливка с чёрным контуром: контур снизу, поэтому внутри сложных фигур нет лишних линий. */
function sticker(ctx, color, draw, width = 0.06) {
  outline(ctx, width, draw);
  paint(ctx, color, () => { draw(); ctx.fill(); }, 0.008);
}

function oval(ctx, x, y, rx, ry, turn = 0) {
  const S = ctx.canvas.width;
  ctx.moveTo(S * (x + rx * Math.cos(turn)), S * (y + rx * Math.sin(turn)));
  ctx.ellipse(S * x, S * y, S * rx, S * ry, turn, 0, Math.PI * 2);
}

function box(ctx, x, y, w, h, r = 0) {
  const S = ctx.canvas.width;
  if (r) ctx.roundRect(S * x, S * y, S * w, S * h, S * r);
  else ctx.rect(S * x, S * y, S * w, S * h);
}

function fillShape(ctx, color, draw, blur = 0.004) {
  paint(ctx, color, () => { draw(); ctx.fill(); }, blur);
}

function tilted(ctx, angle, draw) {
  const S = ctx.canvas.width;
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(angle);
  ctx.translate(-S / 2, -S / 2);
  draw();
  ctx.restore();
}

// ---------- Рисунки ----------
const DESIGNS = {
  smile(ctx) {
    const S = ctx.canvas.width;
    paint(ctx, '#ffd23a', () => { circle(ctx, 0.5, 0.48, 0.34); ctx.fill(); });
    outline(ctx, 0.035, () => circle(ctx, 0.5, 0.48, 0.34));
    paint(ctx, '#111', () => {
      circle(ctx, 0.39, 0.4, 0.045);
      circle(ctx, 0.61, 0.4, 0.045);
      ctx.fill();
    }, 0.005);
    outline(ctx, 0.04, () => ctx.arc(S / 2, S * 0.5, S * 0.19, 0.2, Math.PI - 0.2));
    drips(ctx, '#ffd23a', 3, [[0.38, 0.8], [0.55, 0.81], [0.66, 0.77]]);
  },
  heart(ctx) {
    paint(ctx, '#ff3b5c', () => { heartPath(ctx, 0.5, 0.5, 0.3); ctx.fill(); });
    outline(ctx, 0.035, () => heartPath(ctx, 0.5, 0.5, 0.3));
    paint(ctx, 'rgba(255,255,255,.75)', () => { circle(ctx, 0.36, 0.36, 0.05); ctx.fill(); }, 0.02);
    drips(ctx, '#ff3b5c', 7, [[0.45, 0.72], [0.53, 0.74]]);
  },
  skull(ctx) {
    const S = ctx.canvas.width;
    paint(ctx, '#f2efe6', () => {
      circle(ctx, 0.5, 0.42, 0.28);
      ctx.rect(S * 0.33, S * 0.52, S * 0.34, S * 0.2);
      ctx.fill();
    });
    outline(ctx, 0.03, () => {
      ctx.arc(S * 0.5, S * 0.42, S * 0.28, Math.PI * 0.82, Math.PI * 2.18);
      ctx.lineTo(S * 0.67, S * 0.72);
      ctx.lineTo(S * 0.33, S * 0.72);
      ctx.closePath();
    });
    paint(ctx, '#111', () => {
      circle(ctx, 0.39, 0.43, 0.075);
      circle(ctx, 0.61, 0.43, 0.075);
      poly(ctx, [[0.5, 0.52], [0.46, 0.6], [0.54, 0.6]]);
      ctx.fill();
    }, 0.005);
    outline(ctx, 0.018, () => {
      for (const x of [0.41, 0.47, 0.53, 0.59]) {
        ctx.moveTo(S * x, S * 0.64);
        ctx.lineTo(S * x, S * 0.72);
      }
    });
  },
  crown(ctx) {
    const shape = [[0.2, 0.68], [0.2, 0.34], [0.35, 0.5], [0.5, 0.26], [0.65, 0.5], [0.8, 0.34], [0.8, 0.68]];
    paint(ctx, '#ffc21a', () => { poly(ctx, shape); ctx.fill(); });
    outline(ctx, 0.035, () => poly(ctx, shape));
    paint(ctx, '#e8303f', () => { circle(ctx, 0.5, 0.58, 0.045); ctx.fill(); }, 0.01);
    paint(ctx, '#2f9dff', () => { circle(ctx, 0.32, 0.6, 0.035); circle(ctx, 0.68, 0.6, 0.035); ctx.fill(); }, 0.01);
    drips(ctx, '#ffc21a', 11, [[0.3, 0.68], [0.62, 0.68]]);
  },
  bolt(ctx) {
    const shape = [[0.58, 0.12], [0.26, 0.55], [0.47, 0.55], [0.38, 0.88], [0.76, 0.42], [0.54, 0.42]];
    paint(ctx, '#36d7ff', () => { poly(ctx, shape); ctx.fill(); }, 0.05);
    outline(ctx, 0.03, () => poly(ctx, shape));
    speckles(ctx, '#36d7ff', 5, 60);
  },
  star(ctx) {
    const shape = star([], 0.5, 0.52, 0.36, 0.15);
    paint(ctx, '#b25bff', () => { poly(ctx, shape); ctx.fill(); });
    outline(ctx, 0.035, () => poly(ctx, shape));
    paint(ctx, 'rgba(255,255,255,.8)', () => { poly(ctx, star([], 0.5, 0.52, 0.12, 0.05)); ctx.fill(); }, 0.02);
    speckles(ctx, '#b25bff', 9, 50);
  },
  gg(ctx) {
    text(ctx, 'GG', 0.5, '#5dff7a');
    drips(ctx, '#5dff7a', 13, [[0.3, 0.68], [0.47, 0.66], [0.7, 0.62]]);
  },
  fire(ctx) {
    const S = ctx.canvas.width;
    const flame = (scale, color) => paint(ctx, color, () => {
      const k = scale;
      ctx.moveTo(S * 0.5, S * (0.86));
      ctx.bezierCurveTo(S * (0.5 - 0.32 * k), S * 0.84, S * (0.5 - 0.3 * k), S * (0.86 - 0.42 * k), S * (0.5 - 0.1 * k), S * (0.86 - 0.7 * k));
      ctx.bezierCurveTo(S * (0.5 - 0.06 * k), S * (0.86 - 0.5 * k), S * (0.5 + 0.06 * k), S * (0.86 - 0.5 * k), S * (0.5 + 0.08 * k), S * (0.86 - 0.62 * k));
      ctx.bezierCurveTo(S * (0.5 + 0.34 * k), S * (0.86 - 0.36 * k), S * (0.5 + 0.32 * k), S * 0.84, S * 0.5, S * 0.86);
      ctx.fill();
    }, 0.04);
    flame(1, '#ff4a1c');
    flame(0.7, '#ff9d1c');
    flame(0.4, '#ffe45c');
  },
  cat(ctx) {
    const S = ctx.canvas.width;
    const head = () => {
      circle(ctx, 0.5, 0.55, 0.27);
      poly(ctx, [[0.27, 0.45], [0.27, 0.18], [0.45, 0.32]]);
      poly(ctx, [[0.73, 0.45], [0.73, 0.18], [0.55, 0.32]]);
    };
    paint(ctx, '#ff8a2a', () => { head(); ctx.fill(); });
    outline(ctx, 0.03, () => circle(ctx, 0.5, 0.55, 0.27));
    paint(ctx, '#2bd16a', () => { circle(ctx, 0.41, 0.52, 0.05); circle(ctx, 0.59, 0.52, 0.05); ctx.fill(); }, 0.01);
    paint(ctx, '#111', () => { ctx.ellipse(S * 0.41, S * 0.52, S * 0.012, S * 0.04, 0, 0, 7); ctx.ellipse(S * 0.59, S * 0.52, S * 0.012, S * 0.04, 0, 0, 7); ctx.fill(); }, 0);
    paint(ctx, '#ff5d8a', () => { poly(ctx, [[0.47, 0.62], [0.53, 0.62], [0.5, 0.66]]); ctx.fill(); }, 0.005);
    outline(ctx, 0.012, () => {
      for (const side of [-1, 1]) {
        for (const dy of [-0.02, 0.02]) {
          ctx.moveTo(S * (0.5 + side * 0.08), S * (0.65 + dy));
          ctx.lineTo(S * (0.5 + side * 0.3), S * (0.63 + dy * 2));
        }
      }
    });
  },
  ghost(ctx) {
    const S = ctx.canvas.width;
    const body = () => {
      ctx.moveTo(S * 0.25, S * 0.8);
      ctx.lineTo(S * 0.25, S * 0.45);
      ctx.arc(S * 0.5, S * 0.45, S * 0.25, Math.PI, 0);
      ctx.lineTo(S * 0.75, S * 0.8);
      for (let i = 0; i < 4; i++) {
        const x = 0.75 - i * 0.125;
        ctx.quadraticCurveTo(S * (x - 0.03), S * 0.72, S * (x - 0.0625), S * 0.8);
        ctx.quadraticCurveTo(S * (x - 0.09), S * 0.88, S * (x - 0.125), S * 0.8);
      }
      ctx.closePath();
    };
    paint(ctx, '#e9f5ff', () => { body(); ctx.fill(); }, 0.05);
    outline(ctx, 0.028, body);
    paint(ctx, '#1a1f40', () => {
      ctx.ellipse(S * 0.41, S * 0.45, S * 0.04, S * 0.065, 0, 0, 7);
      ctx.ellipse(S * 0.59, S * 0.45, S * 0.04, S * 0.065, 0, 0, 7);
      ctx.fill();
    }, 0);
    paint(ctx, '#1a1f40', () => { ctx.ellipse(S * 0.5, S * 0.6, S * 0.05, S * 0.035, 0, 0, 7); ctx.fill(); }, 0);
  },
  eye(ctx) {
    const S = ctx.canvas.width;
    const shape = () => {
      ctx.moveTo(S * 0.12, S * 0.5);
      ctx.quadraticCurveTo(S * 0.5, S * 0.12, S * 0.88, S * 0.5);
      ctx.quadraticCurveTo(S * 0.5, S * 0.88, S * 0.12, S * 0.5);
      ctx.closePath();
    };
    paint(ctx, '#ffffff', () => { shape(); ctx.fill(); });
    outline(ctx, 0.035, shape);
    paint(ctx, '#18b6ff', () => { circle(ctx, 0.5, 0.5, 0.15); ctx.fill(); }, 0.02);
    paint(ctx, '#111', () => { circle(ctx, 0.5, 0.5, 0.07); ctx.fill(); }, 0);
    paint(ctx, '#fff', () => { circle(ctx, 0.46, 0.45, 0.025); ctx.fill(); }, 0);
    drips(ctx, '#18b6ff', 17, [[0.5, 0.66]]);
  },
  rocket(ctx) {
    const S = ctx.canvas.width;
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(0.6);
    ctx.translate(-S / 2, -S / 2);
    const body = () => {
      ctx.moveTo(S * 0.5, S * 0.1);
      ctx.quadraticCurveTo(S * 0.66, S * 0.3, S * 0.62, S * 0.68);
      ctx.lineTo(S * 0.38, S * 0.68);
      ctx.quadraticCurveTo(S * 0.34, S * 0.3, S * 0.5, S * 0.1);
      ctx.closePath();
    };
    paint(ctx, '#ff9b1f', () => { poly(ctx, [[0.42, 0.68], [0.58, 0.68], [0.5, 0.92]]); ctx.fill(); }, 0.06);
    paint(ctx, '#e83a3a', () => { poly(ctx, [[0.38, 0.5], [0.26, 0.74], [0.4, 0.68]]); poly(ctx, [[0.62, 0.5], [0.74, 0.74], [0.6, 0.68]]); ctx.fill(); });
    paint(ctx, '#e8edf2', () => { body(); ctx.fill(); });
    outline(ctx, 0.028, body);
    paint(ctx, '#2f9dff', () => { circle(ctx, 0.5, 0.38, 0.06); ctx.fill(); }, 0.01);
    outline(ctx, 0.02, () => circle(ctx, 0.5, 0.38, 0.06));
    ctx.restore();
  },
  pizza(ctx) {
    const slice = [[0.5, 0.86], [0.18, 0.24], [0.82, 0.24]];
    paint(ctx, '#f2c45a', () => { poly(ctx, slice); ctx.fill(); });
    paint(ctx, '#c9842f', () => { poly(ctx, [[0.16, 0.2], [0.84, 0.2], [0.82, 0.28], [0.18, 0.28]]); ctx.fill(); });
    outline(ctx, 0.03, () => poly(ctx, slice));
    paint(ctx, '#d6352b', () => {
      circle(ctx, 0.42, 0.4, 0.06);
      circle(ctx, 0.6, 0.38, 0.055);
      circle(ctx, 0.5, 0.58, 0.05);
      ctx.fill();
    }, 0.01);
    drips(ctx, '#f2c45a', 23, [[0.46, 0.76], [0.55, 0.72]]);
  },
  cactus(ctx) {
    const S = ctx.canvas.width;
    const shape = () => {
      ctx.roundRect(S * 0.42, S * 0.18, S * 0.16, S * 0.62, S * 0.08);
      ctx.roundRect(S * 0.22, S * 0.36, S * 0.12, S * 0.26, S * 0.06);
      ctx.roundRect(S * 0.66, S * 0.28, S * 0.12, S * 0.26, S * 0.06);
      ctx.rect(S * 0.28, S * 0.54, S * 0.16, S * 0.08);
      ctx.rect(S * 0.56, S * 0.46, S * 0.16, S * 0.08);
    };
    paint(ctx, '#3fbf4f', () => { shape(); ctx.fill(); });
    outline(ctx, 0.025, () => {
      ctx.roundRect(S * 0.42, S * 0.18, S * 0.16, S * 0.62, S * 0.08);
    });
    paint(ctx, '#c97a3a', () => { ctx.rect(S * 0.32, S * 0.78, S * 0.36, S * 0.12); ctx.fill(); });
    paint(ctx, '#ff5da2', () => { circle(ctx, 0.5, 0.17, 0.05); ctx.fill(); }, 0.01);
  },
  target(ctx) {
    const colors = ['#f23b3b', '#ffffff', '#f23b3b', '#ffffff', '#f23b3b'];
    colors.forEach((color, i) => paint(ctx, color, () => { circle(ctx, 0.5, 0.5, 0.36 - i * 0.07); ctx.fill(); }, 0.01));
    outline(ctx, 0.03, () => circle(ctx, 0.5, 0.5, 0.36));
    speckles(ctx, '#f23b3b', 31, 70);
  },
  sun(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#ff9d1c', () => poly(ctx, star([], 0.5, 0.5, 0.45, 0.28, 12)));
    sticker(ctx, '#ffd93a', () => circle(ctx, 0.5, 0.5, 0.24), 0.04);
    fillShape(ctx, '#111', () => {
      poly(ctx, [[0.33, 0.43], [0.48, 0.43], [0.46, 0.54], [0.36, 0.54]]);
      poly(ctx, [[0.52, 0.43], [0.67, 0.43], [0.64, 0.54], [0.54, 0.54]]);
      box(ctx, 0.46, 0.44, 0.08, 0.025);
    });
    outline(ctx, 0.022, () => ctx.arc(S * 0.5, S * 0.56, S * 0.1, 0.25, Math.PI - 0.25));
  },
  moon(ctx) {
    const S = ctx.canvas.width;
    const shape = () => {
      ctx.arc(S * 0.46, S * 0.5, S * 0.34, 0.4768, 4.9966);
      ctx.arc(S * 0.6, S * 0.44, S * 0.27, -1.737, 0.9271, true);
      ctx.closePath();
    };
    sticker(ctx, '#ffe27a', shape);
    fillShape(ctx, '#e0b94a', () => { circle(ctx, 0.27, 0.5, 0.04); circle(ctx, 0.36, 0.68, 0.03); });
    for (const [x, y, size] of [[0.72, 0.3, 0.09], [0.82, 0.56, 0.06], [0.62, 0.48, 0.05]]) {
      sticker(ctx, '#ffffff', () => poly(ctx, star([], x, y, size, size * 0.42)), 0.025);
    }
  },
  rainbow(ctx) {
    const S = ctx.canvas.width;
    ['#f23b3b', '#ff9d1c', '#ffe04a', '#3fd16a', '#2f9dff', '#9b5bff'].forEach((color, i) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = S * 0.056;
      ctx.beginPath();
      ctx.arc(S * 0.5, S * 0.7, S * (0.4 - i * 0.052), Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    });
    for (const x of [0.21, 0.79]) {
      sticker(ctx, '#ffffff', () => {
        circle(ctx, x - 0.09, 0.74, 0.07);
        circle(ctx, x, 0.7, 0.1);
        circle(ctx, x + 0.09, 0.74, 0.07);
      }, 0.04);
    }
  },
  flower(ctx) {
    const S = ctx.canvas.width;
    brush(ctx, '#111', 0.07, () => { ctx.moveTo(S * 0.5, S * 0.55); ctx.quadraticCurveTo(S * 0.44, S * 0.76, S * 0.5, S * 0.94); });
    brush(ctx, '#3fbf4f', 0.04, () => { ctx.moveTo(S * 0.5, S * 0.55); ctx.quadraticCurveTo(S * 0.44, S * 0.76, S * 0.5, S * 0.94); });
    sticker(ctx, '#3fbf4f', () => oval(ctx, 0.62, 0.78, 0.11, 0.05, -0.5), 0.035);
    sticker(ctx, '#ff6fb5', () => {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        circle(ctx, 0.5 + Math.cos(a) * 0.19, 0.38 + Math.sin(a) * 0.19, 0.115);
      }
    });
    sticker(ctx, '#ffd93a', () => circle(ctx, 0.5, 0.38, 0.11), 0.04);
  },
  mushroom(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#f4e7cf', () => box(ctx, 0.39, 0.46, 0.22, 0.38, 0.07));
    const cap = () => {
      ctx.moveTo(S * 0.16, S * 0.52);
      ctx.ellipse(S * 0.5, S * 0.52, S * 0.34, S * 0.36, 0, Math.PI, 0);
      ctx.closePath();
    };
    sticker(ctx, '#e8303f', cap);
    fillShape(ctx, '#ffffff', () => { circle(ctx, 0.36, 0.36, 0.06); circle(ctx, 0.58, 0.28, 0.07); circle(ctx, 0.67, 0.44, 0.045); circle(ctx, 0.47, 0.47, 0.035); });
    fillShape(ctx, '#111', () => { oval(ctx, 0.45, 0.65, 0.02, 0.035); oval(ctx, 0.55, 0.65, 0.02, 0.035); });
  },
  snowflake(ctx) {
    const S = ctx.canvas.width;
    const arms = () => {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(S * 0.5, S * 0.5);
        ctx.lineTo(S * (0.5 + Math.cos(a) * 0.4), S * (0.5 + Math.sin(a) * 0.4));
        for (const r of [0.2, 0.3]) {
          const x = 0.5 + Math.cos(a) * r;
          const y = 0.5 + Math.sin(a) * r;
          for (const side of [-0.8, 0.8]) {
            ctx.moveTo(S * x, S * y);
            ctx.lineTo(S * (x + Math.cos(a + side) * 0.09), S * (y + Math.sin(a + side) * 0.09));
          }
        }
      }
    };
    brush(ctx, '#123a66', 0.06, arms);
    brush(ctx, '#bfeaff', 0.03, arms);
    speckles(ctx, '#bfeaff', 41, 40);
  },
  watermelon(ctx) {
    const S = ctx.canvas.width;
    const half = (r) => () => {
      ctx.moveTo(S * (0.5 + r), S * 0.32);
      ctx.arc(S * 0.5, S * 0.32, S * r, 0, Math.PI);
      ctx.closePath();
    };
    tilted(ctx, -0.25, () => {
      sticker(ctx, '#2f9e44', half(0.4));
      fillShape(ctx, '#e9f7d8', half(0.35));
      fillShape(ctx, '#f0364f', half(0.31));
      fillShape(ctx, '#17130f', () => {
        for (const [x, y] of [[0.34, 0.42], [0.46, 0.5], [0.58, 0.48], [0.68, 0.4], [0.5, 0.39]]) oval(ctx, x, y, 0.016, 0.03);
      });
    });
  },
  donut(ctx) {
    const S = ctx.canvas.width;
    const ring = (outer, inner) => () => { circle(ctx, 0.5, 0.5, outer); circle(ctx, 0.5, 0.5, inner); };
    outline(ctx, 0.05, ring(0.36, 0.12));
    paint(ctx, '#d99a55', () => { ring(0.36, 0.12)(); ctx.fill('evenodd'); }, 0.005);
    paint(ctx, '#ff7ab8', () => { ring(0.32, 0.15)(); ctx.fill('evenodd'); }, 0.012);
    const r = rand(53);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = 0.19 + r() * 0.1;
      const x = 0.5 + Math.cos(a) * d;
      const y = 0.5 + Math.sin(a) * d;
      const t = r() * Math.PI;
      brush(ctx, ['#ffe04a', '#36d7ff', '#ffffff', '#5dff7a'][i % 4], 0.018, () => {
        ctx.moveTo(S * (x - Math.cos(t) * 0.02), S * (y - Math.sin(t) * 0.02));
        ctx.lineTo(S * (x + Math.cos(t) * 0.02), S * (y + Math.sin(t) * 0.02));
      });
    }
  },
  icecream(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#d9a05b', () => poly(ctx, [[0.32, 0.5], [0.68, 0.5], [0.5, 0.94]]));
    brush(ctx, '#a8733a', 0.012, () => {
      for (const t of [0.15, 0.4, 0.65]) {
        ctx.moveTo(S * (0.32 + t * 0.36), S * 0.5);
        ctx.lineTo(S * (0.5 + t * 0.14), S * (0.94 - t * 0.3));
        ctx.moveTo(S * (0.68 - t * 0.36), S * 0.5);
        ctx.lineTo(S * (0.5 - t * 0.14), S * (0.94 - t * 0.3));
      }
    });
    sticker(ctx, '#ff9ccb', () => circle(ctx, 0.5, 0.42, 0.2));
    sticker(ctx, '#8ff0cf', () => circle(ctx, 0.5, 0.22, 0.14));
    sticker(ctx, '#e8303f', () => circle(ctx, 0.56, 0.09, 0.05), 0.03);
    drips(ctx, '#ff9ccb', 61, [[0.36, 0.54], [0.62, 0.55]]);
  },
  burger(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#e8a94f', () => box(ctx, 0.17, 0.66, 0.66, 0.16, 0.07));
    sticker(ctx, '#6d3f22', () => box(ctx, 0.15, 0.54, 0.7, 0.13, 0.06));
    fillShape(ctx, '#ffd23a', () => poly(ctx, [[0.2, 0.53], [0.8, 0.53], [0.56, 0.63]]));
    const leaf = () => {
      ctx.moveTo(S * 0.15, S * 0.5);
      for (let i = 0; i < 7; i++) ctx.quadraticCurveTo(S * (0.2 + i * 0.1), S * (i % 2 ? 0.44 : 0.57), S * (0.25 + i * 0.1), S * 0.5);
    };
    brush(ctx, '#111', 0.075, leaf);
    brush(ctx, '#62d24a', 0.045, leaf);
    const bun = () => {
      ctx.moveTo(S * 0.16, S * 0.46);
      ctx.ellipse(S * 0.5, S * 0.46, S * 0.34, S * 0.27, 0, Math.PI, 0);
      ctx.closePath();
    };
    sticker(ctx, '#f0b45c', bun);
    fillShape(ctx, '#fff2d2', () => {
      for (const [x, y] of [[0.36, 0.34], [0.5, 0.27], [0.64, 0.34], [0.44, 0.4], [0.58, 0.41]]) oval(ctx, x, y, 0.024, 0.014, 0.4);
    });
  },
  frog(ctx) {
    const S = ctx.canvas.width;
    const body = () => {
      circle(ctx, 0.3, 0.34, 0.13);
      circle(ctx, 0.7, 0.34, 0.13);
      oval(ctx, 0.5, 0.58, 0.35, 0.26);
    };
    sticker(ctx, '#58d65c', body);
    fillShape(ctx, '#ffffff', () => { circle(ctx, 0.3, 0.33, 0.09); circle(ctx, 0.7, 0.33, 0.09); });
    fillShape(ctx, '#111', () => { circle(ctx, 0.32, 0.34, 0.045); circle(ctx, 0.68, 0.34, 0.045); });
    fillShape(ctx, '#ff9ccb', () => { oval(ctx, 0.27, 0.62, 0.055, 0.035); oval(ctx, 0.73, 0.62, 0.055, 0.035); }, 0.015);
    outline(ctx, 0.022, () => ctx.arc(S * 0.5, S * 0.52, S * 0.2, 0.35, Math.PI - 0.35));
  },
  duck(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#ff9b1f', () => poly(ctx, [[0.3, 0.3], [0.1, 0.36], [0.3, 0.43]]), 0.04);
    sticker(ctx, '#ffd93a', () => {
      oval(ctx, 0.52, 0.66, 0.31, 0.2);
      poly(ctx, [[0.72, 0.6], [0.92, 0.42], [0.82, 0.74]]);
      circle(ctx, 0.42, 0.36, 0.17);
    });
    fillShape(ctx, '#111', () => circle(ctx, 0.37, 0.32, 0.03));
    brush(ctx, '#d9a400', 0.025, () => ctx.arc(S * 0.55, S * 0.6, S * 0.12, 0.2, Math.PI - 0.2));
  },
  paw(ctx) {
    sticker(ctx, '#ff8ac2', () => {
      oval(ctx, 0.5, 0.64, 0.21, 0.17);
      oval(ctx, 0.23, 0.46, 0.08, 0.1, -0.35);
      oval(ctx, 0.39, 0.28, 0.085, 0.115, -0.12);
      oval(ctx, 0.61, 0.28, 0.085, 0.115, 0.12);
      oval(ctx, 0.77, 0.46, 0.08, 0.1, 0.35);
    });
    speckles(ctx, '#ff8ac2', 67, 45);
  },
  robot(ctx) {
    const S = ctx.canvas.width;
    brush(ctx, '#111', 0.05, () => { ctx.moveTo(S * 0.5, S * 0.32); ctx.lineTo(S * 0.5, S * 0.14); });
    sticker(ctx, '#ff3b3b', () => circle(ctx, 0.5, 0.12, 0.05), 0.03);
    sticker(ctx, '#8d99a6', () => { box(ctx, 0.14, 0.44, 0.08, 0.18, 0.02); box(ctx, 0.78, 0.44, 0.08, 0.18, 0.02); }, 0.04);
    sticker(ctx, '#c7d2dc', () => box(ctx, 0.21, 0.28, 0.58, 0.5, 0.07));
    fillShape(ctx, '#111', () => { circle(ctx, 0.37, 0.46, 0.09); circle(ctx, 0.63, 0.46, 0.09); });
    fillShape(ctx, '#36e0ff', () => { circle(ctx, 0.37, 0.46, 0.055); circle(ctx, 0.63, 0.46, 0.055); }, 0.03);
    fillShape(ctx, '#111', () => box(ctx, 0.33, 0.62, 0.34, 0.09, 0.015));
    fillShape(ctx, '#ffffff', () => { for (let i = 0; i < 5; i++) box(ctx, 0.35 + i * 0.062, 0.635, 0.04, 0.06); });
  },
  alien(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#7dff6a', () => {
      ctx.moveTo(S * 0.5, S * 0.88);
      ctx.bezierCurveTo(S * 0.2, S * 0.72, S * 0.08, S * 0.14, S * 0.5, S * 0.12);
      ctx.bezierCurveTo(S * 0.92, S * 0.14, S * 0.8, S * 0.72, S * 0.5, S * 0.88);
      ctx.closePath();
    });
    fillShape(ctx, '#0d1320', () => { oval(ctx, 0.35, 0.47, 0.12, 0.07, 0.6); oval(ctx, 0.65, 0.47, 0.12, 0.07, -0.6); });
    fillShape(ctx, '#ffffff', () => { circle(ctx, 0.32, 0.43, 0.018); circle(ctx, 0.62, 0.43, 0.018); });
    outline(ctx, 0.018, () => { ctx.moveTo(S * 0.45, S * 0.72); ctx.lineTo(S * 0.55, S * 0.72); });
  },
  ufo(ctx) {
    const S = ctx.canvas.width;
    fillShape(ctx, 'rgba(140,255,160,.5)', () => poly(ctx, [[0.38, 0.5], [0.62, 0.5], [0.8, 0.94], [0.2, 0.94]]), 0.03);
    sticker(ctx, '#8fe6ff', () => {
      ctx.moveTo(S * 0.3, S * 0.4);
      ctx.arc(S * 0.5, S * 0.4, S * 0.2, Math.PI, 0);
      ctx.closePath();
    });
    sticker(ctx, '#a9b4c0', () => oval(ctx, 0.5, 0.46, 0.4, 0.12));
    ['#ff3b3b', '#ffd93a', '#5dff7a', '#ffd93a', '#ff3b3b'].forEach((color, i) => {
      fillShape(ctx, color, () => circle(ctx, 0.22 + i * 0.14, i % 4 ? 0.5 : 0.47, 0.03), 0.03);
    });
  },
  bomb(ctx) {
    const S = ctx.canvas.width;
    const fuse = () => { ctx.moveTo(S * 0.6, S * 0.38); ctx.quadraticCurveTo(S * 0.66, S * 0.18, S * 0.8, S * 0.22); };
    brush(ctx, '#111', 0.06, fuse);
    brush(ctx, '#c9a26b', 0.03, fuse);
    sticker(ctx, '#3a4150', () => circle(ctx, 0.44, 0.6, 0.29));
    fillShape(ctx, 'rgba(255,255,255,.65)', () => oval(ctx, 0.34, 0.48, 0.07, 0.04, -0.7), 0.015);
    paint(ctx, '#ff9d1c', () => { poly(ctx, star([], 0.82, 0.21, 0.14, 0.055, 8)); ctx.fill(); }, 0.04);
    paint(ctx, '#ffe45c', () => { poly(ctx, star([], 0.82, 0.21, 0.08, 0.03, 8)); ctx.fill(); }, 0.02);
  },
  shuriken(ctx) {
    tilted(ctx, 0.3, () => {
      outline(ctx, 0.05, () => poly(ctx, star([], 0.5, 0.5, 0.44, 0.13, 4)));
      fillShape(ctx, '#b8c4d0', () => poly(ctx, star([], 0.5, 0.5, 0.44, 0.13, 4)));
      fillShape(ctx, '#6f7c8a', () => {
        for (let i = 0; i < 4; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 2;
          const b = a + Math.PI / 4;
          poly(ctx, [[0.5 + Math.cos(a) * 0.44, 0.5 + Math.sin(a) * 0.44], [0.5, 0.5], [0.5 + Math.cos(b) * 0.13, 0.5 + Math.sin(b) * 0.13]]);
        }
      });
      sticker(ctx, '#1d222b', () => circle(ctx, 0.5, 0.5, 0.05), 0.02);
    });
    speckles(ctx, '#b8c4d0', 71, 40);
  },
  shield(ctx) {
    const S = ctx.canvas.width;
    const shape = () => {
      ctx.moveTo(S * 0.5, S * 0.1);
      ctx.lineTo(S * 0.82, S * 0.22);
      ctx.quadraticCurveTo(S * 0.84, S * 0.68, S * 0.5, S * 0.92);
      ctx.quadraticCurveTo(S * 0.16, S * 0.68, S * 0.18, S * 0.22);
      ctx.closePath();
    };
    sticker(ctx, '#2f7dff', shape);
    fillShape(ctx, '#1f56b8', () => {
      ctx.moveTo(S * 0.5, S * 0.12);
      ctx.lineTo(S * 0.8, S * 0.23);
      ctx.quadraticCurveTo(S * 0.82, S * 0.67, S * 0.5, S * 0.9);
      ctx.closePath();
    });
    sticker(ctx, '#ffffff', () => poly(ctx, star([], 0.5, 0.48, 0.2, 0.085)), 0.03);
  },
  diamond(ctx) {
    const shape = [[0.28, 0.2], [0.72, 0.2], [0.9, 0.42], [0.5, 0.9], [0.1, 0.42]];
    sticker(ctx, '#48d8ff', () => poly(ctx, shape));
    fillShape(ctx, '#a8f0ff', () => poly(ctx, [[0.28, 0.2], [0.72, 0.2], [0.62, 0.42], [0.38, 0.42]]));
    fillShape(ctx, '#1fa6dc', () => poly(ctx, [[0.62, 0.42], [0.9, 0.42], [0.5, 0.9]]));
    fillShape(ctx, '#7ce6ff', () => poly(ctx, [[0.38, 0.42], [0.62, 0.42], [0.5, 0.9]]));
    speckles(ctx, '#ffffff', 73, 50);
  },
  music(ctx) {
    sticker(ctx, '#ff4fd8', () => {
      oval(ctx, 0.3, 0.74, 0.11, 0.08, -0.35);
      oval(ctx, 0.7, 0.66, 0.11, 0.08, -0.35);
      box(ctx, 0.365, 0.26, 0.05, 0.48);
      box(ctx, 0.765, 0.18, 0.05, 0.48);
      poly(ctx, [[0.365, 0.26], [0.815, 0.18], [0.815, 0.3], [0.365, 0.38]]);
    });
    speckles(ctx, '#ff4fd8', 79, 45);
  },
  dice(ctx) {
    tilted(ctx, 0.28, () => {
      sticker(ctx, '#ffffff', () => box(ctx, 0.2, 0.2, 0.6, 0.6, 0.09));
      fillShape(ctx, '#e8303f', () => {
        for (const [x, y] of [[0.34, 0.34], [0.66, 0.34], [0.5, 0.5], [0.34, 0.66], [0.66, 0.66]]) circle(ctx, x, y, 0.06);
      });
    });
  },
  gamepad(ctx) {
    sticker(ctx, '#4a5262', () => {
      box(ctx, 0.14, 0.34, 0.72, 0.32, 0.14);
      oval(ctx, 0.22, 0.62, 0.11, 0.17, 0.4);
      oval(ctx, 0.78, 0.62, 0.11, 0.17, -0.4);
    });
    fillShape(ctx, '#e9eef5', () => { box(ctx, 0.25, 0.47, 0.16, 0.05); box(ctx, 0.305, 0.415, 0.05, 0.16); });
    fillShape(ctx, '#ff3b3b', () => circle(ctx, 0.7, 0.45, 0.035));
    fillShape(ctx, '#5dff7a', () => circle(ctx, 0.62, 0.53, 0.035));
    fillShape(ctx, '#36d7ff', () => circle(ctx, 0.78, 0.53, 0.035));
    fillShape(ctx, '#ffd93a', () => circle(ctx, 0.7, 0.6, 0.035));
  },
  rip(ctx) {
    const S = ctx.canvas.width;
    sticker(ctx, '#aab2bb', () => {
      ctx.moveTo(S * 0.24, S * 0.84);
      ctx.lineTo(S * 0.24, S * 0.42);
      ctx.arc(S * 0.5, S * 0.42, S * 0.26, Math.PI, 0);
      ctx.lineTo(S * 0.76, S * 0.84);
      ctx.closePath();
    });
    text(ctx, 'RIP', 0.24, '#ffffff', 0.5);
    brush(ctx, '#3fbf4f', 0.07, () => { ctx.moveTo(S * 0.12, S * 0.86); ctx.lineTo(S * 0.88, S * 0.86); });
  },
  ez(ctx) {
    text(ctx, 'EZ', 0.52, '#ffee3a');
    drips(ctx, '#ffee3a', 83, [[0.28, 0.68], [0.5, 0.66], [0.72, 0.64]]);
  },
  wow(ctx) {
    text(ctx, 'WOW', 0.42, '#ff7a1c');
    speckles(ctx, '#ff7a1c', 89, 70);
  },
  lol(ctx) {
    text(ctx, 'LOL', 0.46, '#36d7ff');
    drips(ctx, '#36d7ff', 97, [[0.26, 0.66], [0.53, 0.63], [0.76, 0.6]]);
  },
  e404(ctx) {
    text(ctx, '404', 0.42, '#ff3b3b', 0.42);
    text(ctx, 'ERROR', 0.16, '#ffffff', 0.68);
  },
  five(ctx) {
    const shape = star([], 0.5, 0.5, 0.44, 0.34, 14);
    sticker(ctx, '#ffd23a', () => poly(ctx, shape));
    text(ctx, '5+', 0.42, '#e8303f');
  },
  name(ctx, nick) {
    text(ctx, (nick || 'Игрок').toUpperCase(), 0.26, '#ff4fd8', 0.48);
    drips(ctx, '#ff4fd8', 37, [[0.28, 0.58], [0.5, 0.6], [0.72, 0.56]]);
  },
};

/** Рисует спрей на холсте (холст квадратный, фон прозрачный). */
export function drawSpray(canvas, id, nick = '') {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  (DESIGNS[id] || DESIGNS.smile)(ctx, nick);
}
