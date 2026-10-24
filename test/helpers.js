'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function findChrome() {
  for (const candidate of CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      /* sıradaki adaya bak */
    }
  }
  throw new Error('Chrome bulunamadı. CHROME_PATH ortam değişkenini ayarlayın.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { findChrome, sleep };
