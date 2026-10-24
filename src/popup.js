'use strict';

const DEFAULTS = { enabled: true, mode: 'step', duration: 420 };

const enabledInput = document.getElementById('enabled');
const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const speedInputs = Array.from(document.querySelectorAll('input[name="speed"]'));

function localize() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const message = chrome.i18n.getMessage(el.dataset.i18n);
    if (message) el.textContent = message;
  }
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage.split('-')[0];
  document.title = chrome.i18n.getMessage('extName') || document.title;
}

function render(cfg) {
  enabledInput.checked = cfg.enabled !== false;
  for (const input of modeInputs) input.checked = input.value === cfg.mode;

  const duration = Number(cfg.duration) || DEFAULTS.duration;
  let closest = speedInputs[0];
  for (const input of speedInputs) {
    if (Math.abs(Number(input.value) - duration) < Math.abs(Number(closest.value) - duration)) closest = input;
  }
  if (closest) closest.checked = true;
}

localize();

chrome.storage.sync.get(DEFAULTS, (values) => {
  render(Object.assign({}, DEFAULTS, values || {}));
});

enabledInput.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (input.checked) chrome.storage.sync.set({ mode: input.value });
  });
}

for (const input of speedInputs) {
  input.addEventListener('change', () => {
    if (input.checked) chrome.storage.sync.set({ duration: Number(input.value) });
  });
}
