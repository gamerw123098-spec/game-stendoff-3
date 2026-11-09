// Графика: карта, модели игроков, оружие и эффекты. Текстуры рисуются кодом.
import * as THREE from 'three';
import { drawSkin } from './skinart.js';
import { drawSpray } from './sprays.js';

const SUN = new THREE.Vector3(-0.55, 1, 0.38).normalize();
// Команда 0 — террористы (оранжевые), команда 1 — антитеррористы (синие).
export const TEAM_COLORS = [0xe8742a, 0x2f7fe0];

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function makeCanvas(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, w, h, count, alpha, seed) {
  const random = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const shade = random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${random() * alpha})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 2.5, 1 + random() * 2.5);
  }
}

// ---------- Качество материалов ----------
// На среднем и высоком качестве материалы физически правильные: металл блестит и отражает небо,
// а рельеф поверхностей задан картами нормалей. На низком всё проще и быстрее.
function readQuality() {
  try {
    return localStorage.getItem('poligon.quality') || 'medium';
  } catch {
    return 'medium';
  }
}
export const PBR = readQuality() !== 'low';
const TEXTURE_SIZE = PBR ? 512 : 256;

/** Материал с нужным качеством. roughness и metalness действуют только на хорошем качестве. */
function mat(params = {}) {
  if (PBR) return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
  const { roughness, metalness, normalMap, normalScale, ...simple } = params;
  return new THREE.MeshLambertMaterial(simple);
}

/** Карта нормалей из карты высот: светлое выпуклое, тёмное вдавленное. */
function normalFromHeight(heightCanvas, strength) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const source = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  const height = (x, y) => source[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const du = (height(x + 1, y) - height(x - 1, y)) * strength;
      const dv = (height(x, y - 1) - height(x, y + 1)) * strength; // на холсте y растёт вниз
      const length = Math.hypot(du, dv, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-du / length) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((-dv / length) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Рисует цвет и высоту одной функцией, чтобы рельеф точно совпадал с рисунком. */
function surface(design, strength = 3) {
  const size = TEXTURE_SIZE;
  const color = document.createElement('canvas');
  const height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const c = color.getContext('2d');
  const hctx = height.getContext('2d');
  hctx.fillStyle = 'rgb(128,128,128)';
  hctx.fillRect(0, 0, size, size);
  design(c, hctx, size);
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return { map, normalMap: PBR ? normalFromHeight(height, strength) : null };
}

function blotches(ctx, size, count, seed, colors, radius = 0.12) {
  const random = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.beginPath();
    ctx.ellipse(random() * size, random() * size, size * radius * (0.3 + random()), size * radius * (0.2 + random() * 0.6), random() * 3, 0, 7);
    ctx.fill();
  }
}

function drips(ctx, size, count, seed, color) {
  const random = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const x = random() * size;
    const length = size * (0.15 + random() * 0.45);
    const gradient = ctx.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, 2 + random() * 6, length);
  }
}

const TEXTURES = {
  // Бетонные плиты со швами, болтами и потёками
  wall: () => surface((c, h, s) => {
    c.fillStyle = '#b9ad98';
    c.fillRect(0, 0, s, s);
    blotches(c, s, 40, 11, ['rgba(255,255,255,.05)', 'rgba(60,50,40,.06)']);
    speckle(c, s, s, 9000, 0.12, 12);
    drips(c, s, 14, 13, 'rgba(70,55,40,.18)');
    speckle(h, s, s, 7000, 0.35, 14);
    const seam = s / 64;
    for (const ctx of [c, h]) {
      ctx.fillStyle = ctx === c ? 'rgba(40,35,30,.55)' : 'rgb(20,20,20)';
      ctx.fillRect(0, 0, s, seam * 1.5);
      ctx.fillRect(0, 0, seam * 1.5, s);
      ctx.fillRect(0, s / 2 - seam / 2, s, seam * 0.6);
    }
    for (const [x, y] of [[0.22, 0.22], [0.78, 0.22], [0.22, 0.72], [0.78, 0.72]]) {
      c.fillStyle = 'rgba(30,28,25,.7)';
      c.beginPath();
      c.arc(x * s, y * s, s / 90, 0, 7);
      c.fill();
      h.fillStyle = 'rgb(30,30,30)';
      h.beginPath();
      h.arc(x * s, y * s, s / 80, 0, 7);
      h.fill();
    }
  }, 4),

  // Бетонный блок с жёлто-чёрной полосой
  concrete: () => surface((c, h, s) => {
    c.fillStyle = '#d2cdc1';
    c.fillRect(0, 0, s, s);
    blotches(c, s, 30, 21, ['rgba(255,255,255,.06)', 'rgba(80,70,60,.07)']);
    speckle(c, s, s, 9000, 0.12, 22);
    speckle(h, s, s, 8000, 0.4, 23);
    const band = s * 0.2;
    c.save();
    c.beginPath();
    c.rect(0, 0, s, band);
    c.clip();
    c.fillStyle = '#e3b324';
    c.fillRect(0, 0, s, band);
    c.fillStyle = '#1d1d1d';
    for (let i = -s; i < s * 2; i += s / 4) {
      c.beginPath();
      c.moveTo(i, band);
      c.lineTo(i + s / 8, band);
      c.lineTo(i + s / 8 + band, 0);
      c.lineTo(i + band, 0);
      c.fill();
    }
    blotches(c, s, 12, 24, ['rgba(210,205,193,.8)'], 0.03); // сколы краски
    c.restore();
    h.fillStyle = 'rgb(90,90,90)';
    h.fillRect(0, band - s / 120, s, s / 60);
  }, 3),

  // Рифлёный металл контейнера: цвет задаёт материал, поэтому сама текстура светлая
  container: () => surface((c, h, s) => {
    c.fillStyle = '#d9d6d0';
    c.fillRect(0, 0, s, s);
    const period = s / 8;
    for (let x = 0; x < s; x++) {
      const t = (x % period) / period;
      const wave = t < 0.4 ? 1 : t < 0.5 ? 1 - (t - 0.4) * 10 : t < 0.9 ? 0 : (t - 0.9) * 10;
      const shade = Math.round(70 + wave * 120);
      h.fillStyle = `rgb(${shade},${shade},${shade})`;
      h.fillRect(x, 0, 1, s);
      c.fillStyle = `rgba(0,0,0,${0.08 * (1 - wave)})`;
      c.fillRect(x, 0, 1, s);
    }
    drips(c, s, 18, 31, 'rgba(110,55,25,.35)'); // ржавые потёки
    blotches(c, s, 25, 32, ['rgba(120,60,30,.18)', 'rgba(255,255,255,.08)'], 0.05);
    speckle(c, s, s, 3000, 0.15, 33);
    for (const ctx of [c, h]) {
      ctx.fillStyle = ctx === c ? 'rgba(40,40,40,.35)' : 'rgb(220,220,220)';
      ctx.fillRect(0, 0, s, s / 24);
      ctx.fillRect(0, s - s / 24, s, s / 24);
    }
  }, 5),

  // Деревянный ящик: доски, рамка, раскос и гвозди
  crate: () => surface((c, h, s) => {
    c.fillStyle = '#b8874f';
    c.fillRect(0, 0, s, s);
    const random = seededRandom(41);
    for (let i = 0; i < 260; i++) {
      c.strokeStyle = `rgba(${random() > 0.5 ? '90,55,25' : '230,190,130'},${0.08 + random() * 0.12})`;
      c.lineWidth = 1 + random() * 2;
      const y = random() * s;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(s * 0.3, y + (random() - 0.5) * 8, s * 0.6, y + (random() - 0.5) * 8, s, y);
      c.stroke();
    }
    const plank = s / 5;
    for (let y = plank; y < s; y += plank) {
      c.fillStyle = 'rgba(50,30,12,.6)';
      c.fillRect(0, y - 2, s, 4);
      h.fillStyle = 'rgb(40,40,40)';
      h.fillRect(0, y - 3, s, 6);
    }
    const frame = s * 0.1;
    for (const ctx of [c, h]) {
      ctx.fillStyle = ctx === c ? 'rgba(120,80,40,.55)' : 'rgb(210,210,210)';
      ctx.fillRect(0, 0, s, frame);
      ctx.fillRect(0, s - frame, s, frame);
      ctx.fillRect(0, 0, frame, s);
      ctx.fillRect(s - frame, 0, frame, s);
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-s * 0.7, -frame / 2, s * 1.4, frame);
      ctx.restore();
    }
    c.fillStyle = 'rgba(40,40,40,.8)';
    for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
      c.beginPath();
      c.arc(x * s, y * s, s / 70, 0, 7);
      c.fill();
    }
  }, 3),

  // Забор из оцинкованного профлиста
  perimeter: () => surface((c, h, s) => {
    c.fillStyle = '#a7b0b3';
    c.fillRect(0, 0, s, s);
    blotches(c, s, 50, 51, ['rgba(255,255,255,.07)', 'rgba(60,70,75,.08)', 'rgba(120,80,50,.08)'], 0.08);
    const period = s / 16;
    for (let x = 0; x < s; x++) {
      const wave = Math.sin((x / period) * Math.PI * 2);
      const shade = Math.round(128 + wave * 90);
      h.fillStyle = `rgb(${shade},${shade},${shade})`;
      h.fillRect(x, 0, 1, s);
      c.fillStyle = `rgba(0,0,0,${0.06 * (1 - wave)})`;
      c.fillRect(x, 0, 1, s);
    }
    drips(c, s, 10, 52, 'rgba(110,60,30,.25)');
    speckle(c, s, s, 2500, 0.12, 53);
  }, 4),
};
// Новые материалы для новых карт
Object.assign(TEXTURES, {
  // Красный кирпич с белыми швами
  brick: () => surface((c, h, s) => {
    c.fillStyle = '#d9d2c4';
    c.fillRect(0, 0, s, s);
    const rows = 8;
    const rowH = s / rows;
    const brickW = s / 4;
    const random = seededRandom(71);
    for (let row = 0; row < rows; row++) {
      const shift = row % 2 ? brickW / 2 : 0;
      for (let x = -brickW; x < s + brickW; x += brickW) {
        const tone = 0.8 + random() * 0.4;
        c.fillStyle = `rgb(${Math.round(160 * tone)},${Math.round(70 * tone)},${Math.round(48 * tone)})`;
        c.fillRect(x + shift + 3, row * rowH + 3, brickW - 6, rowH - 6);
        h.fillStyle = 'rgb(190,190,190)';
        h.fillRect(x + shift + 3, row * rowH + 3, brickW - 6, rowH - 6);
      }
    }
    speckle(c, s, s, 6000, 0.12, 72);
    speckle(h, s, s, 5000, 0.3, 73);
  }, 4),

  // Глиняная штукатурка с трещинами
  plaster: () => surface((c, h, s) => {
    c.fillStyle = '#d8b98a';
    c.fillRect(0, 0, s, s);
    blotches(c, s, 50, 81, ['rgba(255,240,210,.1)', 'rgba(120,85,50,.1)'], 0.1);
    speckle(c, s, s, 8000, 0.1, 82);
    blotches(h, s, 40, 83, ['rgba(255,255,255,.12)', 'rgba(0,0,0,.12)'], 0.08);
    const random = seededRandom(84);
    c.strokeStyle = 'rgba(90,60,35,.45)';
    h.strokeStyle = 'rgb(40,40,40)';
    for (let i = 0; i < 9; i++) {
      let x = random() * s;
      let y = random() * s;
      for (const ctx of [c, h]) {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
      for (let j = 0; j < 5; j++) {
        x += (random() - 0.5) * 60;
        y += random() * 40;
        c.lineTo(x, y);
        h.lineTo(x, y);
      }
      c.stroke();
      h.stroke();
    }
    drips(c, s, 8, 85, 'rgba(110,80,50,.15)');
  }, 3),

  // Стальные листы с заклёпками
  metal: () => surface((c, h, s) => {
    c.fillStyle = '#7d8790';
    c.fillRect(0, 0, s, s);
    blotches(c, s, 40, 91, ['rgba(255,255,255,.06)', 'rgba(30,35,40,.08)'], 0.1);
    speckle(c, s, s, 3000, 0.1, 92);
    for (const ctx of [c, h]) {
      ctx.fillStyle = ctx === c ? 'rgba(30,30,30,.45)' : 'rgb(50,50,50)';
      ctx.fillRect(0, 0, s, 4);
      ctx.fillRect(0, 0, 4, s);
      ctx.fillRect(0, s / 2 - 2, s, 4);
    }
    for (let x = 16; x < s; x += 32) {
      for (const y of [12, s / 2 + 12, s / 2 - 12, s - 12]) {
        c.fillStyle = 'rgba(200,205,210,.7)';
        c.beginPath();
        c.arc(x, y, 3, 0, 7);
        c.fill();
        h.fillStyle = 'rgb(230,230,230)';
        h.beginPath();
        h.arc(x, y, 4, 0, 7);
        h.fill();
      }
    }
    drips(c, s, 6, 93, 'rgba(110,60,30,.2)');
  }, 4),

  // Мешки с песком
  sandbag: () => surface((c, h, s) => {
    c.fillStyle = '#8c7b55';
    c.fillRect(0, 0, s, s);
    const rows = 3;
    const rowH = s / rows;
    for (let row = 0; row < rows; row++) {
      const shift = row % 2 ? s / 4 : 0;
      for (let x = -s / 2; x < s + s / 2; x += s / 2) {
        const cx = x + shift + s / 4;
        const cy = row * rowH + rowH / 2;
        const gradient = h.createRadialGradient(cx, cy, 4, cx, cy, s / 4);
        gradient.addColorStop(0, 'rgb(230,230,230)');
        gradient.addColorStop(1, 'rgb(60,60,60)');
        h.fillStyle = gradient;
        h.beginPath();
        h.ellipse(cx, cy, s / 4 - 4, rowH / 2 - 4, 0, 0, 7);
        h.fill();
        c.fillStyle = 'rgba(60,50,30,.35)';
        c.beginPath();
        c.ellipse(cx, cy, s / 4 - 2, rowH / 2 - 2, 0, 0, 7);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(50,40,25,.55)';
        c.stroke();
      }
    }
    speckle(c, s, s, 6000, 0.15, 101);
  }, 4),
});
const TILE = { wall: 2.4, concrete: 1.6, container: 2.6, perimeter: 3.2, brick: 1.6, plaster: 2.4, metal: 2.0, sandbag: 1.0 };
// Цвета бочек
const BARREL_COLORS = [0x2f6aa0, 0xb33a2a, 0x3a7a3e, 0xd38d1f];

/** Бочка: в мире это коробка, но рисуется цилиндром с рёбрами. */
function barrelMesh(box, index) {
  const sx = box.maxx - box.minx;
  const sy = box.maxy - box.miny;
  const sz = box.maxz - box.minz;
  const radius = Math.min(sx, sz) / 2;
  const group = new THREE.Group();
  const paint = mat({ color: BARREL_COLORS[index % BARREL_COLORS.length], roughness: 0.45, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, sy, 18), paint);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const ringMaterial = mat({ color: 0x2a2d30, roughness: 0.5, metalness: 0.6 });
  for (const y of [-sy * 0.32, 0, sy * 0.32]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, 0.04, 18), ringMaterial);
    ring.position.y = y;
    group.add(ring);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.02, 18), ringMaterial);
  lid.position.y = sy / 2;
  group.add(lid);
  group.position.set((box.minx + box.maxx) / 2, (box.miny + box.maxy) / 2, (box.minz + box.maxz) / 2);
  return group;
}

