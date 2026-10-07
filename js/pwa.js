/* ==========================================================================
   pwa.js — 注册 Service Worker + 「安装到主屏幕」入口
   · 只在 http(s) 下注册（file:// 打开时不注册，避免报错）
   · Android/Chrome 走 beforeinstallprompt；iOS Safari 不支持该事件，
     因此在页脚提示「分享 → 添加到主屏幕」
   ========================================================================== */

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA() {
  registerWorker();
  initInstallButton();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;       // file:// 下不注册

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href)
      .then((registration) => {
        // 有更新时静默激活，下一次访问即生效
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage('skip-waiting');
            }
          });
        });
      })
      .catch((error) => console.warn('[pwa] Service Worker 注册失败：', error));
  });
}

function initInstallButton() {
  const button = document.querySelector('[data-install-app]');
  const hint = document.querySelector('[data-install-hint]');
  if (!button) return;

  if (isStandalone()) return;                             // 已经装过了，不显示入口

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
    if (hint) hint.hidden = true;
  });

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch { /* 忽略 */ }
      deferredPrompt = null;
      button.hidden = true;
      return;
    }
    // 没有原生安装提示（典型情况：iOS Safari）→ 给出操作说明
    if (hint) {
      hint.hidden = false;
      setTimeout(() => { hint.hidden = true; }, 8000);
    }
  });

  // iOS 用户没被 beforeinstallprompt 覆盖，直接常显入口
  if (isIOS()) button.hidden = false;
}

/* 三个页面都以 <script type="module" src="js/pwa.js"> 引入，这里直接启动 */
initPWA();
