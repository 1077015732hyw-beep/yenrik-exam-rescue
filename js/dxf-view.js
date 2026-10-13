/* ==========================================================================
   dxf-view.js — 自己实现的轻量 DXF（AutoCAD 图纸交换格式）二维预览
   目标：工程制图的常见图纸能在浏览器里直接看，不引入任何第三方库。
   支持实体：LINE / CIRCLE / ARC / LWPOLYLINE（含 bulge 圆弧）/ POLYLINE+VERTEX /
             TEXT / MTEXT / POINT / SOLID / 3DFACE / ELLIPSE / INSERT（块引用，
             含嵌套与缩放旋转）/ DIMENSION（按它引用的匿名块绘制）
   支持：图层与 ACI 颜色、适应窗口、滚轮与双指缩放、拖拽平移。
   不支持：HATCH 填充、SPLINE（会跳过并在状态栏说明）。
   ========================================================================== */

const ACI = {
  1: '#d81e17', 2: '#d8c400', 3: '#1fa11f', 4: '#12b5b5', 5: '#1f3fd8',
  6: '#c81fc8', 7: '#17161a', 8: '#6f6b64', 9: '#c9c4ba',
  250: '#3a3a3a', 251: '#5a5a5a', 252: '#7a7a7a', 253: '#9a9a9a', 254: '#bababa', 255: '#dadada',
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** DXF 是「组码 / 值」成对出现的文本；先拍平成 [code, value] 数组 */
function pairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push([code, lines[i + 1]]);
  }
  return out;
}

function splitSections(list) {
  const sections = {};
  let current = null;
  let pending = false;
  for (const [code, raw] of list) {
    const value = raw.trim();
    if (code === 0 && value.toUpperCase() === 'SECTION') { pending = true; continue; }
    if (pending && code === 2) { current = value.toUpperCase(); sections[current] = []; pending = false; continue; }
    if (code === 0 && value.toUpperCase() === 'ENDSEC') { current = null; continue; }
    if (current) sections[current].push([code, value]);
  }
  return sections;
}

/** 逐个实体解析：遇到 (0, TYPE) 开始一条新实体 */
function parseEntities(list, stopAtEndblk = false) {
  const entities = [];
  let entity = null;
  let polyline = null;

  const flush = () => {
    if (!entity) return;
    const type = entity.type;
    if (type === 'VERTEX') {
      if (polyline) polyline.verts.push([entity.x, entity.y]);
    } else if (type === 'POLYLINE') {
      polyline = entity;
      entity.verts = entity.verts || [];
    } else {
      entities.push(entity);
      polyline = null;
    }
    entity = null;
  };

  for (const [code, value] of list) {
    if (code === 0) {
      const type = value.toUpperCase();
      if (type === 'ENDBLK') { flush(); break; }
      if (type === 'SEQEND') { flush(); polyline = null; continue; }
      flush();
      entity = {
        type, layer: '0', color: null, name: '', text: '',
        x: 0, y: 0, x2: 0, y2: 0, x3: 0, y3: 0, x4: 0, y4: 0,
        r: 0, a0: 0, a1: 0, verts: [], bulges: [], closed: false, flags: 0,
        h: 0, rot: 0, sx: 1, sy: 1, ratio: 1, pendingX: 0, hasX: false,
      };
      if (polyline && type === 'VERTEX') entity.parent = polyline;
      continue;
    }
    if (!entity) continue;
    switch (code) {
      case 8: entity.layer = value; break;
      case 62: entity.color = parseInt(value, 10); break;
      case 6: entity.ltype = value; break;
      case 2: entity.name = value; break;
      case 1: entity.text += value; break;
      case 3: entity.text += value; break;
      case 10:
        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE' || entity.type === 'VERTEX') {
          entity.pendingX = num(value); entity.hasX = true;
        } else { entity.x = num(value); }
        break;
      case 20:
        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE' || entity.type === 'VERTEX') {
          if (entity.type !== 'VERTEX') {
            entity.verts.push([entity.pendingX, num(value)]);
            entity.bulges.push(0);
            entity.hasX = false;
          }
          entity.y = num(value);
        } else { entity.y = num(value); }
        break;
      case 11: entity.x2 = num(value); break;
      case 21: entity.y2 = num(value); break;
      case 12: entity.x3 = num(value); break;
      case 22: entity.y3 = num(value); break;
      case 13: entity.x4 = num(value); break;
      case 23: entity.y4 = num(value); break;
      case 40:
        if (entity.type === 'CIRCLE' || entity.type === 'ARC') entity.r = num(value);
        else if (entity.type === 'ELLIPSE') entity.ratio = num(value) || 1;   // 短轴/长轴
        else entity.h = num(value);                                            // TEXT/MTEXT 字高
        break;
      case 41:
        if (entity.type === 'INSERT') entity.sx = num(value) || 1;
        else if (entity.type === 'ELLIPSE') entity.a0 = num(value);            // 起始参数
        break;
      case 42:
        if (entity.type === 'LWPOLYLINE') {
          if (entity.bulges.length) entity.bulges[entity.bulges.length - 1] = num(value);
        } else if (entity.type === 'INSERT') entity.sy = num(value) || 1;
        else if (entity.type === 'ELLIPSE') entity.a1 = num(value);             // 终止参数
        break;
      case 43: entity.sx = num(value) || entity.sx; entity.sy = entity.sx; break;
      case 50:
        if (entity.type === 'ARC') entity.a0 = num(value) * Math.PI / 180;
        else entity.rot = num(value) * Math.PI / 180;
        break;
      case 51: entity.a1 = num(value) * Math.PI / 180; break;
      case 70: entity.flags = parseInt(value, 10) || 0; break;
      default: break;
    }
    if (entity.type === 'LWPOLYLINE' && code === 70) entity.closed = (entity.flags & 1) === 1;
    if (entity.type === 'POLYLINE' && code === 70) entity.closed = (entity.flags & 1) === 1;
  }
  flush();
  return entities;
}