// Контейнеры разных цветов: так карта выглядит живее и в ней проще ориентироваться.
const CONTAINER_COLORS = [0xc0462e, 0x2f72b5, 0x3f8f52, 0xd99a2b, 0x8a3f9a];

/** Мелкий рельеф асфальта, который повторяется по всей земле. */
function asphaltNormal() {
  const size = 256;
  const height = document.createElement('canvas');
  height.width = height.height = size;
  const ctx = height.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 9000, 0.6, 61);
  blotches(ctx, size, 40, 62, ['rgba(0,0,0,.15)', 'rgba(255,255,255,.15)'], 0.06);
  return normalFromHeight(height, 3);
}

function boxGeometry(box) {
  const sx = box.maxx - box.minx;
  const sy = box.maxy - box.miny;
  const sz = box.maxz - box.minz;
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const uv = geometry.attributes.uv;
  for (let face = 0; face < 6; face++) {
    let [u, v] = dims[face];
    if (box.kind === 'crate') {
      u = Math.max(1, Math.round(u / 0.9));
      v = Math.max(1, Math.round(v / 0.9));
    } else {
      u /= TILE[box.kind];
      v /= TILE[box.kind];
    }
    for (let i = 0; i < 4; i++) {
      const index = face * 4 + i;
      uv.setXY(index, uv.getX(index) * u, uv.getY(index) * v);
    }
  }
  // Низ стен темнее: дешёвая замена настоящим теням.
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const shade = position.getY(i) < 0 && box.miny === 0 ? 0.58 : 1;
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.translate((box.minx + box.maxx) / 2, (box.miny + box.maxy) / 2, (box.minz + box.maxz) / 2);
  return geometry;
}

