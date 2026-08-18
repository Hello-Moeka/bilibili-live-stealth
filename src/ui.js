'use strict';

function installUi(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (!doc || !doc.body) {
    // body 还没就绪,等 DOMContentLoaded
    doc.addEventListener('DOMContentLoaded', () => inject(win, cfg, getInterceptCount), { once: true });
    return;
  }
  inject(win, cfg, getInterceptCount);
}

function inject(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (doc.querySelector('#bls-panel')) return; // 防重复

  const panel = doc.createElement('div');
  panel.id = 'bls-panel';
  panel.setAttribute('style', [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'padding:8px 12px', 'background:rgba(30,30,35,0.9)', 'color:#fff',
    'border-radius:8px', 'font:12px/1.5 sans-serif', 'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    'cursor:default', 'user-select:none', 'border:1px solid rgba(255,255,255,0.15)'
  ].join(';') + ';');

  const status = doc.createElement('span');
  status.id = 'bls-status';
  status.textContent = cfg.getStealth() ? '隐身 [开]' : '隐身 [关]';
  status.style.cursor = 'pointer';
  status.style.marginRight = '8px';

  const toggle = doc.createElement('span');
  toggle.id = 'bls-toggle';
  toggle.textContent = '⚙';
  toggle.style.cursor = 'pointer';
  toggle.title = '点击切换隐身开关';

  const countLine = doc.createElement('div');
  countLine.id = 'bls-count';
  countLine.style.fontSize = '11px';
  countLine.style.opacity = '0.8';
  countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';

  // 点击状态或齿轮都切换
  function onToggle() {
    cfg.setStealth(!cfg.getStealth());
  }
  status.addEventListener('click', onToggle);
  toggle.addEventListener('click', onToggle);

  // 状态变化时刷新显示
  cfg.onChange((v) => {
    status.textContent = v ? '隐身 [开]' : '隐身 [关]';
  });

  // 周期刷新计数
  setInterval(() => {
    countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';
  }, 2000);

  panel.appendChild(status);
  panel.appendChild(toggle);
  panel.appendChild(countLine);
  doc.body.appendChild(panel);
}

module.exports = { installUi };