/** 解析图层颜色（TABLES 段里的 LAYER 表） */
function parseLayers(list) {
  const layers = {};
  let name = null;
  for (let i = 0; i < list.length; i++) {
    const [code, value] = list[i];
    if (code === 0) {
      if (value.toUpperCase() === 'LAYER') {
        name = null;
        // 向后读该 LAYER 记录的 2/62
        for (let j = i + 1; j < list.length && list[j][0] !== 0; j++) {
          if (list[j][0] === 2) name = list[j][1];
          if (list[j][0] === 62 && name) layers[name] = parseInt(list[j][1], 10);
        }
      }
    }
  }
  return layers;
}

/* ---------------- 矩阵（a b c d e f，与 canvas 一致） ---------------- */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 把 INSERT 展开成具体图元（递归，深度上限 6 层） */
function expand(entities, blocks, layers, out, matrix = [1, 0, 0, 1, 0, 0], depth = 0) {
  for (const e of entities) {
    const color = e.color && e.color > 0 && e.color < 256 ? ACI[e.color] : (layers[e.layer] ? ACI[layers[e.layer]] : null);
    switch (e.type) {
      case 'LINE':
        out.push({ kind: 'poly', pts: [apply(matrix, e.x, e.y), apply(matrix, e.x2, e.y2)], color });
        break;
      case 'CIRCLE': {
        const [cx, cy] = apply(matrix, e.x, e.y);
        const scale = Math.hypot(matrix[0], matrix[1]) || 1;
        out.push({ kind: 'circle', cx, cy, r: e.r * scale, color });
        break;
      }
      case 'ARC': {
        const [cx, cy] = apply(matrix, e.x, e.y);
        const scale = Math.hypot(matrix[0], matrix[1]) || 1;
        out.push({ kind: 'arc', cx, cy, r: e.r * scale, a0: e.a0, a1: e.a1, color });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = [];
        const verts = e.verts || [];
        for (let i = 0; i < verts.length; i++) {
          const [x, y] = apply(matrix, verts[i][0], verts[i][1]);
          pts.push([x, y]);
          const bulge = (e.bulges && e.bulges[i]) || 0;
          const next = verts[i + 1] || (e.closed ? verts[0] : null);
          if (bulge && next && Math.abs(bulge) > 1e-6) {
            // bulge → 圆弧，用折线近似
            const sx = verts[i][0]; const sy = verts[i][1];
            const ex = next[0]; const ey = next[1];
            const theta = 4 * Math.atan(bulge);
            const dx = ex - sx; const dy = ey - sy;
            const chord = Math.hypot(dx, dy) || 1e-9;
            const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
            const midx = (sx + ex) / 2; const midy = (sy + ey) / 2;
            const h = Math.sqrt(Math.max(0, radius * radius - (chord / 2) ** 2));
            const nx = -dy / chord; const ny = dx / chord;
            const sign = theta > 0 ? 1 : -1;
            const cx0 = midx - nx * h * sign;
            const cy0 = midy - ny * h * sign;
            const start = Math.atan2(sy - cy0, sx - cx0);
            const sweep = theta;
            const steps = Math.min(48, Math.max(6, Math.round(Math.abs(sweep) * 12)));
            for (let s = 1; s <= steps; s++) {
              const ang = start + sweep * (s / steps);
              pts.push(apply(matrix, cx0 + Math.cos(ang) * radius, cy0 + Math.sin(ang) * radius));
            }
          }
        }
        if (e.closed && pts.length) pts.push(pts[0]);
        if (pts.length > 1) out.push({ kind: 'poly', pts, color });
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const [x, y] = apply(matrix, e.x, e.y);
        const size = (e.h || 2.5) * (Math.hypot(matrix[0], matrix[1]) || 1);
        const clean = e.text.replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
        if (clean) out.push({ kind: 'text', x, y, size, rot: e.rot, text: clean, color: color || '#17161a' });
        break;
      }
      case 'POINT': {
        const [x, y] = apply(matrix, e.x, e.y);
        out.push({ kind: 'point', x, y, color });
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const pts = [[e.x, e.y], [e.x2, e.y2], [e.x4, e.y4], [e.x3, e.y3]].map(([px, py]) => apply(matrix, px, py));
        out.push({ kind: 'poly', pts: [...pts, pts[0]], color });
        break;
      }
      case 'ELLIPSE': {
        const [cx, cy] = apply(matrix, e.x, e.y);
        const mscale = Math.hypot(matrix[0], matrix[1]) || 1;
        // 组码 11/21 是「相对圆心」的长轴端点向量，不是绝对坐标
        const rx = Math.hypot(e.x2, e.y2) * mscale;
        const ry = rx * (e.ratio || 1);
        const rot = Math.atan2(e.y2, e.x2) + Math.atan2(matrix[1], matrix[0]);
        const a0 = Number.isFinite(e.a0) && e.a0 ? e.a0 : 0;
        const a1 = Number.isFinite(e.a1) && e.a1 ? e.a1 : Math.PI * 2;
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const t = a0 + (a1 - a0) * (i / 64);
          const px = cx + Math.cos(t) * rx * Math.cos(rot) - Math.sin(t) * ry * Math.sin(rot);
          const py = cy + Math.cos(t) * rx * Math.sin(rot) + Math.sin(t) * ry * Math.cos(rot);
          pts.push([px, py]);
        }
        out.push({ kind: 'poly', pts, color });
        break;
      }
      case 'INSERT':
      case 'DIMENSION': {
        const block = blocks[e.name];
        if (block && depth < 6) {
          const rot = e.rot || 0;
          const sx = (e.sx || 1) * Math.cos(rot);
          const sy = (e.sx || 1) * Math.sin(rot);
          const local = [sx, sy, -(e.sy || 1) * Math.sin(rot), (e.sy || 1) * Math.cos(rot), e.x, e.y];
          expand(block, blocks, layers, out, mul(matrix, local), depth + 1);
        }
        break;
      }
      default:
        break;   // SPLINE / HATCH 等暂不支持
    }
  }
}

