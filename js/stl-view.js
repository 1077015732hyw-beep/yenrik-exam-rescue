/* ==========================================================================
   stl-view.js — 自己实现的轻量 STL 三维预览（软件光栅化，无第三方库）
   · 支持二进制 STL 与 ASCII STL
   · 正交投影 + 画家算法（按深度排序）+ 平面着色（把亮度量化成若干档后批量绘制，
     这样几百个面也能一次 fill 完，手机上依然跟手）
   · 拖拽旋转、滚轮缩放、线框切换、重置视角；首次进入轻微自转，用户一碰就停
   ========================================================================== */

const LIGHT = (() => {
  const v = [-0.35, -0.45, 0.82];
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
})();
const LEVELS = 18;      // 亮度分档数量：越大越细腻，越小越快

function parseBinary(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (84 + count * 50 > buffer.byteLength) return null;      // 长度对不上，说明不是二进制
  const tris = new Float32Array(count * 9);
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12;                                            // 跳过法线（自己算更可靠）
    for (let v = 0; v < 9; v++) {
      tris[i * 9 + v] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2;
  }
  return tris;
}

function parseAscii(text) {
  const values = [];
  const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
  let m;
  while ((m = re.exec(text))) {
    values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (values.length < 9) return null;
  return new Float32Array(values.slice(0, Math.floor(values.length / 9) * 9));
}

export function createStlView(canvas, { onStatus, prefersReducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let tris = null;          // Float32Array，每 9 个数一个三角形
  let order = null;         // 排序用索引
  let depth = null;
  let center = [0, 0, 0];
  let scale = 1;
  let rotX = -0.42;
  let rotY = 0.62;
  let zoom = 0.92;
  let wireframe = false;
  let dragging = null;
  let spinUntil = 0;
  let raf = 0;
  let destroyed = false;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cos = Math.cos; const sin = Math.sin;

  const status = (t) => { if (onStatus) onStatus(t); };

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 用画布自身的 CSS 尺寸（铺满舞台），这样绘制中心与视觉中心一致
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    const height = canvas.clientHeight || canvas.parentElement.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
  }

  function normalize() {
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      if (tris[i] < minX) minX = tris[i];
      if (tris[i] > maxX) maxX = tris[i];
      if (tris[i + 1] < minY) minY = tris[i + 1];
      if (tris[i + 1] > maxY) maxY = tris[i + 1];
      if (tris[i + 2] < minZ) minZ = tris[i + 2];
      if (tris[i + 2] > maxZ) maxZ = tris[i + 2];
    }
    center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    scale = 2 / span;
  }

  function draw() {
    if (destroyed || !tris) return;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fffefa';
    ctx.fillRect(0, 0, w, h);

    const n = tris.length / 9;
    const cx = cos(rotX); const sx = sin(rotX);
    const cy = cos(rotY); const sy = sin(rotY);
    const unit = (Math.min(w, h) / 2) * 0.82 * zoom;
    if (!order || order.length !== n) {
      order = new Uint32Array(n);
      depth = new Float32Array(n);
    }
    const px = new Float32Array(n * 6);
    const shade = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let v = 0; v < 3; v++) {
        const x = (tris[o + v * 3] - center[0]) * scale;
        const y = (tris[o + v * 3 + 1] - center[1]) * scale;
        const z = (tris[o + v * 3 + 2] - center[2]) * scale;
        // 先绕 Y 再绕 X
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y1 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        p[v] = [x1, y1, z2];
      }
      // 面法线（视图空间）
      const ux = p[1][0] - p[0][0]; const uy = p[1][1] - p[0][1]; const uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0]; const vy = p[2][1] - p[0][1]; const vz = p[2][2] - p[0][2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      let lambert = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      lambert = 0.28 + 0.72 * lambert;
      shade[i] = lambert;
      depth[i] = (p[0][2] + p[1][2] + p[2][2]) / 3;
      order[i] = i;
      for (let v = 0; v < 3; v++) {
        px[i * 6 + v * 2] = w / 2 + p[v][0] * unit;
        px[i * 6 + v * 2 + 1] = h / 2 - p[v][1] * unit;
      }
    }

    const sorted = Array.from(order).sort((a, b) => depth[a] - depth[b]);
    const buckets = new Map();
    for (const i of sorted) {
      const level = Math.min(LEVELS - 1, Math.max(0, Math.round(shade[i] * LEVELS) - 1));
      if (!buckets.has(level)) buckets.set(level, []);
      buckets.get(level).push(i);
    }

    if (wireframe) {
      ctx.strokeStyle = '#45423c';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const i of sorted) {
        ctx.moveTo(px[i * 6], px[i * 6 + 1]);
        ctx.lineTo(px[i * 6 + 2], px[i * 6 + 3]);
        ctx.lineTo(px[i * 6 + 4], px[i * 6 + 5]);
        ctx.closePath();
      }
      ctx.stroke();
    } else {
      for (const [level, list] of buckets) {
        const lightness = 34 + (level / (LEVELS - 1)) * 58;      // 34%–92%
        ctx.fillStyle = `hsl(38 14% ${lightness.toFixed(1)}%)`;
        ctx.beginPath();
        for (const i of list) {
          ctx.moveTo(px[i * 6], px[i * 6 + 1]);
          ctx.lineTo(px[i * 6 + 2], px[i * 6 + 3]);
          ctx.lineTo(px[i * 6 + 4], px[i * 6 + 5]);
          ctx.closePath();
        }
        ctx.fill();
      }
      // 极淡的三角面轮廓：给形体一点边线感，又不至于糊成一片网格
      ctx.strokeStyle = 'rgba(23, 22, 26, 0.07)';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (const i of sorted) {
        ctx.moveTo(px[i * 6], px[i * 6 + 1]);
        ctx.lineTo(px[i * 6 + 2], px[i * 6 + 3]);
        ctx.lineTo(px[i * 6 + 4], px[i * 6 + 5]);
        ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function frame() {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    if (now < spinUntil && !dragging) {
      rotY += 0.006;
      draw();
    }
    if (performance.now() < spinUntil && !dragging) raf = requestAnimationFrame(frame);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function onPointerDown(e) {
    dragging = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
    spinUntil = 0;
  }
  function onPointerMove(e) {
    if (!dragging) return;
    rotY += (e.clientX - dragging.x) * 0.01;
    rotX = Math.max(-1.5, Math.min(1.5, rotX + (e.clientY - dragging.y) * 0.01));
    dragging = { x: e.clientX, y: e.clientY };
    schedule();
  }
  function onPointerUp() {
    dragging = null;
    canvas.style.cursor = 'grab';
  }
  function onWheel(e) {
    e.preventDefault();
    zoom = Math.min(6, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    schedule();
  }

  return {
    async load(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      let parsed = parseBinary(buffer);
      if (!parsed) {
        const text = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 80 * 1024 * 1024)));
        parsed = parseAscii(text);
      }
      if (!parsed || parsed.length < 9) throw new Error('不是有效的 STL 文件');
      const count = parsed.length / 9;
      if (count > 400000) throw new Error(`模型面数过多（${count.toLocaleString()}），请先在建模软件里简化`);
      tris = parsed;
      normalize();
      sizeCanvas();
      status(`${count.toLocaleString()} 个三角面`);
      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      draw();
      if (!prefersReducedMotion && count <= 120000) {
        spinUntil = performance.now() + 2600;
        raf = requestAnimationFrame(frame);
      }
      return { triangles: count };
    },
    resetView() {
      rotX = -0.42; rotY = 0.62; zoom = 0.92;
      schedule();
    },
    zoomBy(factor) {
      zoom = Math.min(6, Math.max(0.25, zoom * factor));
      schedule();
    },
    setWireframe(on) {
      wireframe = Boolean(on);
      schedule();
    },
    getWireframe() { return wireframe; },
    resize() { sizeCanvas(); draw(); },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
