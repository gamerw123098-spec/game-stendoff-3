// Рисунки скинов: всё генерируется кодом по описанию из каталога на сервере.
function seeded(text) {
  let state = 1;
  for (const char of text) state = (state * 31 + char.charCodeAt(0)) % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

const PATTERNS = {
  camo(ctx, w, h, [base, dark, light], random) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (const color of [dark, light]) {
      ctx.fillStyle = color;
      for (let i = 0; i < 14; i++) {
        const x = random() * w;
        const y = random() * h;
        const size = 14 + random() * 26;
        ctx.beginPath();
        ctx.ellipse(x, y, size, size * (0.45 + random() * 0.5), random() * 3.14, 0, 7);
        ctx.fill();
      }
    }
  },
  digital(ctx, w, h, [base, dark, light], random) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const cell = 12;
    for (let x = 0; x < w; x += cell) {
      for (let y = 0; y < h; y += cell) {
        const roll = random();
        if (roll < 0.28) ctx.fillStyle = dark;
        else if (roll < 0.46) ctx.fillStyle = light;
        else continue;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  },
  stripes(ctx, w, h, [base, dark]) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = dark;
    for (let i = -h; i < w; i += 36) {
      ctx.beginPath();
      ctx.moveTo(i, h);
      ctx.lineTo(i + 16, h);
      ctx.lineTo(i + h + 16, 0);
      ctx.lineTo(i + h, 0);
      ctx.fill();
    }
  },
  gradient(ctx, w, h, [from, to]) {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, from);
    gradient.addColorStop(0.5, to);
    gradient.addColorStop(1, from);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  },
  carbon(ctx, w, h, [base, accent]) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const cell = 8;
    for (let x = 0; x < w; x += cell) {
      for (let y = 0; y < h; y += cell) {
        ctx.fillStyle = (x + y) % (cell * 2) === 0 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.28)';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.lineTo(w, h * 0.28);
    ctx.stroke();
  },
  hex(ctx, w, h, [base, line]) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.5;
    const size = 16;
    const stepX = size * 1.5;
    const stepY = size * Math.sqrt(3);
    for (let col = -1; col * stepX < w + size; col++) {
      for (let row = -1; row * stepY < h + size; row++) {
        const cx = col * stepX;
        const cy = row * stepY + (col % 2 ? stepY / 2 : 0);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(angle) * size, cy + Math.sin(angle) * size);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  },
  lava(ctx, w, h, [base, hot, core], random) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      let x = random() * w;
      let y = random() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 7; j++) {
        x += (random() - 0.5) * 70;
        y += (random() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hot;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = core;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  },
  circuit(ctx, w, h, [base, line], random) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line;
    ctx.fillStyle = line;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 20; i++) {
      let x = Math.round((random() * w) / 16) * 16;
      let y = Math.round((random() * h) / 16) * 16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        if (random() > 0.5) x += (random() > 0.5 ? 1 : -1) * 32;
        else y += (random() > 0.5 ? 1 : -1) * 32;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  },
  brushed(ctx, w, h, [base, dark], random) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = random() > 0.5 ? dark : 'rgba(255,255,255,.35)';
      ctx.globalAlpha = 0.08 + random() * 0.22;
      ctx.fillRect(0, random() * h, w, 1 + random() * 1.6);
    }
    ctx.globalAlpha = 1;
  },
};

export function drawSkin(ctx, w, h, skin) {
  const draw = PATTERNS[skin.pattern] || PATTERNS.gradient;
  draw(ctx, w, h, skin.colors, seeded(skin.id));
}