/* ---------------- 视图 ---------------- */
export function createDxfView(canvas, { onStatus } = {}) {
  const ctx = canvas.getContext('2d');
  let prims = [];
  let bounds = null;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let dragging = null;
  let destroyed = false;
  const skipped = { count: 0 };

  const status = (text) => { if (onStatus) onStatus(text); };

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 用画布自身的 CSS 尺寸（铺满舞台），这样绘制中心与视觉中心一致
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    const height = canvas.clientHeight || canvas.parentElement.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
  }

  function computeBounds() {
    if (!prims.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const grow = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const p of prims) {
      if (p.kind === 'poly') p.pts.forEach(([x, y]) => grow(x, y));
      else if (p.kind === 'circle' || p.kind === 'arc') {
        grow(p.cx - p.r, p.cy - p.r); grow(p.cx + p.r, p.cy + p.r);
      } else if (p.kind === 'point') grow(p.x, p.y);
      else if (p.kind === 'text') { grow(p.x, p.y); grow(p.x + p.text.length * p.size * 0.6, p.y + p.size); }
    }
    if (!Number.isFinite(minX)) return null;
    if (maxX - minX < 1e-6) { maxX += 1; minX -= 1; }
    if (maxY - minY < 1e-6) { maxY += 1; minY -= 1; }
    return { minX, minY, maxX, maxY };
  }

  function fit() {
    if (!bounds) return;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    scale = Math.min(w / bw, h / bh) * 0.9;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    tx = w / 2 - cx * scale;
    ty = h / 2 + cy * scale;
    draw();
  }

  function draw() {
    if (destroyed) return;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fffefa';
    ctx.fillRect(0, 0, w, h);

    // Y 轴向上（CAD 习惯），所以纵向取负
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * tx, dpr * ty);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1 / scale;

    let ink = null;
    ctx.beginPath();
    for (const p of prims) {
      const color = p.color || '#17161a';
      if (color !== ink) {
        if (ink) { ctx.strokeStyle = ink; ctx.stroke(); }
        ctx.beginPath();
        ink = color;
      }
      if (p.kind === 'poly') {
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      } else if (p.kind === 'circle') {
        ctx.moveTo(p.cx + p.r, p.cy);
        ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      } else if (p.kind === 'arc') {
        ctx.moveTo(p.cx + Math.cos(p.a0) * p.r, p.cy + Math.sin(p.a0) * p.r);
        ctx.arc(p.cx, p.cy, p.r, p.a0, p.a1);
      } else if (p.kind === 'point') {
        const d = 3 / scale;
        ctx.moveTo(p.x - d, p.y); ctx.lineTo(p.x + d, p.y);
        ctx.moveTo(p.x, p.y - d); ctx.lineTo(p.x, p.y + d);
      }
    }
    if (ink) { ctx.strokeStyle = ink; ctx.stroke(); }

    // 文字在屏幕坐标系里画，避免被纵向翻转镜像
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of prims) {
      if (p.kind !== 'text') continue;
      const sx = p.x * scale + tx;
      const sy = -p.y * scale + ty;
      const px = p.size * scale;
      if (px < 4) continue;                       // 太小就不画，避免糊成一片
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-(p.rot || 0));
      ctx.fillStyle = p.color || '#17161a';
      ctx.font = `${px}px "PingFang SC", "Songti SC", system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function zoomBy(factor, cx, cy) {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    const next = Math.min(400, Math.max(0.02, scale * factor));
    const k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    draw();
    report();
  }

  function report() {
    if (bounds) status(`比例 ${(scale * 100).toFixed(0)}%`);
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
  }

  function onPointerDown(event) {
    canvas.setPointerCapture?.(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, tx, ty };
    canvas.style.cursor = 'grabbing';
  }
  function onPointerMove(event) {
    if (!dragging) return;
    tx = dragging.tx + (event.clientX - dragging.x);
    ty = dragging.ty + (event.clientY - dragging.y);
    draw();
  }
  function onPointerUp() {
    dragging = null;
    canvas.style.cursor = 'grab';
  }

  return {
    async load(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const sections = splitSections(pairs(text));
      const blocks = {};
      const blockList = sections.BLOCKS || [];
      let i = 0;
      while (i < blockList.length) {
        if (blockList[i][0] === 0 && blockList[i][1].toUpperCase() === 'BLOCK') {
          let name = '';
          const body = [];
          let j = i + 1;
          for (; j < blockList.length; j++) {
            const [code, value] = blockList[j];
            if (code === 0 && value.toUpperCase() === 'ENDBLK') break;
            if (code === 2 && !name) name = value;
            body.push([code, value]);
          }
          if (name) blocks[name] = parseEntities(body);
          i = j + 1;
        } else i++;
      }
      const layers = parseLayers(sections.TABLES || []);
      const entities = parseEntities(sections.ENTITIES || []);
      prims = [];
      expand(entities, blocks, layers, prims);
      skipped.count = entities.filter((e) => ['SPLINE', 'HATCH'].includes(e.type)).length;
      bounds = computeBounds();
      if (!prims.length) throw new Error('图纸里没有可以显示的图元');
      const names = Object.keys(layers).length;
      status(`${prims.length} 个图元 · ${names} 个图层${skipped.count ? ` · 跳过 ${skipped.count} 个暂不支持的实体` : ''}`);
      canvas.style.cursor = 'grab';
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      sizeCanvas();
      fit();
      return { primitives: prims.length, layers: names, skipped: skipped.count, bounds };
    },
    fit,
    zoomBy,
    resize() { sizeCanvas(); fit(); },
    destroy() {
      destroyed = true;
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