/** Склеивает коробки одного материала в один объект: сотни стен рисуются за один вызов видеокарты. */
function mergeBoxes(geometries) {
  const vertices = geometries.reduce((sum, g) => sum + g.attributes.position.count, 0);
  const indices = geometries.reduce((sum, g) => sum + g.index.count, 0);
  const sizes = { position: 3, normal: 3, uv: 2, color: 3 };
  const arrays = Object.fromEntries(Object.entries(sizes).map(([name, size]) => [name, new Float32Array(vertices * size)]));
  const index = new Uint32Array(indices);
  let vertex = 0;
  let cursor = 0;
  for (const geometry of geometries) {
    for (const [name, size] of Object.entries(sizes)) arrays[name].set(geometry.attributes[name].array, vertex * size);
    const source = geometry.index.array;
    for (let i = 0; i < source.length; i++) index[cursor + i] = source[i] + vertex;
    vertex += geometry.attributes.position.count;
    cursor += source.length;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(sizes)) merged.setAttribute(name, new THREE.BufferAttribute(arrays[name], size));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

function groundTexture(world, mode, bakedShadows = true) {
  // Большие карты рисуются чуть крупнее: текстура не должна выйти за 4096 точек,
  // а на низком качестве (там тени нарисованы на земле) бережём видеопамять слабых компьютеров.
  const limit = document.body.classList.contains('touch') ? 2048 : bakedShadows ? 3000 : 4000;
  const pxPerMeter = Math.min(28, limit / (world.halfX * 2), limit / (world.halfZ * 2));
  const W = world.halfX * 2;
  const H = world.halfZ * 2;
  return makeCanvas(Math.round(W * pxPerMeter), Math.round(H * pxPerMeter), (ctx, w, h) => {
    const toPxX = (x) => (x + world.halfX) * pxPerMeter;
    const toPxZ = (z) => (z + world.halfZ) * pxPerMeter;

    ctx.fillStyle = world.theme.ground;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 60000, 0.09, 67);

    // Зоны баз
    const zoneLine = 0.3 * pxPerMeter;
    const zone = world.zoneX;
    ctx.fillStyle = 'rgba(47,127,224,.05)';
    ctx.fillRect(0, 0, toPxX(-zone), h);
    ctx.fillStyle = 'rgba(232,116,42,.05)';
    ctx.fillRect(toPxX(zone), 0, w - toPxX(zone), h);
    ctx.fillStyle = 'rgba(70,145,235,.6)';
    ctx.fillRect(toPxX(-zone) - zoneLine, 0, zoneLine, h);
    ctx.fillStyle = 'rgba(240,130,55,.6)';
    ctx.fillRect(toPxX(zone), 0, zoneLine, h);

    // Разметка
    ctx.strokeStyle = 'rgba(233,204,104,.48)';
    ctx.lineWidth = 0.14 * pxPerMeter;
    ctx.setLineDash([1.6 * pxPerMeter, 1.1 * pxPerMeter]);
    world.marks.lines.forEach(([x1, z1, x2, z2]) => {
      ctx.beginPath();
      ctx.moveTo(toPxX(x1), toPxZ(z1));
      ctx.lineTo(toPxX(x2), toPxZ(z2));
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    world.marks.rects.forEach(([x, z, sx, sz]) => {
      ctx.strokeRect(toPxX(x), toPxZ(z), sx * pxPerMeter, sz * pxPerMeter);
    });

    // Точки закладки бомбы видны только в режиме обезвреживания.
    if (mode === 'defuse') {
      for (const site of world.sites) {
        const cx = toPxX(site.x);
        const cz = toPxZ(site.z);
        ctx.fillStyle = 'rgba(214,62,48,.2)';
        ctx.strokeStyle = 'rgba(240,80,62,.85)';
        ctx.lineWidth = 0.16 * pxPerMeter;
        ctx.beginPath();
        ctx.arc(cx, cz, world.siteRadius * pxPerMeter, 0, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(245,110,92,.85)';
        ctx.font = `800 ${Math.round(3 * pxPerMeter)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(site.id, cx, cz);
      }
    }

    // Трещины
    const random = seededRandom(71);
    ctx.strokeStyle = 'rgba(15,15,15,.34)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 46; i++) {
      let x = random() * w;
      let y = random() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (random() - 0.5) * 90;
        y += (random() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Запечённые тени. Они рисуются в маленький слой, а при растягивании их края сами
    // становятся мягкими. Размытие холста на таком размере подвешивало страницу на десятки секунд.
    if (!bakedShadows) return;
    // Пол под крышей темнее: на низком качестве настоящих теней нет.
    ctx.fillStyle = 'rgba(6,8,12,.34)';
    for (const box of world.boxes) {
      if (box.miny >= 4) ctx.fillRect(toPxX(box.minx), toPxZ(box.minz), (box.maxx - box.minx) * pxPerMeter, (box.maxz - box.minz) * pxPerMeter);
    }
    const shrink = 6;
    const layer = document.createElement('canvas');
    layer.width = Math.ceil(w / shrink);
    layer.height = Math.ceil(h / shrink);
    const shadow = layer.getContext('2d');
    shadow.fillStyle = 'rgb(8,10,14)';
    for (const box of world.boxes) {
      if (box.miny > 0) continue;
      const height = box.maxy;
      const dx = (-SUN.x / SUN.y) * height;
      const dz = (-SUN.z / SUN.y) * height;
      const corners = [
        [box.minx, box.minz], [box.maxx, box.minz], [box.maxx, box.maxz], [box.minx, box.maxz],
      ];
      shadow.beginPath();
      // Выпуклая оболочка коробки и её проекции по направлению солнца
      const points = corners.flatMap(([x, z]) => [[x, z], [x + dx, z + dz]]);
      convexHull(points).forEach(([x, z], i) => {
        if (i) shadow.lineTo(toPxX(x) / shrink, toPxZ(z) / shrink);
        else shadow.moveTo(toPxX(x) / shrink, toPxZ(z) / shrink);
      });
      shadow.closePath();
      shadow.fill();
    }
    ctx.globalAlpha = 0.58;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, 0, 0, layer.width * shrink, layer.height * shrink);
    ctx.globalAlpha = 1;
  });
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const hull = [];
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

function buildSky(scene, theme) {
  const texture = makeCanvas(1024, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, theme.sky[0]);
    gradient.addColorStop(0.42, theme.sky[1]);
    gradient.addColorStop(0.5, theme.sky[2]);
    gradient.addColorStop(1, theme.sky[3]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    // Облака тоже рисуются в маленький слой и растягиваются: края получаются мягкими.
    const shrink = 8;
    const layer = document.createElement('canvas');
    layer.width = w / shrink;
    layer.height = h / shrink;
    const clouds = layer.getContext('2d');
    const random = seededRandom(83);
    for (let i = 0; i < 60; i++) {
      clouds.fillStyle = `rgba(255,250,240,${0.1 + random() * 0.22})`;
      clouds.beginPath();
      clouds.ellipse(
        (random() * w) / shrink,
        (40 + random() * 180) / shrink,
        (30 + random() * 80) / shrink,
        (5 + random() * 14) / shrink,
        0,
        0,
        7,
      );
      clouds.fill();
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, 0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(190, 24, 14),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  // Солнце на небе там же, откуда падает свет.
  const glow = makeCanvas(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,253,240,1)');
    gradient.addColorStop(0.12, 'rgba(255,244,214,.95)');
    gradient.addColorStop(0.35, 'rgba(255,220,160,.25)');
    gradient.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, fog: false, depthWrite: false, transparent: true }));
  sun.position.copy(SUN).multiplyScalar(170);
  sun.scale.setScalar(70);
  sky.add(sun);
  scene.add(sky);
  return sky;
}

function buildSkyline(scene, world) {
  // Силуэты складов за забором: чтобы карта не висела в пустоте.
  const random = seededRandom(97);
  const materials = [0x8b9599, 0x7f8c93, 0x98968c].map((color) => mat({ color, roughness: 0.95 }));
  const MARGIN = 7;

  // Здания стоят вдоль каждой стороны забора и всегда целиком снаружи карты.
  const place = (along, length, outward, sign, alongX) => {
    let position = -along;
    while (position < along) {
      const width = 9 + random() * 13;
      const depth = 10 + random() * 14;
      const height = 8 + random() * 11;
      const offset = outward + MARGIN + random() * 9 + depth / 2;
      const mesh = new THREE.Mesh(
        alongX ? new THREE.BoxGeometry(width, height, depth) : new THREE.BoxGeometry(depth, height, width),
        materials[Math.floor(random() * materials.length)],
      );
      const center = position + width / 2;
      mesh.position.set(alongX ? center : sign * offset, height / 2, alongX ? sign * offset : center);
      scene.add(mesh);
      position += width + 1 + random() * 7;
    }
  };
  const reachX = world.halfX + 16;
  const reachZ = world.halfZ + 16;
  place(reachX, 0, world.halfZ, -1, true);
  place(reachX, 0, world.halfZ, 1, true);
  place(reachZ, 0, world.halfX, -1, false);
  place(reachZ, 0, world.halfX, 1, false);
}

/**
 * Собирает карту. При shadows солнце отбрасывает настоящие тени от стен и бойцов,
 * а без них тени от коробок нарисованы прямо на земле.
 */
export function buildWorld(scene, world, mode, { shadows = 0, renderer = null } = {}) {
  const { theme } = world;
  // Дымка зависит от размера карты, иначе дальний конец большой карты тонул бы в ней.
  const mapReach = Math.max(world.halfX, world.halfZ);
  scene.fog = new THREE.Fog(theme.fog, mapReach, mapReach * 3.6);
  // Отражения неба на металле и стекле. Небо же даёт мягкий рассеянный свет,
  // поэтому лампа-полусфера в этом случае слабее.
  let environment = null;
  if (PBR && renderer) environment = skyEnvironment(renderer, theme);
  scene.environment = environment;
  // С настоящими тенями рассеянного света меньше, а солнца больше: иначе тени почти не видно.
  const ambient = (shadows ? 0.55 : 1) * (environment ? 0.45 : 1);
  const direct = shadows ? 2.1 : 1;
  scene.add(new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2] * ambient));
  const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1] * direct);
  sun.position.copy(SUN).multiplyScalar(60);
  scene.add(sun);
  scene.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadows, shadows);
    const reach = Math.hypot(world.halfX, world.halfZ) + 6;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 5, far: 60 + reach * 1.6 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }

  const groundTex = groundTexture(world, mode, !shadows);
  groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    mat({ color: 0x5b5a53, roughness: 1 }),
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.03;
  scene.add(outside);

  // Разметка нарисована на одной большой текстуре, а мелкий рельеф асфальта повторяется
  // через вторую развёртку (uv1) каждые 3 метра.
  const groundGeometry = new THREE.PlaneGeometry(world.halfX * 2, world.halfZ * 2);
  const groundMaterial = mat({ map: groundTex, roughness: 0.92 });
  if (PBR) {
    const uv = groundGeometry.attributes.uv;
    const detail = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      detail[i * 2] = (uv.getX(i) * world.halfX * 2) / 3;
      detail[i * 2 + 1] = (uv.getY(i) * world.halfZ * 2) / 3;
    }
    groundGeometry.setAttribute('uv1', new THREE.BufferAttribute(detail, 2));
    groundMaterial.normalMap = asphaltNormal();
    groundMaterial.normalMap.channel = 1;
    groundMaterial.normalScale.set(0.6, 0.6);
  }
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const looks = {};
  const materials = {};
  const settings = {
    wall: { roughness: 0.9 },
    concrete: { roughness: 0.85 },
    container: { roughness: 0.55, metalness: 0.35 },
    crate: { roughness: 0.8 },
    perimeter: { roughness: 0.45, metalness: 0.5 },
    brick: { roughness: 0.85 },
    plaster: { roughness: 0.95 },
    metal: { roughness: 0.4, metalness: 0.6 },
    sandbag: { roughness: 1 },
  };
  const materialFor = (box, index) => {
    looks[box.kind] ||= TEXTURES[box.kind]();
    const look = looks[box.kind];
    // У каждого контейнера свой цвет, остальное окрашено в тон карты.
    const tint = box.kind === 'container' ? CONTAINER_COLORS[index % CONTAINER_COLORS.length] : theme.tint;
    const key = `${box.kind}:${tint}`;
    materials[key] ||= mat({ map: look.map, normalMap: look.normalMap, vertexColors: true, color: tint, ...settings[box.kind] });
    return materials[key];
  };
  const batches = new Map();
  world.boxes.forEach((box, index) => {
    if (box.kind === 'barrel') {
      scene.add(barrelMesh(box, index));
      return;
    }
    const material = materialFor(box, index);
    if (!batches.has(material)) batches.set(material, { geometries: [], shadow: box.kind !== 'perimeter' });
    batches.get(material).geometries.push(boxGeometry(box));
  });
  for (const [material, { geometries, shadow }] of batches) {
    const mesh = new THREE.Mesh(mergeBoxes(geometries), material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  buildSkyline(scene, world);
  return { sky: buildSky(scene, theme), environment };
}

/** Карта окружения из неба: по ней металл и стекло получают отражения. */
function skyEnvironment(renderer, theme) {
  const envScene = new THREE.Scene();
  const texture = makeCanvas(256, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, theme.sky[0]);
    gradient.addColorStop(0.45, theme.sky[1]);
    gradient.addColorStop(0.5, theme.sky[2]);
    gradient.addColorStop(0.55, theme.ground);
    gradient.addColorStop(1, theme.ground);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide }),
  ));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d6 }));
  sun.position.copy(SUN).multiplyScalar(8);
  envScene.add(sun);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(envScene, 0.02);
  generator.dispose();
  return target.texture;
}

// ---------- Оружие ----------
function addBox(parent, size, material, position, rotationX = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.x = rotationX;
  parent.add(mesh);
  return mesh;
}

// Материалы оружия: металл блестит, пластик и дерево матовые.
const GUN_METAL = mat({ color: 0x3e444b, roughness: 0.32, metalness: 0.8 });
const GUN_STEEL = mat({ color: 0x6b727a, roughness: 0.28, metalness: 0.85 });
const GUN_DARK = mat({ color: 0x1f2226, roughness: 0.7, metalness: 0.1 });
const GUN_TAN = mat({ color: 0x9a7f52, roughness: 0.7 });
const GUN_RED = mat({ color: 0xa8362a, roughness: 0.55 });
const GUN_OLIVE = mat({ color: 0x5d6640, roughness: 0.65 });
const GUN_SILVER = mat({ color: 0xc4cad0, roughness: 0.22, metalness: 0.9 });
const GUN_WOOD = mat({ color: 0x7a4a26, roughness: 0.6 });
const BLADE = mat({ color: 0xdfe4e8, roughness: 0.18, metalness: 0.95 });
// Стекло прицела почти прозрачное: сквозь него видно цель, только лёгкий голубой отлив.
const LENS_GLOW = mat({ color: 0xaee4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.13, depthWrite: false });
const BOMB_SCREEN = mat({ color: 0x0b2010, emissive: 0x39ff6a, emissiveIntensity: 1.1 });
const BOMB_CLAY = mat({ color: 0xb59a6a, roughness: 0.9 });
const WIRE_BLUE = mat({ color: 0x2b5fb8, roughness: 0.5 });
const RED_DOT = mat({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 2 });

// Детали оружия: [размер, материал, положение, наклон, перекрашивается ли скином, роль].
// Роль 'mag' у магазина и 'bolt' у затвора: эти детали двигаются при перезарядке.
// Ствол смотрит вдоль -Z, начало координат у рукояти.
// sight: какой прицел стоит и на какой высоте планка (y) и где по длине (z).
// eye: высота линии прицеливания для железных прицелов. hand: где лежит вторая рука.
const MAG = 'mag';
const BOLT = 'bolt';

// Общие детали пистолетов
const pistolBody = (slideMat, gripMat = GUN_DARK, slideLength = 0.23) => [
  [[0.046, 0.05, slideLength], slideMat, [0, 0.065, -0.1], 0, true, BOLT], // затвор
  [[0.042, 0.035, 0.2], GUN_DARK, [0, 0.025, -0.1]], // рамка
  [[0.044, 0.13, 0.062], gripMat, [0, -0.045, 0.0], -0.22], // рукоять
  [[0.038, 0.03, 0.05], GUN_DARK, [0, -0.115, 0.018], -0.22, false, MAG], // пятка магазина
  [[0.01, 0.012, 0.06], GUN_DARK, [0, 0.0, -0.08]], // скоба
  [[0.012, 0.016, 0.012], GUN_DARK, [0, 0.098, -0.2]], // мушка
  [[0.03, 0.016, 0.012], GUN_DARK, [0, 0.098, 0.0]], // целик
];

const WEAPON_PARTS = {
  // ---------- Пистолеты ----------
  pistol: {
    cat: 'pistol', muzzle: [0, 0.06, -0.25], eye: 0.105,
    parts: [...pistolBody(GUN_METAL), [[0.02, 0.02, 0.03], GUN_STEEL, [0, 0.06, -0.225]]],
  },
  tac_pistol: {
    cat: 'pistol', muzzle: [0, 0.062, -0.42], eye: 0.105,
    parts: [
      ...pistolBody(GUN_STEEL, GUN_OLIVE),
      [[0.036, 0.036, 0.17], GUN_DARK, [0, 0.062, -0.31]], // глушитель
      [[0.038, 0.038, 0.01], GUN_METAL, [0, 0.062, -0.4]],
    ],
  },
  auto_pistol: {
    cat: 'pistol', muzzle: [0, 0.062, -0.29], eye: 0.105,
    parts: [
      ...pistolBody(GUN_METAL, GUN_DARK).filter((part) => part[5] !== MAG),
      [[0.036, 0.2, 0.05], GUN_DARK, [0, -0.1, 0.0], -0.15, false, MAG], // длинный магазин
      [[0.04, 0.03, 0.05], GUN_STEEL, [0, 0.063, -0.25], 0, true], // компенсатор
    ],
  },
  magnum: {
    cat: 'pistol', muzzle: [0, 0.075, -0.34], eye: 0.12,
    parts: [
      [[0.032, 0.04, 0.24], GUN_SILVER, [0, 0.075, -0.2], 0, true], // ствол
      [[0.012, 0.02, 0.22], GUN_SILVER, [0, 0.102, -0.2]], // планка над стволом
      [[0.062, 0.066, 0.085], GUN_SILVER, [0, 0.05, -0.04], 0, true, MAG], // барабан откидывается
      [[0.04, 0.03, 0.12], GUN_METAL, [0, 0.1, -0.03]],
      [[0.016, 0.03, 0.02], GUN_METAL, [0, 0.11, 0.035], -0.5], // курок
      [[0.012, 0.012, 0.06], GUN_DARK, [0, 0.0, -0.05]],
      [[0.046, 0.14, 0.065], GUN_WOOD, [0, -0.06, 0.04], -0.32], // деревянная рукоять
    ],
  },
  heavy_pistol: {
    cat: 'pistol', muzzle: [0, 0.07, -0.29], eye: 0.12,
    parts: [
      [[0.052, 0.062, 0.27], GUN_SILVER, [0, 0.07, -0.11], 0, true, BOLT],
      [[0.046, 0.04, 0.22], GUN_DARK, [0, 0.025, -0.1]],
      [[0.05, 0.14, 0.068], GUN_DARK, [0, -0.05, 0.0], -0.22],
      [[0.044, 0.03, 0.055], GUN_DARK, [0, -0.125, 0.02], -0.22, false, MAG],
      [[0.012, 0.012, 0.07], GUN_DARK, [0, -0.005, -0.08]],
      [[0.014, 0.018, 0.014], GUN_DARK, [0, 0.108, -0.23]],
      [[0.034, 0.018, 0.014], GUN_DARK, [0, 0.108, 0.01]],
    ],
  },

  // ---------- Пистолеты-пулемёты ----------
  smg: {
    cat: 'smg', muzzle: [0, 0.05, -0.52], eye: 0.1, hand: -0.33,
    parts: [
      [[0.055, 0.08, 0.3], GUN_SILVER, [0, 0.03, -0.12], 0, true],
      [[0.04, 0.012, 0.2], GUN_DARK, [0, 0.077, -0.12]],
      [[0.03, 0.025, 0.02], GUN_DARK, [0, 0.092, 0.0]], // целик
      [[0.01, 0.03, 0.015], GUN_DARK, [0, 0.09, -0.25]], // мушка
      [[0.03, 0.03, 0.18], GUN_STEEL, [0, 0.05, -0.38]],
      [[0.04, 0.04, 0.04], GUN_DARK, [0, 0.05, -0.49]],
      [[0.036, 0.2, 0.05], GUN_DARK, [0, -0.12, -0.18], 0.05, false, MAG],
      [[0.035, 0.1, 0.04], GUN_DARK, [0, -0.06, -0.33]], // передняя рукоять
      [[0.045, 0.11, 0.055], GUN_DARK, [0, -0.06, 0.01], -0.3],
      [[0.015, 0.015, 0.2], GUN_METAL, [0.02, 0.04, 0.13]], // складной приклад
      [[0.015, 0.015, 0.2], GUN_METAL, [-0.02, 0.04, 0.13]],
      [[0.05, 0.07, 0.015], GUN_DARK, [0, 0.02, 0.23]],
    ],
  },
  smg2: {
    cat: 'smg', muzzle: [0, 0.04, -0.42], hand: -0.3, sight: { type: 'dot', y: 0.085, z: -0.1 },
    parts: [
      [[0.058, 0.09, 0.32], GUN_DARK, [0, 0.03, -0.12], 0, true],
      [[0.03, 0.01, 0.2], GUN_METAL, [0, 0.08, -0.12]],
      [[0.042, 0.042, 0.12], GUN_METAL, [0, 0.04, -0.33]], // кожух ствола
      [[0.026, 0.026, 0.06], GUN_STEEL, [0, 0.04, -0.4]],
      [[0.035, 0.16, 0.05], GUN_DARK, [0, -0.1, -0.17], 0.04, false, MAG],
      [[0.045, 0.11, 0.055], GUN_DARK, [0, -0.06, 0.01], -0.3],
      [[0.02, 0.05, 0.02], GUN_DARK, [0.012, -0.045, -0.3]], // упор для второй руки
      [[0.012, 0.06, 0.18], GUN_METAL, [0, 0.0, 0.12]], // рамочный приклад
      [[0.04, 0.08, 0.015], GUN_DARK, [0, -0.005, 0.21]],
      [[0.012, 0.02, 0.05], GUN_STEEL, [0.034, 0.05, -0.08], 0, false, BOLT],
    ],
  },
  pdw: {
    cat: 'smg', muzzle: [0, 0.035, -0.4], hand: -0.28, sight: { type: 'holo', y: 0.075, z: -0.06 },
    parts: [
      [[0.062, 0.1, 0.42], GUN_TAN, [0, 0.015, -0.08], 0, true], // обтекаемый корпус
      [[0.058, 0.02, 0.36], GUN_DARK, [0, 0.07, -0.08]],
      [[0.03, 0.03, 0.05], GUN_STEEL, [0, 0.035, -0.32]],
      [[0.04, 0.04, 0.03], GUN_DARK, [0, 0.035, -0.37]],
      [[0.038, 0.13, 0.055], GUN_DARK, [0, -0.1, -0.2], 0.1, false, MAG],
      [[0.045, 0.1, 0.05], GUN_DARK, [0, -0.07, -0.02], -0.25],
      [[0.04, 0.09, 0.05], GUN_TAN, [0, -0.06, -0.3], 0.2, true], // передний упор
      [[0.06, 0.1, 0.03], GUN_DARK, [0, 0.0, 0.14]],
      [[0.012, 0.02, 0.05], GUN_STEEL, [0.036, 0.04, -0.12], 0, false, BOLT],
    ],
  },

  // ---------- Дробовики ----------
  shotgun: {
    cat: 'shotgun', muzzle: [0, 0.06, -0.76], eye: 0.085, hand: -0.36,
    parts: [
      [[0.055, 0.075, 0.22], GUN_METAL, [0, 0.04, -0.06], 0, true], // коробка
      [[0.03, 0.03, 0.6], GUN_STEEL, [0, 0.06, -0.45]], // ствол
      [[0.026, 0.026, 0.48], GUN_METAL, [0, 0.025, -0.4]], // трубчатый магазин
      [[0.054, 0.052, 0.16], GUN_WOOD, [0, 0.028, -0.36], 0, true, BOLT], // цевьё-помпа
      [[0.012, 0.012, 0.012], GUN_SILVER, [0, 0.082, -0.74]], // мушка-шарик
      [[0.05, 0.09, 0.3], GUN_WOOD, [0, -0.005, 0.17], -0.06, true], // приклад
      [[0.046, 0.1, 0.055], GUN_WOOD, [0, -0.05, 0.04], -0.4, true],
      [[0.052, 0.1, 0.02], GUN_DARK, [0, -0.01, 0.32]],
      [[0.012, 0.012, 0.07], GUN_DARK, [0, -0.01, -0.03]],
    ],
  },
  auto_shotgun: {
    cat: 'shotgun', muzzle: [0, 0.055, -0.68], eye: 0.105, hand: -0.36,
    parts: [
      [[0.062, 0.09, 0.4], GUN_DARK, [0, 0.035, -0.14], 0, true],
      [[0.034, 0.012, 0.34], GUN_METAL, [0, 0.087, -0.14]], // планка
      [[0.03, 0.03, 0.03], GUN_DARK, [0, 0.1, 0.0]],
      [[0.012, 0.035, 0.015], GUN_DARK, [0, 0.1, -0.3]],
      [[0.032, 0.032, 0.25], GUN_STEEL, [0, 0.055, -0.48]],
      [[0.044, 0.044, 0.06], GUN_DARK, [0, 0.055, -0.64]],
      [[0.06, 0.13, 0.1], GUN_DARK, [0, -0.08, -0.22], 0.05, false, MAG], // коробчатый магазин
      [[0.046, 0.11, 0.055], GUN_DARK, [0, -0.06, 0.01], -0.3],
      [[0.055, 0.09, 0.22], GUN_DARK, [0, 0.01, 0.16], 0, true],
      [[0.014, 0.02, 0.05], GUN_STEEL, [0.04, 0.06, -0.12], 0, false, BOLT],
    ],
  },

  // ---------- Автоматы ----------
  rifle: {
    cat: 'rifle', muzzle: [0, 0.05, -0.8], eye: 0.12, hand: -0.44,
    parts: [
      [[0.06, 0.085, 0.36], GUN_METAL, [0, 0.03, -0.17], 0, true], // ствольная коробка
      [[0.05, 0.02, 0.3], GUN_STEEL, [0, 0.083, -0.17]], // крышка
      [[0.03, 0.035, 0.03], GUN_DARK, [0, 0.118, -0.05]], // целик
      [[0.012, 0.06, 0.02], GUN_DARK, [0, 0.09, -0.52]], // мушка
      [[0.066, 0.07, 0.22], GUN_TAN, [0, 0.03, -0.44], 0, true], // цевьё
      [[0.026, 0.026, 0.3], GUN_STEEL, [0, 0.05, -0.6]], // ствол
      [[0.02, 0.02, 0.2], GUN_METAL, [0, 0.078, -0.45]], // газовая трубка
      [[0.042, 0.042, 0.06], GUN_DARK, [0, 0.05, -0.77]], // дульный тормоз
      [[0.045, 0.11, 0.07], GUN_DARK, [0, -0.07, -0.24], 0.2, false, MAG], // изогнутый магазин
      [[0.045, 0.08, 0.065], GUN_DARK, [0, -0.15, -0.28], 0.45, false, MAG],
      [[0.045, 0.11, 0.055], GUN_TAN, [0, -0.06, -0.03], -0.35, true], // рукоять
      [[0.012, 0.012, 0.08], GUN_DARK, [0, -0.035, -0.09]], // спусковая скоба
      [[0.05, 0.075, 0.22], GUN_TAN, [0, 0.0, 0.12], 0, true], // приклад
      [[0.052, 0.1, 0.02], GUN_DARK, [0, -0.005, 0.235]], // затыльник
      [[0.04, 0.012, 0.012], GUN_STEEL, [0.036, 0.06, -0.12], 0, false, BOLT], // рукоять затвора
    ],
  },
  bullpup: {
    cat: 'rifle', muzzle: [0, 0.05, -0.52], hand: -0.32, sight: { type: 'holo', y: 0.095, z: -0.14 },
    parts: [
      [[0.064, 0.1, 0.56], GUN_OLIVE, [0, 0.03, -0.06], 0, true], // корпус-буллпап
      [[0.034, 0.012, 0.3], GUN_METAL, [0, 0.087, -0.14]],
      [[0.028, 0.028, 0.16], GUN_STEEL, [0, 0.05, -0.42]],
      [[0.04, 0.04, 0.04], GUN_DARK, [0, 0.05, -0.51]],
      [[0.046, 0.11, 0.055], GUN_DARK, [0, -0.06, -0.14], -0.3], // рукоять впереди магазина
      [[0.046, 0.13, 0.07], GUN_DARK, [0, -0.08, 0.06], 0.1, false, MAG], // магазин за рукоятью
      [[0.07, 0.11, 0.025], GUN_DARK, [0, 0.025, 0.225]],
      [[0.04, 0.03, 0.12], GUN_OLIVE, [0, -0.025, -0.3], 0, true], // цевьё
      [[0.014, 0.02, 0.05], GUN_STEEL, [0.04, 0.06, 0.04], 0, false, BOLT],
    ],
  },
  carbine: {
    cat: 'rifle', muzzle: [0, 0.055, -0.76], hand: -0.46, sight: { type: 'dot', y: 0.1, z: -0.16 },
    parts: [
      [[0.058, 0.09, 0.34], GUN_OLIVE, [0, 0.03, -0.14], 0, true],
      [[0.062, 0.068, 0.3], GUN_DARK, [0, 0.04, -0.46]], // цевьё с планками
      [[0.066, 0.01, 0.3], GUN_METAL, [0, 0.078, -0.46]],
      [[0.03, 0.012, 0.32], GUN_METAL, [0, 0.093, -0.2]],
      [[0.026, 0.026, 0.16], GUN_STEEL, [0, 0.055, -0.66]],
      [[0.036, 0.036, 0.05], GUN_DARK, [0, 0.055, -0.74]],
      [[0.045, 0.15, 0.07], GUN_DARK, [0, -0.1, -0.25], 0.08, false, MAG], // прямой магазин
      [[0.044, 0.11, 0.055], GUN_DARK, [0, -0.06, -0.02], -0.35],
      [[0.025, 0.025, 0.16], GUN_METAL, [0, 0.03, 0.08]], // трубка приклада
      [[0.05, 0.09, 0.12], GUN_OLIVE, [0, 0.0, 0.18], 0, true],
      [[0.03, 0.012, 0.012], GUN_STEEL, [0, 0.07, 0.02], 0, false, BOLT], // рычаг затвора
    ],
  },
  battle: {
    cat: 'rifle', muzzle: [0, 0.055, -0.9], hand: -0.5, sight: { type: 'scope2', y: 0.1, z: -0.14 },
    parts: [
      [[0.066, 0.1, 0.42], GUN_DARK, [0, 0.035, -0.16], 0, true],
      [[0.036, 0.012, 0.36], GUN_METAL, [0, 0.092, -0.18]],
      [[0.07, 0.08, 0.26], GUN_TAN, [0, 0.04, -0.5], 0, true], // цевьё
      [[0.03, 0.03, 0.22], GUN_STEEL, [0, 0.055, -0.74]],
      [[0.05, 0.05, 0.08], GUN_DARK, [0, 0.055, -0.86]], // дульный тормоз
      [[0.05, 0.14, 0.08], GUN_DARK, [0, -0.09, -0.24], 0.06, false, MAG],
      [[0.046, 0.11, 0.055], GUN_DARK, [0, -0.06, -0.02], -0.32],
      [[0.055, 0.1, 0.26], GUN_TAN, [0, 0.01, 0.17], 0, true],
      [[0.058, 0.12, 0.02], GUN_DARK, [0, 0.0, 0.31]],
      [[0.016, 0.02, 0.05], GUN_STEEL, [0.042, 0.06, -0.1], 0, false, BOLT],
    ],
  },

  // ---------- Снайперские винтовки ----------
  dmr: {
    cat: 'sniper', muzzle: [0, 0.05, -1.0], hand: -0.46, sight: { type: 'scope', y: 0.1, z: -0.16 },
    parts: [
      [[0.058, 0.09, 0.42], GUN_OLIVE, [0, 0.03, -0.16], 0, true],
      [[0.064, 0.07, 0.24], GUN_DARK, [0, 0.035, -0.48]],
      [[0.028, 0.028, 0.32], GUN_STEEL, [0, 0.05, -0.78]],
      [[0.044, 0.044, 0.07], GUN_DARK, [0, 0.05, -0.96]],
      [[0.046, 0.1, 0.07], GUN_DARK, [0, -0.07, -0.22], 0.06, false, MAG],
      [[0.046, 0.11, 0.055], GUN_DARK, [0, -0.06, -0.02], -0.32],
      [[0.052, 0.1, 0.28], GUN_OLIVE, [0, 0.0, 0.17], 0, true],
      [[0.04, 0.03, 0.12], GUN_DARK, [0, 0.06, 0.15]], // щека
      [[0.016, 0.02, 0.05], GUN_STEEL, [0.04, 0.06, -0.1], 0, false, BOLT],
    ],
  },
  sniper: {
    cat: 'sniper', muzzle: [0, 0.05, -1.1], hand: -0.42, sight: { type: 'scope', y: 0.105, z: -0.2 },
    parts: [
      [[0.055, 0.075, 0.46], GUN_DARK, [0, 0.03, -0.2], 0, true],
      [[0.028, 0.028, 0.62], GUN_STEEL, [0, 0.05, -0.74]],
      [[0.045, 0.05, 0.07], GUN_DARK, [0, 0.05, -1.06]],
      [[0.04, 0.012, 0.012], GUN_STEEL, [0.04, 0.07, -0.04], 0, false, BOLT], // рукоять затвора
      [[0.045, 0.06, 0.08], GUN_DARK, [0, -0.04, -0.18], 0, false, MAG],
      [[0.05, 0.12, 0.06], GUN_RED, [0, -0.07, -0.02], -0.3, true],
      [[0.05, 0.1, 0.28], GUN_RED, [0, 0.0, 0.15], 0, true],
      [[0.052, 0.12, 0.02], GUN_DARK, [0, -0.005, 0.3]],
    ],
  },
  heavy_sniper: {
    cat: 'sniper', muzzle: [0, 0.06, -1.32], hand: -0.5, sight: { type: 'scope', y: 0.125, z: -0.2 },
    parts: [
      [[0.072, 0.11, 0.6], GUN_METAL, [0, 0.04, -0.2], 0, true],
      [[0.042, 0.042, 0.66], GUN_STEEL, [0, 0.06, -0.86]],
      [[0.09, 0.07, 0.11], GUN_DARK, [0, 0.06, -1.24]], // большой дульный тормоз
      [[0.06, 0.12, 0.1], GUN_DARK, [0, -0.08, -0.24], 0, false, MAG],
      [[0.05, 0.12, 0.06], GUN_DARK, [0, -0.07, -0.02], -0.3],
      [[0.064, 0.12, 0.3], GUN_METAL, [0, 0.01, 0.2], 0, true],
      [[0.066, 0.13, 0.025], GUN_DARK, [0, 0.0, 0.36]],
      [[0.012, 0.012, 0.3], GUN_DARK, [0.03, -0.02, -0.62], 0.08], // сложенные сошки
      [[0.012, 0.012, 0.3], GUN_DARK, [-0.03, -0.02, -0.62], 0.08],
      [[0.05, 0.016, 0.016], GUN_STEEL, [0.05, 0.08, -0.02], 0, false, BOLT],
    ],
  },

  // ---------- Пулемёт ----------
  lmg: {
    cat: 'mg', muzzle: [0, 0.06, -0.92], eye: 0.15, hand: -0.42,
    parts: [
      [[0.072, 0.11, 0.42], GUN_DARK, [0, 0.04, -0.12], 0, true],
      [[0.07, 0.025, 0.3], GUN_METAL, [0, 0.105, -0.1], 0, false, BOLT], // крышка лентоприёмника
      [[0.03, 0.035, 0.03], GUN_DARK, [0, 0.135, 0.04]],
      [[0.012, 0.07, 0.02], GUN_DARK, [0, 0.11, -0.7]],
      [[0.058, 0.058, 0.38], GUN_METAL, [0, 0.06, -0.52]], // кожух ствола
      [[0.03, 0.03, 0.12], GUN_STEEL, [0, 0.06, -0.78]],
      [[0.05, 0.05, 0.06], GUN_DARK, [0, 0.06, -0.88]],
      [[0.1, 0.13, 0.13], GUN_OLIVE, [0, -0.08, -0.2], 0, true, MAG], // короб с лентой
      [[0.05, 0.11, 0.06], GUN_DARK, [0, -0.06, 0.02], -0.32],
      [[0.03, 0.02, 0.16], GUN_METAL, [0, 0.16, -0.24]], // ручка для переноски
      [[0.06, 0.1, 0.24], GUN_DARK, [0, 0.02, 0.2], 0, true],
      [[0.012, 0.012, 0.3], GUN_DARK, [0.03, 0.0, -0.66], 0.06],
      [[0.012, 0.012, 0.3], GUN_DARK, [-0.03, 0.0, -0.66], 0.06],
    ],
  },

  // ---------- Бомба: брикеты взрывчатки, обмотанные лентой, и пульт с экраном ----------
  bomb: {
    cat: 'bomb', muzzle: [0, 0.05, -0.2], eye: 0.08, hand: -0.02,
    parts: [
      [[0.062, 0.075, 0.2], BOMB_CLAY, [-0.066, 0, -0.1]],
      [[0.062, 0.075, 0.2], BOMB_CLAY, [0, 0, -0.1]],
      [[0.062, 0.075, 0.2], BOMB_CLAY, [0.066, 0, -0.1]],
      [[0.204, 0.08, 0.022], GUN_DARK, [0, 0, -0.035]], // лента
      [[0.204, 0.08, 0.022], GUN_DARK, [0, 0, -0.165]],
      [[0.13, 0.03, 0.1], GUN_DARK, [0, 0.052, -0.1]], // пульт
      [[0.09, 0.004, 0.032], BOMB_SCREEN, [0, 0.069, -0.128]], // экран
      [[0.016, 0.006, 0.012], GUN_SILVER, [-0.03, 0.069, -0.088]], // кнопки
      [[0.016, 0.006, 0.012], GUN_SILVER, [0, 0.069, -0.088]],
      [[0.016, 0.006, 0.012], GUN_SILVER, [0.03, 0.069, -0.088]],
      [[0.016, 0.006, 0.012], GUN_SILVER, [-0.03, 0.069, -0.068]],
      [[0.016, 0.006, 0.012], GUN_RED, [0, 0.069, -0.068]],
      [[0.016, 0.006, 0.012], GUN_SILVER, [0.03, 0.069, -0.068]],
      [[0.008, 0.008, 0.16], GUN_RED, [0.072, 0.045, -0.1]], // провода
      [[0.008, 0.008, 0.16], WIRE_BLUE, [-0.072, 0.045, -0.1]],
      [[0.006, 0.07, 0.006], GUN_DARK, [0.05, 0.1, -0.06]], // антенна
    ],
  },

  // ---------- Нож ----------
  knife: {
    cat: 'knife', muzzle: [0, 0, -0.3], eye: 0,
    parts: [
      [[0.034, 0.045, 0.12], GUN_DARK, [0, 0, 0]], // рукоять
      [[0.036, 0.008, 0.012], GUN_METAL, [0, 0.026, 0.02]], // насечки
      [[0.036, 0.008, 0.012], GUN_METAL, [0, 0.026, -0.02]],
      [[0.04, 0.05, 0.035], GUN_METAL, [0, 0, 0.075]], // навершие
      [[0.06, 0.07, 0.018], GUN_METAL, [0, 0, -0.065]], // гарда
      [[0.01, 0.052, 0.19], BLADE, [0, 0.004, -0.165], 0, true], // клинок
      [[0.008, 0.03, 0.06], BLADE, [0, 0.016, -0.285], -0.25, true], // остриё
    ],
  },
};

/** Насадки-прицелы. Возвращают высоту линии прицеливания над планкой. */
/** Полая труба вдоль Z: четыре стенки, а внутри пусто, поэтому сквозь неё видно. */
function tube(group, width, height, length, material, [x, y, z], wall = 0.005) {
  addBox(group, [width, wall, length], material, [x, y + height / 2 - wall / 2, z]);
  addBox(group, [width, wall, length], material, [x, y - height / 2 + wall / 2, z]);
  addBox(group, [wall, height - wall * 2, length], material, [x + width / 2 - wall / 2, y, z]);
  addBox(group, [wall, height - wall * 2, length], material, [x - width / 2 + wall / 2, y, z]);
}

/** Сетка прицела: тонкий крест и светящаяся точка в центре трубы. */
function reticle(group, span, y, z, gap = 0.004) {
  const arm = (span - gap * 2) / 2;
  const off = gap + arm / 2;
  addBox(group, [arm, 0.0016, 0.001], GUN_DARK, [off, y, z]);
  addBox(group, [arm, 0.0016, 0.001], GUN_DARK, [-off, y, z]);
  addBox(group, [0.0016, arm, 0.001], GUN_DARK, [0, y + off, z]);
  addBox(group, [0.0016, arm, 0.001], GUN_DARK, [0, y - off, z]);
  addBox(group, [0.0035, 0.0035, 0.001], RED_DOT, [0, y, z]);
}

/** Насадки-прицелы. Возвращают высоту линии прицеливания над планкой. */
const SIGHTS = {
  dot(group, y, z) {
    addBox(group, [0.034, 0.012, 0.06], GUN_DARK, [0, y + 0.006, z]); // крепление
    tube(group, 0.044, 0.046, 0.075, GUN_DARK, [0, y + 0.035, z]);
    addBox(group, [0.034, 0.036, 0.002], LENS_GLOW, [0, y + 0.035, z - 0.035]);
    // Красная точка висит в стекле: вокруг неё видно цель.
    addBox(group, [0.0045, 0.0045, 0.001], RED_DOT, [0, y + 0.035, z - 0.033]);
    return y + 0.035;
  },
  holo(group, y, z) {
    addBox(group, [0.046, 0.016, 0.085], GUN_DARK, [0, y + 0.008, z]);
    addBox(group, [0.006, 0.05, 0.05], GUN_DARK, [0.021, y + 0.038, z - 0.01]);
    addBox(group, [0.006, 0.05, 0.05], GUN_DARK, [-0.021, y + 0.038, z - 0.01]);
    addBox(group, [0.048, 0.008, 0.05], GUN_DARK, [0, y + 0.064, z - 0.01]);
    addBox(group, [0.036, 0.04, 0.002], LENS_GLOW, [0, y + 0.04, z - 0.03]);
    addBox(group, [0.012, 0.0018, 0.001], RED_DOT, [0, y + 0.04, z - 0.028]);
    addBox(group, [0.0018, 0.012, 0.001], RED_DOT, [0, y + 0.04, z - 0.028]);
    return y + 0.04;
  },
  scope2(group, y, z) {
    addBox(group, [0.02, 0.022, 0.02], GUN_DARK, [0, y + 0.011, z - 0.05]);
    addBox(group, [0.02, 0.022, 0.02], GUN_DARK, [0, y + 0.011, z + 0.05]);
    const cy = y + 0.045;
    tube(group, 0.04, 0.04, 0.2, GUN_METAL, [0, cy, z]);
    tube(group, 0.05, 0.05, 0.04, GUN_DARK, [0, cy, z - 0.11], 0.006);
    tube(group, 0.046, 0.046, 0.03, GUN_DARK, [0, cy, z + 0.1], 0.006);
    addBox(group, [0.036, 0.036, 0.002], LENS_GLOW, [0, cy, z - 0.125]);
    reticle(group, 0.03, cy, z - 0.02);
    return cy;
  },
  scope(group, y, z) {
    addBox(group, [0.02, 0.026, 0.02], GUN_DARK, [0, y + 0.013, z - 0.09]);
    addBox(group, [0.02, 0.026, 0.02], GUN_DARK, [0, y + 0.013, z + 0.09]);
    const cy = y + 0.052;
    tube(group, 0.046, 0.046, 0.34, GUN_METAL, [0, cy, z]);
    tube(group, 0.06, 0.06, 0.05, GUN_DARK, [0, cy, z - 0.18], 0.007);
    tube(group, 0.056, 0.056, 0.04, GUN_DARK, [0, cy, z + 0.17], 0.007);
    addBox(group, [0.044, 0.044, 0.002], LENS_GLOW, [0, cy, z - 0.2]);
    reticle(group, 0.036, cy, z - 0.05);
    addBox(group, [0.02, 0.022, 0.03], GUN_DARK, [0.033, cy + 0.008, z - 0.02]); // барабанчик
    return cy;
  },
};

/** Сведения о модели оружия: раздел, где лежит вторая рука и т. п. */
export function weaponInfo(kind) {
  const spec = WEAPON_PARTS[kind] || WEAPON_PARTS.pistol;
  return { cat: spec.cat, hand: spec.hand ?? -0.4 };
}

const skinMaterials = new Map();

function skinMaterial(skin) {
  let material = skinMaterials.get(skin.id);
  if (!material) {
    const map = makeCanvas(256, 256, (ctx, w, h) => drawSkin(ctx, w, h, skin));
    // Краска скина блестит, как лак на металле.
    material = mat({ map, roughness: 0.35, metalness: 0.35 });
    if (skin.glow) {
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = map;
      material.emissiveIntensity = 0.55;
    }
    skinMaterials.set(skin.id, material);
  }
  return material;
}

/** Масштабирует развёртку по размеру детали, чтобы рисунок скина не растягивался. */
function fitSkinUv(geometry, [sx, sy, sz]) {
  const tile = 0.24;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const uv = geometry.attributes.uv;
  dims.forEach(([u, v], face) => {
    for (let i = 0; i < 4; i++) {
      const index = face * 4 + i;
      uv.setXY(index, (uv.getX(index) * u) / tile, (uv.getY(index) * v) / tile);
    }
  });
}

/** Ствол направлен вдоль -Z, начало координат у рукояти. */
export function buildWeapon(kind, skin = null) {
  const group = new THREE.Group();
  const spec = WEAPON_PARTS[kind] || WEAPON_PARTS.pistol;
  // Магазин и затвор лежат в отдельных группах: при перезарядке они двигаются сами по себе.
  const roles = { mag: new THREE.Group(), bolt: new THREE.Group() };
  group.add(roles.mag, roles.bolt);
  for (const [size, material, position, tilt = 0, painted = false, role = null] of spec.parts) {
    const useSkin = skin && painted;
    const mesh = addBox(roles[role] || group, size, useSkin ? skinMaterial(skin) : material, position, tilt);
    if (useSkin) fitSkinUv(mesh.geometry, size);
  }
  let eye = spec.eye ?? 0.1;
  if (spec.sight && SIGHTS[spec.sight.type]) eye = SIGHTS[spec.sight.type](group, spec.sight.y, spec.sight.z);
  group.userData.muzzle = new THREE.Vector3(...spec.muzzle);
  group.userData.mag = roles.mag.children.length ? roles.mag : null;
  group.userData.bolt = roles.bolt.children.length ? roles.bolt : null;
  group.userData.eye = eye; // высота линии прицеливания: по ней оружие встаёт в центр экрана
  group.userData.hand = spec.hand ?? -0.4;
  group.userData.cat = spec.cat;
  group.userData.sight = spec.sight?.type ?? 'iron';
  return group;
}

// ---------- Картинка оружия для инвентаря ----------
let iconRig;
const iconCache = new Map();

function createIconRig() {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(280, 140);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 2.6));
    const light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(1, 1, 0.3);
    scene.add(light);
    return { renderer, scene, camera: new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 20) };
  } catch {
    return null;
  }
}

/** Возвращает картинку оружия со скином. Без WebGL возвращает null, и карточка обойдётся без неё. */
export function renderWeaponIcon(kind, skin) {
  const key = `${kind}:${skin ? skin.id : ''}`;
  if (iconCache.has(key)) return iconCache.get(key);
  if (iconRig === undefined) iconRig = createIconRig();
  if (!iconRig) return null;

  const { renderer, scene, camera } = iconRig;
  const weapon = buildWeapon(kind, skin);
  scene.add(weapon);
  const bounds = new THREE.Box3().setFromObject(weapon);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const halfWidth = Math.max(size.z, size.y * 2) * 0.56;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfWidth / 2;
  camera.bottom = -halfWidth / 2;
  camera.position.set(center.x + 3, center.y, center.z);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(weapon);
  weapon.traverse((child) => child.geometry?.dispose());
  iconCache.set(key, url);
  return url;
}

// ---------- Модель игрока ----------
const SKIN = mat({ color: 0xc99272, roughness: 0.6 });
const GLOVES = mat({ color: 0x25282c, roughness: 0.75 });
const BOOTS = mat({ color: 0x2e261f, roughness: 0.6 });
const STRAPS = mat({ color: 0x1d2023, roughness: 0.8 });
const LENS = mat({ color: 0x10181d, roughness: 0.05, metalness: 0.7, emissive: 0x16242c });

// Форма команд: камуфляж рисуется тем же кодом, что и скины.
// Террористы: пустынный камуфляж, балаклава и тканевая разгрузка.
// Антитеррористы: тёмно-синяя цифра, шлем, очки и бронежилет с рюкзаком.
const UNIFORMS = [
  { pattern: 'camo', colors: ['#8f7a55', '#5e4c33', '#b59d70'], vest: 0x58603c, helmet: 0x6e5c40, mask: 0x222224 },
  { pattern: 'digital', colors: ['#3e4f68', '#27303f', '#617591'], vest: 0x25385a, helmet: 0x2b3546, mask: 0x1b1d22 },
];
const uniformMaterials = [];

export function uniformMaterial(team) {
  const index = team === 1 ? 1 : 0;
  if (!uniformMaterials[index]) {
    const look = UNIFORMS[index];
    const map = makeCanvas(128, 128, (ctx, w, h) => drawSkin(ctx, w, h, { id: `uniform${index}`, ...look }));
    map.repeat.set(2, 2);
    uniformMaterials[index] = {
      cloth: mat({ map, roughness: 0.95 }),
      vest: mat({ color: look.vest, roughness: 0.7 }),
      vestDark: mat({ color: new THREE.Color(look.vest).multiplyScalar(0.6), roughness: 0.8 }),
      helmet: mat({ color: look.helmet, roughness: 0.45, metalness: 0.25 }),
      mask: mat({ color: look.mask, roughness: 1 }),
    };
  }
  return uniformMaterials[index];
}

const geometryCache = new Map();
function cachedGeometry(key, make) {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
}

const capsule = (radius, length) => cachedGeometry(`c${radius}:${length}`, () => new THREE.CapsuleGeometry(radius, length, 3, 8));
const sphere = (radius) => cachedGeometry(`s${radius}`, () => new THREE.SphereGeometry(radius, 12, 9));
const block = (x, y, z) => cachedGeometry(`b${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));
const helmetShell = () => cachedGeometry('helmet', () => new THREE.SphereGeometry(0.142, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56));

function part(parent, geometry, material, position = [0, 0, 0], scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function joint(parent, position) {
  const group = new THREE.Group();
  group.position.set(...position);
  parent.add(group);
  return group;
}

// Положение рук для разного оружия: [плечо X, плечо Z, локоть] правой и левой руки и место оружия.
const ARM_POSES = {
  long: { right: [1.05, 0.12, 0.95], left: [1.38, -0.55, 0.45], gun: [0.06, 0.33, -0.3] },
  pistol: { right: [1.42, 0.08, 0.12], left: [1.36, -0.42, 0.25], gun: [0.02, 0.42, -0.52] },
  knife: { right: [0.75, 0.1, 1.1], left: [0.25, -0.12, 0.35], gun: [0.2, 0.3, -0.34] },
};
const poseFor = (kind) => {
  const cat = WEAPON_PARTS[kind]?.cat;
  if (cat === 'bomb') return 'pistol';
  return cat === 'pistol' || cat === 'knife' ? cat : 'long';
};

const SHADOW = makeCanvas(64, 64, (ctx) => {
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,.6)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
});

function makeNameTag(name, color) {
  const texture = makeCanvas(256, 56, (ctx, w, h) => {
    ctx.font = '600 30px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(name, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(name, w / 2, h / 2);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(1.5, 0.33, 1);
  sprite.position.y = 2.15;
  return sprite;
}

/**
 * Боец с суставами: бёдра, колени, плечи и локти двигаются отдельно.
 * Начало координат у ног, лицо смотрит в сторону -Z.
 */
export class PlayerModel {
  constructor(scene, team) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.pose = joint(this.root, [0, 0, 0]); // всё тело: им заваливается погибший
    this.team = -1;
    this.weaponKind = null;
    this.armPose = null;
    this.walk = 0;
    this.fall = 0;
    this.crouch = 0;
    this.flinch = 0;
    this.reloadPose = 0;
    this.tag = null;
    this.tagKey = '';
    this.parts = [];
    this.scene.add(this.root);
    this.setTeam(team);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: SHADOW, transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    this.root.add(shadow);
  }

  /** Собирает тело заново: так проще всего перекрасить форму при смене команды. */
  _build() {
    this.pose.clear();
    const look = uniformMaterial(this.team);
    this.hips = joint(this.pose, [0, 0.95, 0]);

    this.thighs = [];
    this.knees = [];
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, [side * 0.1, 0, 0]);
      part(thigh, capsule(0.078, 0.28), look.cloth, [0, -0.21, 0]);
      part(thigh, block(0.11, 0.09, 0.05), STRAPS, [0, -0.4, -0.07]); // наколенник
      const knee = joint(thigh, [0, -0.43, 0]);
      part(knee, capsule(0.066, 0.3), look.cloth, [0, -0.2, 0]);
      part(knee, block(0.12, 0.1, 0.25), BOOTS, [0, -0.43, -0.04]);
      this.thighs.push(thigh);
      this.knees.push(knee);
    }

    this.spine = joint(this.hips, [0, 0.03, 0]);
    part(this.spine, block(0.31, 0.09, 0.21), STRAPS, [0, 0, 0]); // ремень
    part(this.spine, capsule(0.15, 0.2), look.cloth, [0, 0.27, 0], [1.28, 1, 0.82]);
    const terrorist = this.team === 0;
    if (terrorist) {
      // Лёгкая разгрузка с подсумками и шарф на шее.
      part(this.spine, block(0.34, 0.24, 0.25), look.vest, [0, 0.3, 0]);
      for (const x of [-0.1, 0, 0.1]) part(this.spine, block(0.075, 0.12, 0.07), look.vestDark, [x, 0.24, -0.15]);
      part(this.spine, block(0.05, 0.4, 0.27), STRAPS, [0.08, 0.3, 0], [1, 1, 1.02]); // ремень через плечо
      part(this.spine, capsule(0.075, 0.04), look.mask, [0, 0.5, 0], [1.2, 1, 1.2]);
    } else {
      part(this.spine, block(0.37, 0.33, 0.27), look.vest, [0, 0.29, 0]); // бронежилет
      for (const x of [-0.11, 0, 0.11]) part(this.spine, block(0.085, 0.1, 0.06), look.vestDark, [x, 0.2, -0.155]);
      part(this.spine, block(0.27, 0.3, 0.12), look.vestDark, [0, 0.31, 0.18]); // рюкзак
      part(this.spine, block(0.16, 0.07, 0.02), STRAPS, [0, 0.4, -0.142]); // нашивка
      part(this.spine, capsule(0.052, 0.05), SKIN, [0, 0.5, 0]);
    }

    this.head = joint(this.spine, [0, 0.63, 0]);
    if (terrorist) {
      // Вязаная балаклава: видны только глаза.
      part(this.head, sphere(0.112), look.mask, [0, 0, 0], [1.05, 1.14, 1.08]);
      part(this.head, block(0.15, 0.036, 0.03), SKIN, [0, 0.022, -0.106]);
      part(this.head, block(0.13, 0.016, 0.012), LENS, [0, 0.022, -0.12]);
    } else {
      part(this.head, sphere(0.112), SKIN, [0, 0, 0], [1, 1.12, 1.05]);
      part(this.head, helmetShell(), look.helmet, [0, 0.025, 0.005]);
      part(this.head, block(0.2, 0.05, 0.05), LENS, [0, 0.025, -0.1]);
      part(this.head, block(0.24, 0.025, 0.2), STRAPS, [0, 0.028, 0.02]);
      part(this.head, block(0.17, 0.06, 0.04), look.mask, [0, -0.06, -0.09]); // маска на лице
    }

    this.arms = [];
    for (const side of [1, -1]) {
      const shoulder = joint(this.spine, [side * 0.215, 0.43, 0]);
      part(shoulder, capsule(0.058, 0.18), look.cloth, [0, -0.13, 0]);
      const elbow = joint(shoulder, [0, -0.27, 0]);
      part(elbow, capsule(0.05, 0.18), look.cloth, [0, -0.12, 0]);
      part(elbow, sphere(0.055), GLOVES, [0, -0.27, 0]);
      this.arms.push({ shoulder, elbow, side });
    }
    this.gunSlot = joint(this.spine, [0.06, 0.33, -0.3]);
    this.weaponKind = null;
    this.armPose = null;
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this._build();
  }

  setWeapon(kind, skin = null) {
    const key = `${kind}:${skin ? skin.id : ''}`;
    if (key === this.weaponKind) return;
    this.weaponKind = key;
    this.gunSlot.clear();
    const weapon = buildWeapon(kind, skin);
    weapon.traverse((child) => { child.castShadow = true; });
    this.gunSlot.add(weapon);
    this.armPose = ARM_POSES[poseFor(kind)];
    this.gunSlot.position.set(...this.armPose.gun);
  }

  /** Отдача при выстреле: оружие дёргается назад и вверх. */
  fire() {
    this.kick = 1;
  }

  /** Записывает в target точку на конце ствола. Без оружия в руках возвращает false. */
  muzzlePosition(target) {
    const weapon = this.gunSlot.children[0];
    if (!weapon) return false;
    weapon.updateWorldMatrix(true, false);
    target.copy(weapon.userData.muzzle).applyMatrix4(weapon.matrixWorld);
    return true;
  }

  /** Короткий рывок корпусом, когда в бойца попали. */
  hit() {
    this.flinch = 1;
  }

  /** Подпись видна только над союзниками, чтобы не подсвечивать врагов за углом. */
  setNameTag(name, visible) {
    const key = visible ? `${name}` : '';
    if (key === this.tagKey) return;
    this.tagKey = key;
    if (this.tag) {
      this.root.remove(this.tag);
      this.tag.material.map.dispose();
      this.tag.material.dispose();
      this.tag = null;
    }
    if (key) {
      this.tag = makeNameTag(name, this.team === 0 ? '#ffb27e' : '#8cc1ff');
      this.root.add(this.tag);
    }
  }

  update(dt, state) {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;

    const amount = Math.min(state.speed / 4.5, 1);
    this.walk += state.speed * dt * 2.1;
    this.crouch += ((state.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.flinch = Math.max(0, this.flinch - dt * 6);
    const swing = Math.sin(this.walk);
    const crouch = this.crouch;

    // Ноги: бедро качается вперёд и назад, колено сгибается, когда нога идёт назад.
    for (let i = 0; i < 2; i++) {
      const phase = i === 0 ? swing : -swing;
      this.thighs[i].rotation.x = phase * 0.55 * amount + crouch * 1.15;
      this.knees[i].rotation.x = -(Math.max(0, -phase) * 0.95 * amount + crouch * 1.75);
    }
    this.hips.position.y = 0.95 - crouch * 0.36 + Math.abs(Math.cos(this.walk)) * 0.025 * amount;

    // Корпус и голова следят за прицелом.
    this.spine.rotation.x = state.pitch * 0.5 - crouch * 0.18 - this.flinch * 0.22;
    this.spine.rotation.y = Math.sin(this.walk) * 0.05 * amount;
    this.head.rotation.x = state.pitch * 0.4;

    if (this.armPose) {
      const sides = [this.armPose.right, this.armPose.left];
      this.arms.forEach((arm, i) => {
        const [raise, spread, bend] = sides[i];
        arm.shoulder.rotation.x = raise + Math.sin(this.walk + i) * 0.04 * amount;
        arm.shoulder.rotation.z = spread;
        arm.elbow.rotation.x = bend;
      });
      // Перезарядка со стороны: оружие наклоняется, левая рука уходит к магазину.
      this.reloadPose += ((state.reloading ? 1 : 0) - this.reloadPose) * Math.min(1, dt * 8);
      const r = this.reloadPose;
      if (r > 0.01) {
        this.arms[1].shoulder.rotation.x -= 0.6 * r;
        this.arms[1].elbow.rotation.x += 0.9 * r + Math.sin(performance.now() / 120) * 0.15 * r;
      }
      this.kick = Math.max(0, (this.kick || 0) - dt * 9);
      this.gunSlot.position.z = this.armPose.gun[2] + this.kick * 0.07;
      this.gunSlot.rotation.set(0.25 * r + this.kick * 0.12, 0, -0.5 * r);
    }

    // Погибший заваливается на спину и остаётся лежать.
    const fallTarget = state.alive ? 0 : 1;
    this.fall += (fallTarget - this.fall) * Math.min(1, dt * (state.alive ? 30 : 5));
    this.pose.rotation.x = this.fall * 1.48;
    this.pose.position.y = this.fall * 0.12;
    if (this.fall > 0.05) {
      this.thighs.forEach((thigh) => { thigh.rotation.x -= this.fall * 0.3; });
    }
  }

  dispose() {
    this.setNameTag('', false);
    this.scene.remove(this.root);
  }
}

// ---------- Спреи ----------
const SPRAY_SIZE = 1.1;
const sprayMatrix = new THREE.Matrix4();
const sprayX = new THREE.Vector3();
const sprayY = new THREE.Vector3();
const sprayN = new THREE.Vector3();
const sprayUp = new THREE.Vector3();
const sprayScale = new THREE.Vector3();

/**
 * Рисунки игроков на стенах и земле. Одинаковые рисунки рисуются одним вызовом
 * (InstancedMesh), поэтому даже сотни спреев почти не нагружают видеокарту.
 */
export class SprayLayer {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();
    this.total = 0;
    this.geometry = new THREE.PlaneGeometry(SPRAY_SIZE, SPRAY_SIZE);
  }

  _group(design, nick) {
    const key = design === 'name' ? `name:${nick}` : design;
    let group = this.groups.get(key);
    if (!group) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      drawSpray(canvas, design, nick);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      // Краска лежит поверх стены: прозрачный фон, без записи глубины и чуть ближе к глазу.
      const material = mat({
        map, transparent: true, depthWrite: false, roughness: 0.7,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      group = { material, mesh: null, capacity: 0, matrices: [] };
      this.groups.set(key, group);
    }
    return group;
  }

  add(row) {
    const [, , design, x, y, z, nx, ny, nz, yaw, size, nick] = row;
    const group = this._group(design, nick);
    sprayN.set(nx, ny, nz).normalize();
    if (Math.abs(sprayN.y) > 0.7) {
      // На земле верх рисунка смотрит туда, куда смотрел игрок.
      sprayUp.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else {
      sprayUp.set(0, 1, 0);
    }
    sprayX.crossVectors(sprayUp, sprayN).normalize();
    sprayY.crossVectors(sprayN, sprayX).normalize();
    // Каждый следующий спрей чуть ближе к глазу: наложенные друг на друга не мерцают.
    const lift = 0.006 + (this.total % 32) * 0.0009;
    sprayMatrix.makeBasis(sprayX, sprayY, sprayN);
    sprayMatrix.scale(sprayScale.set(size / SPRAY_SIZE, size / SPRAY_SIZE, 1));
    sprayMatrix.setPosition(x + sprayN.x * lift, y + sprayN.y * lift, z + sprayN.z * lift);
    this.total++;
    group.matrices.push(sprayMatrix.clone());
    if (group.matrices.length > group.capacity) this._grow(group);
    const index = group.matrices.length - 1;
    group.mesh.setMatrixAt(index, group.matrices[index]);
    group.mesh.count = group.matrices.length;
    group.mesh.instanceMatrix.needsUpdate = true;
  }

  _grow(group) {
    const capacity = Math.max(16, group.capacity * 2);
    const mesh = new THREE.InstancedMesh(this.geometry, group.material, capacity);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.count = group.matrices.length;
    if (group.mesh) {
      this.scene.remove(group.mesh);
      group.mesh.dispose();
    }
    group.mesh = mesh;
    group.capacity = capacity;
    this.scene.add(mesh);
  }

  /** Заменяет все спреи списком с сервера. Готовые текстуры остаются: их создание дорого. */
  reset(rows) {
    for (const group of this.groups.values()) {
      group.matrices = [];
      if (group.mesh) group.mesh.count = 0;
    }
    this.total = 0;
    for (const row of rows) this.add(row);
  }

  clear() {
    for (const group of this.groups.values()) {
      if (group.mesh) {
        this.scene.remove(group.mesh);
        group.mesh.dispose();
      }
      group.material.map.dispose();
      group.material.dispose();
    }
    this.groups.clear();
    this.total = 0;
    this.geometry.dispose();
  }
}

// ---------- Следы от пуль, пыль, кровь ----------
const HOLE = makeCanvas(64, 64, (ctx) => {
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(10,10,10,.95)');
  gradient.addColorStop(0.35, 'rgba(25,23,20,.8)');
  gradient.addColorStop(0.6, 'rgba(60,55,48,.35)');
  gradient.addColorStop(1, 'rgba(60,55,48,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
});

const PUFF = makeCanvas(64, 64, (ctx) => {
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
});

export class Impacts {
  constructor(scene) {
    this.scene = scene;
    this.holes = [];
    this.nextHole = 0;
    this.puffs = [];
    const holeGeometry = new THREE.PlaneGeometry(0.11, 0.11);
    const holeMaterial = new THREE.MeshBasicMaterial({
      map: HOLE, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    for (let i = 0; i < 70; i++) {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      hole.visible = false;
      scene.add(hole);
      this.holes.push(hole);
    }
    for (let i = 0; i < 40; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: PUFF, transparent: true, depthWrite: false }));
      puff.visible = false;
      puff.userData = { life: 0, velocity: new THREE.Vector3() };
      scene.add(puff);
      this.puffs.push(puff);
    }
    this._look = new THREE.Vector3();
  }

  _puff(at, velocity, color, size, life) {
    const puff = this.puffs.find((p) => !p.visible) || this.puffs[Math.floor(Math.random() * this.puffs.length)];
    puff.position.copy(at);
    puff.userData.velocity.copy(velocity);
    puff.userData.life = life;
    puff.userData.total = life;
    puff.userData.size = size;
    puff.material.color.setHex(color);
    puff.visible = true;
  }

  /** Попадание в стену или пол: след, облачко пыли и искры по металлу. */
  surface(point, normal, metal) {
    const hole = this.holes[this.nextHole];
    this.nextHole = (this.nextHole + 1) % this.holes.length;
    hole.position.copy(point).addScaledVector(normal, 0.005);
    hole.lookAt(this._look.copy(hole.position).add(normal));
    hole.rotation.z = Math.random() * Math.PI;
    hole.visible = true;
    for (let i = 0; i < 3; i++) {
      const velocity = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 0.8,
        normal.y + Math.random() * 0.6,
        normal.z + (Math.random() - 0.5) * 0.8,
      ).multiplyScalar(0.6 + Math.random() * 0.6);
      this._puff(point, velocity, metal ? 0xffc46a : 0xb3aa98, metal ? 0.08 : 0.22, metal ? 0.18 : 0.6);
    }
  }

  /** Попадание по бойцу. */
  blood(point) {
    for (let i = 0; i < 4; i++) {
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.9, (Math.random() - 0.5) * 1.5);
      this._puff(point, velocity, 0x8a1010, 0.16, 0.35);
    }
  }

  clear() {
    this.holes.forEach((hole) => { hole.visible = false; });
  }

  update(dt) {
    for (const puff of this.puffs) {
      if (!puff.visible) continue;
      const data = puff.userData;
      data.life -= dt;
      if (data.life <= 0) {
        puff.visible = false;
        continue;
      }
      puff.position.addScaledVector(data.velocity, dt);
      data.velocity.y -= dt * 0.8;
      const progress = 1 - data.life / data.total;
      puff.scale.setScalar(data.size * (0.6 + progress * 1.6));
      puff.material.opacity = (1 - progress) * 0.8;
    }
  }
}

// ---------- Оружие от первого лица ----------
const FLASH = makeCanvas(128, 128, (ctx) => {
  ctx.translate(64, 64);
  const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 60);
  gradient.addColorStop(0, 'rgba(255,250,215,1)');
  gradient.addColorStop(0.28, 'rgba(255,190,75,.9)');
  gradient.addColorStop(1, 'rgba(255,90,10,0)');
  ctx.fillStyle = gradient;
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(0, -62);
    ctx.lineTo(14, 0);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, 7);
  ctx.fill();
});

function flashSprite() {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: FLASH, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false,
  }));
}

// Положение оружия «от бедра» для каждого раздела.
const VM_OFFSET = {
  rifle: [0.24, -0.22, -0.46],
  smg: [0.23, -0.21, -0.48],
  shotgun: [0.24, -0.22, -0.44],
  pistol: [0.22, -0.2, -0.5],
  sniper: [0.25, -0.23, -0.4],
  mg: [0.25, -0.24, -0.42],
  knife: [0.27, -0.21, -0.46],
  bomb: [0.14, -0.2, -0.4],
};
const VM_SCALE = 0.8;
const ADS_DISTANCE = -0.32; // как далеко от глаза оружие при прицеливании
// Коллиматор и оптику подносят ближе к глазу: окошко прицела крупнее, сквозь него видно цель.
const ADS_BY_SIGHT = { dot: -0.2, holo: -0.21, scope2: -0.2, scope: -0.26 };
// После выстрела эти виды оружия передёргивают затвор или помпу.
const CYCLE_AFTER_SHOT = { shotgun: 0.25, sniper: 0.45, heavy_sniper: 0.6 };
// Осмотр оружия: сколько секунд длится и как развернуть оружие к игроку.
const INSPECT_TIME = 3.6;
const INSPECT_KNIFE_TIME = 2.8;
const INSPECT_YAW = 1.25;
const INSPECT_ROLL = 2.75;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (from, to, x) => {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
};

export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.01, 10);
    // С отражениями неба оружие освещает и само окружение, поэтому лампа слабее.
    this.scene.add(new THREE.HemisphereLight(0xe6efff, 0x4b4538, PBR ? 1.1 : 2.1));
    const light = new THREE.DirectionalLight(0xfff0d8, PBR ? 2.2 : 1.6);
    light.position.set(-0.5, 1, 0.4);
    this.scene.add(light);
    // Подсветка сзади: на гранях металла появляются блики.
    const rim = new THREE.DirectionalLight(0xbfd8ff, PBR ? 1.2 : 0.4);
    rim.position.set(0.6, 0.4, -1);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.sleeve = mat({ color: 0x777777, roughness: 0.95 });
    this.arm = new THREE.Group();
    addBox(this.arm, [0.095, 0.095, 0.42], this.sleeve, [0.045, -0.13, 0.22], 0.28);
    addBox(this.arm, [0.08, 0.08, 0.1], GLOVES, [0.01, -0.07, 0], 0.28);
    this.root.add(this.arm);
    this.root.scale.setScalar(VM_SCALE);

    // Вторая рука на цевье: рукав показывает цвет своей команды.
    this.support = new THREE.Group();
    addBox(this.support, [0.085, 0.06, 0.13], GLOVES, [-0.005, -0.03, -0.4]);
    const sleeve = addBox(this.support, [0.1, 0.1, 0.5], this.sleeve, [-0.1, -0.15, -0.15], 0.35);
    sleeve.rotation.y = -0.5;
    this.root.add(this.support);

    this.flash = flashSprite();
    this.flash.visible = false;
    this.root.add(this.flash);

    this.kind = null;
    this.cat = 'rifle';
    this.weapon = null;
    this.mag = null;
    this.bolt = null;
    this.eye = 0.1;
    this.hand = -0.4;
    this.kick = 0;
    this.swap = 1;
    this.bob = 0;
    this.flashTime = 0;
    this.slash = 0;
    this.aim = 0;
    this.cycle = 0; // передёргивание затвора после выстрела
    this.cycleDelay = 0;
    this.twoHanded = true;
    this.length = 0.5;
    this.inspectT = null; // доля пройденного осмотра, null — осмотра нет
    this.inspectPhase = 0; // последняя доля: на ней оружие плавно возвращается в руки
    this.inspectWeight = 0;
  }

  setTeam(team) {
    // Рукава из той же камуфляжной ткани, что и форма команды.
    if (this.sleeveTeam === team) return;
    this.sleeveTeam = team;
    this.sleeve.map = uniformMaterial(team).cloth.map;
    this.sleeve.color.setHex(0xffffff);
    this.sleeve.needsUpdate = true;
  }

  setWeapon(kind, skin = null) {
    const key = `${kind}:${skin ? skin.id : ''}`;
    if (key === this.key) return;
    this.key = key;
    if (this.weapon) this.root.remove(this.weapon);
    this.weapon = buildWeapon(kind, skin);
    this.root.add(this.weapon);
    const data = this.weapon.userData;
    this.flash.position.copy(data.muzzle);
    this.mag = data.mag;
    this.bolt = data.bolt;
    this.eye = data.eye;
    this.hand = data.hand;
    this.cat = data.cat;
    this.adsZ = ADS_BY_SIGHT[data.sight] ?? ADS_DISTANCE;
    // Вторая рука держит цевьё у длинного оружия; у пистолета и ножа её не видно.
    this.twoHanded = this.cat !== 'pistol' && this.cat !== 'knife';
    this.support.visible = this.twoHanded;
    this.length = Math.abs(data.muzzle.z);
    if (kind !== this.kind) {
      this.swap = 0;
      this.inspectT = null;
      this.inspectWeight = 0;
    }
    this.kind = kind;
  }

  fire(kickAmount) {
    this.inspectT = null;
    if (this.kind === 'knife') {
      this.slash = 1;
      return;
    }
    // Прицелившись, оружие отдаёт меньше: держат крепче.
    this.kick = Math.min(1.2, this.kick + kickAmount * (1 - this.aim * 0.55));
    this.flashTime = 0.05;
    this.flash.visible = true;
    const size = { sniper: 0.5, shotgun: 0.46, mg: 0.4, pistol: 0.24 }[this.cat] ?? 0.32;
    this.flash.scale.set(size, size, 1);
    this.flash.material.rotation = Math.random() * 6.28;
    if (CYCLE_AFTER_SHOT[this.kind]) {
      this.cycleDelay = CYCLE_AFTER_SHOT[this.kind];
      this.cycle = 0;
    }
  }

  /** Начинает осмотр оружия, повторное нажатие его прекращает. Возвращает true, если осмотр начался. */
  inspect() {
    if (this.inspectT !== null) {
      this.inspectT = null;
      return false;
    }
    if (this.cat === 'bomb') return false;
    this.inspectT = 0;
    this.inspectPhase = 0;
    return true;
  }

  /** Осмотр: оружие поворачивается боком, затем показывает другую сторону. Нож крутится в руке. */
  applyInspect(dt) {
    const active = this.inspectT !== null;
    if (active) {
      this.inspectT += dt / (this.cat === 'knife' ? INSPECT_KNIFE_TIME : INSPECT_TIME);
      this.inspectPhase = Math.min(1, this.inspectT);
      if (this.inspectT >= 1) this.inspectT = null;
    }
    this.inspectWeight += ((active ? 1 : 0) - this.inspectWeight) * Math.min(1, dt * (active ? 6 : 10));
    if (this.inspectWeight < 0.002) this.inspectWeight = 0;
    const w = this.inspectWeight;
    this.support.visible = this.twoHanded && w < 0.4;
    if (w === 0) return;

    const p = this.inspectPhase;
    const twist = this.cat === 'knife'
      ? Math.PI * 4 * ease(0.3, 0.72, p)
      : INSPECT_ROLL * ease(0.4, 0.56, p) * (1 - ease(0.76, 0.9, p));
    const roll = Math.atan2(Math.sin(twist), Math.cos(twist));
    const yaw = INSPECT_YAW + Math.sin(p * Math.PI * 3) * 0.07;
    const pitch = Math.sin(p * Math.PI * 2) * 0.12;
    const blend = w * w * (3 - 2 * w);
    const { position, rotation } = this.root;
    position.x += (this.length * VM_SCALE * 0.46 - position.x) * blend;
    position.y += (-0.13 - position.y) * blend;
    position.z += (-(0.4 + this.length * 0.45) - position.z) * blend;
    rotation.x += (pitch - rotation.x) * blend;
    rotation.y += (yaw - rotation.y) * blend;
    rotation.z += (roll - rotation.z) * blend;
  }

  /** Рука уходит вниз и возвращается: так выглядит бросок гранаты. */
  dip() {
    this.inspectT = null;
    this.swap = 0.15;
  }

  /**
   * reload: доля пройденной перезарядки от 0 до 1 или null.
   * aim: 1, когда игрок прицеливается (оружие плавно встаёт в центр экрана).
   */
  update(dt, { speed, reload = null, hidden, crouch, aim = 0 }) {
    this.root.visible = !hidden;
    if (hidden || reload !== null || aim > 0) this.inspectT = null;
    if (hidden) return;
    const hip = VM_OFFSET[this.cat] || VM_OFFSET.rifle;
    this.aim += ((reload === null ? aim : 0) - this.aim) * Math.min(1, dt * 14);
    const a = this.aim;
    this.bob += speed * dt * 1.8;
    const sway = Math.min(speed / 5, 1) * (1 - a * 0.85);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.swap = Math.min(1, this.swap + dt * 4.5);
    this.slash = Math.max(0, this.slash - dt * 3.2);
    this.flashTime -= dt;
    if (this.flashTime <= 0) this.flash.visible = false;

    // Передёргивание затвора или помпы после выстрела
    let cycleOffset = 0;
    if (this.cycleDelay > 0) {
      this.cycleDelay -= dt;
      if (this.cycleDelay <= 0) this.cycle = 1;
    } else if (this.cycle > 0) {
      this.cycle = Math.max(0, this.cycle - dt * 3.2);
      cycleOffset = Math.sin((1 - this.cycle) * Math.PI);
    }

    // ---- Перезарядка по шагам ----
    let tilt = 0;
    let magY = 0;
    let magZ = 0;
    let magVisible = true;
    let boltZ = cycleOffset * 0.07;
    let handY = 0;
    let handZ = 0;
    if (reload !== null) {
      const p = reload;
      tilt = ease(0, 0.12, p) * (1 - ease(0.86, 1, p)); // наклоняем оружие к себе
      if (this.mag) {
        if (p < 0.34) {
          const t = ease(0.12, 0.34, p); // старый магазин выпадает вниз
          magY = -0.5 * t * t;
          magZ = 0.06 * t;
        } else if (p < 0.4) {
          magVisible = false;
        } else {
          const t = ease(0.4, 0.62, p); // рука приносит новый и вставляет
          magY = -0.3 * (1 - t);
          magZ = 0.04 * (1 - t);
        }
        // Рука уходит к магазину, вниз за новым и возвращается с ним.
        if (p > 0.12 && p < 0.7) {
          const reach = Math.sin(Math.PI * ease(0.12, 0.7, p));
          handY = Math.min(magY, 0) * 0.9 - 0.05 * reach;
          handZ = reach;
        }
      } else {
        // Дробовик и револьвер заряжаются по патрону: рука ритмично подаёт их.
        handY = -0.06 * Math.abs(Math.sin(p * Math.PI * 7)) * tilt;
      }
      if (this.bolt && p > 0.7 && p < 0.88) boltZ = 0.07 * Math.sin(Math.PI * ease(0.7, 0.88, p));
    }
    if (this.mag) {
      this.mag.position.set(0, magY, magZ);
      this.mag.visible = magVisible;
    }
    if (this.bolt) this.bolt.position.z = boltZ;
    // Обычно вторая рука лежит на цевье, а при перезарядке перемещается к магазину у рукояти.
    const magZone = -0.22;
    const restZ = this.hand + 0.4;
    this.support.position.set(0, handY, restZ + (magZone + 0.4 - restZ) * handZ);

    // ---- Положение: от бедра или в прицеле ----
    const ads = [0, -this.eye * VM_SCALE, this.adsZ ?? ADS_DISTANCE];
    const lowered = (1 - this.swap) * 0.35 + tilt * 0.08;
    this.root.position.set(
      hip[0] + (ads[0] - hip[0]) * a + Math.cos(this.bob) * 0.008 * sway,
      hip[1] + (ads[1] - hip[1]) * a - lowered + Math.abs(Math.sin(this.bob)) * 0.011 * sway + (crouch ? 0.012 * (1 - a) : 0),
      hip[2] + (ads[2] - hip[2]) * a + this.kick * 0.055 - Math.sin(this.slash * Math.PI) * 0.16,
    );
    this.root.rotation.x = this.kick * 0.11 * (1 - a * 0.5) + tilt * 0.35 - (1 - this.swap) * 0.6 + cycleOffset * 0.05;
    this.root.rotation.y = Math.sin(this.slash * Math.PI) * 0.8 + tilt * 0.25;
    this.root.rotation.z = -0.5 * tilt;
    this.applyInspect(dt);

    // В прицеле поле зрения оружия чуть уже, как при взгляде вдоль ствола.
    const fov = 58 - 12 * a;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// ---------- Гранаты, дым и бомба ----------
const GRENADE_COLORS = { he: 0x3f5b37, flash: 0xc2c8ce, smoke: 0x6d737a };

const SMOKE_PUFF = makeCanvas(128, 128, (ctx) => {
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(218,222,226,.95)');
  gradient.addColorStop(0.55, 'rgba(198,203,208,.75)');
  gradient.addColorStop(1, 'rgba(180,186,192,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
});

export class Battlefield {
  constructor(scene, smokeRadius) {
    this.scene = scene;
    this.smokeRadius = smokeRadius;
    this.grenades = new Map();
    this.smokes = new Map();
    this.blasts = [];

    this.bomb = new THREE.Group();
    addBox(this.bomb, [0.42, 0.14, 0.3], mat({ color: 0x3b3f36, roughness: 0.6, metalness: 0.3 }), [0, 0.07, 0]);
    addBox(this.bomb, [0.2, 0.05, 0.14], GUN_DARK, [0.03, 0.165, 0]);
    this.bombLight = addBox(this.bomb, [0.05, 0.04, 0.05], new THREE.MeshBasicMaterial({ color: 0xff2415 }), [-0.13, 0.16, 0]);
    this.bomb.visible = false;
    scene.add(this.bomb);
  }

  /** Гранаты в полёте: позиции приходят с сервера 20 раз в секунду. */
  syncGrenades(list) {
    const seen = new Set();
    for (const [id, kind, x, y, z] of list) {
      seen.add(id);
      let mesh = this.grenades.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.17, 0.11),
          mat({ color: GRENADE_COLORS[kind] ?? 0x555555, roughness: 0.5, metalness: 0.4 }),
        );
        mesh.position.set(x, y, z);
        mesh.userData.target = new THREE.Vector3(x, y, z);
        this.scene.add(mesh);
        this.grenades.set(id, mesh);
      }
      mesh.userData.target.set(x, y, z);
    }
    for (const [id, mesh] of this.grenades) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.grenades.delete(id);
      }
    }
  }

  syncSmokes(list) {
    const seen = new Set();
    for (const [id, x, y, z, left] of list) {
      seen.add(id);
      let cloud = this.smokes.get(id);
      if (!cloud) {
        cloud = this._createCloud(x, y, z);
        this.smokes.set(id, cloud);
      }
      cloud.userData.left = left;
    }
    for (const [id, cloud] of this.smokes) {
      if (!seen.has(id)) {
        this.scene.remove(cloud);
        cloud.children.forEach((puff) => puff.material.dispose());
        this.smokes.delete(id);
      }
    }
  }

  _createCloud(x, y, z) {
    const cloud = new THREE.Group();
    cloud.position.set(x, Math.max(y, 0), z);
    cloud.userData.age = 0;
    const radius = this.smokeRadius;
    for (let i = 0; i < 16; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKE_PUFF, transparent: true, depthWrite: false, opacity: 0 }));
      const angle = (i / 16) * Math.PI * 2 * 3;
      const reach = radius * (i % 3 === 0 ? 0.25 : i % 3 === 1 ? 0.55 : 0.8);
      puff.position.set(Math.cos(angle) * reach, 0.8 + (i % 4) * 0.9, Math.sin(angle) * reach);
      puff.userData.size = radius * (1 + (i % 3) * 0.2);
      puff.scale.setScalar(0.5);
      cloud.add(puff);
    }
    this.scene.add(cloud);
    return cloud;
  }

  /** Вспышка взрыва: size в метрах. */
  blast(x, y, z, size, color = 0xffffff) {
    const sprite = flashSprite();
    sprite.material.depthTest = true;
    sprite.material.color.setHex(color);
    sprite.position.set(x, y + 0.4, z);
    sprite.scale.setScalar(size * 0.3);
    sprite.userData = { life: 0.4, total: 0.4, size };
    this.scene.add(sprite);
    this.blasts.push(sprite);
  }

  /** Находится ли точка внутри облака дыма: тогда весь экран затягивает серым. */
  insideSmoke(x, y, z) {
    for (const cloud of this.smokes.values()) {
      const dx = x - cloud.position.x;
      const dy = y - cloud.position.y - 1.2;
      const dz = z - cloud.position.z;
      if (Math.hypot(dx, dy, dz) < this.smokeRadius * 0.9) return true;
    }
    return false;
  }

  setBomb(state, dt, nowMs) {
    if (!state || state[0] === 0) {
      this.bomb.visible = false;
      return;
    }
    this.bomb.visible = true;
    this.bomb.position.set(state[1], state[2], state[3]);
    // Заложенная бомба мигает, лежащая на земле просто видна.
    this.bombLight.visible = state[0] !== 2 || Math.floor(nowMs / 300) % 2 === 0;
  }

  update(dt) {
    for (const mesh of this.grenades.values()) {
      mesh.position.lerp(mesh.userData.target, Math.min(1, dt * 18));
      mesh.rotation.x += dt * 9;
      mesh.rotation.z += dt * 6;
    }
    for (const cloud of this.smokes.values()) {
      cloud.userData.age += dt;
      const appear = Math.min(1, cloud.userData.age / 1.1);
      const fade = Math.min(1, (cloud.userData.left ?? 16) / 2);
      for (const puff of cloud.children) {
        puff.scale.setScalar(puff.userData.size * (0.3 + 0.7 * appear) * 1.5);
        puff.material.opacity = 0.92 * appear * fade;
      }
    }
    this.blasts = this.blasts.filter((sprite) => {
      sprite.userData.life -= dt;
      if (sprite.userData.life <= 0) {
        this.scene.remove(sprite);
        sprite.material.dispose();
        return false;
      }
      const progress = 1 - sprite.userData.life / sprite.userData.total;
      sprite.scale.setScalar(sprite.userData.size * (0.3 + progress));
      sprite.material.opacity = 1 - progress;
      return true;
    });
  }
}

