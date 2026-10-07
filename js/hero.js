/* ==========================================================================
   hero.js — 首页 Hero 的轻微视差
   只更新两个 CSS 变量（--px / --py），交给 CSS 用 transform 合成，
   不读取布局属性，不产生额外绘制；移动端与降低动效时完全关闭。
   ========================================================================== */

import { $, prefersReducedMotion, isSmallScreen } from './util.js';

export function initHero() {
  const hero = $('.hero');
  if (!hero) return;

  // 入场：让悬浮物从静止状态淡入，避免首屏突然出现
  requestAnimationFrame(() => hero.classList.add('is-ready'));

  const stage = $('[data-stage]', hero);
  if (!stage) return;

  const motionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sizeMQ = window.matchMedia('(max-width: 860px)');

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let raf = 0;
  let visible = true;
  let enabled = !motionMQ.matches && !sizeMQ.matches;

  const write = () => {
    stage.style.setProperty('--px', current.x.toFixed(4));
    stage.style.setProperty('--py', current.y.toFixed(4));
  };

  const tick = () => {
    raf = 0;
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    current.x += dx * 0.075;
    current.y += dy * 0.075;
    write();
    if (Math.abs(dx) > 0.0015 || Math.abs(dy) > 0.0015) {
      raf = requestAnimationFrame(tick);
    } else {
      current.x = target.x;
      current.y = target.y;
      write();
    }
  };

  const schedule = () => {
    if (!raf && enabled && visible) raf = requestAnimationFrame(tick);
  };

  const onPointerMove = (event) => {
    if (!enabled) return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    schedule();
  };

  const reset = () => {
    target.x = 0;
    target.y = 0;
    schedule();
  };

  const applyMode = () => {
    enabled = !motionMQ.matches && !sizeMQ.matches;
    if (!enabled) {
      target.x = 0;
      target.y = 0;
      current.x = 0;
      current.y = 0;
      write();
    }
  };

  hero.addEventListener('pointermove', onPointerMove, { passive: true });
  hero.addEventListener('pointerleave', reset, { passive: true });
  window.addEventListener('blur', reset);
  motionMQ.addEventListener('change', applyMode);
  sizeMQ.addEventListener('change', applyMode);

  // Hero 离开视口时不做任何计算
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { threshold: 0 }).observe(hero);
  }

  applyMode();
}