// ---------- Эффекты в мире ----------
export class Effects {
  constructor(scene) {
    this.tracers = [];
    this.sparks = [];
    this.flashes = [];
    const geometry = new THREE.BoxGeometry(0.022, 0.022, 1);
    geometry.translate(0, 0, 0.5); // lookAt направляет на цель ось +Z: след идёт от ствола к цели
    for (let i = 0; i < 26; i++) {
      const tracer = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      tracer.visible = false;
      tracer.userData.life = 0;
      scene.add(tracer);
      this.tracers.push(tracer);

      const spark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: FLASH, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      spark.visible = false;
      spark.userData.life = 0;
      scene.add(spark);
      this.sparks.push(spark);
    }
    for (let i = 0; i < 12; i++) {
      const flash = flashSprite();
      flash.material.depthTest = true;
      flash.visible = false;
      flash.userData.life = 0;
      scene.add(flash);
      this.flashes.push(flash);
    }
  }

  _free(pool) {
    return pool.find((item) => !item.visible) || pool.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
  }

  tracer(from, to) {
    const length = from.distanceTo(to);
    if (length < 0.5) return;
    const tracer = this._free(this.tracers);
    tracer.position.copy(from);
    tracer.lookAt(to);
    tracer.scale.set(1, 1, length);
    tracer.material.opacity = 0.75;
    tracer.userData.life = 0.07;
    tracer.visible = true;
  }

  spark(at, blood) {
    const spark = this._free(this.sparks);
    spark.position.copy(at);
    spark.material.color.setHex(blood ? 0xff2b1d : 0xffffff);
    spark.material.opacity = 1;
    spark.scale.setScalar(blood ? 0.45 : 0.3);
    spark.userData.life = 0.14;
    spark.visible = true;
  }

  flash(at) {
    const flash = this._free(this.flashes);
    flash.position.copy(at);
    flash.scale.setScalar(0.65);
    flash.material.rotation = Math.random() * 6.28;
    flash.userData.life = 0.05;
    flash.visible = true;
  }

  update(dt) {
    for (const pool of [this.tracers, this.sparks, this.flashes]) {
      for (const item of pool) {
        if (!item.visible) continue;
        item.userData.life -= dt;
        if (item.userData.life <= 0) item.visible = false;
        else if (pool !== this.flashes) item.material.opacity = Math.min(1, item.userData.life * 11);
      }
    }
  }
}
