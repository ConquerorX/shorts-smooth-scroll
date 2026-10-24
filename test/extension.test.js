'use strict';

/**
 * Gerçek eklentiyi gerçek Chrome'a yükleyip youtube.com URL'i üzerinde çalıştırır.
 *
 * Not: Chrome 137+ `--load-extension` bayrağını kaldırdığı için eklenti CDP'nin
 * `Extensions.loadUnpacked` komutuyla yükleniyor. Bu, Chrome'un manifesti
 * gerçekten parse edip eklentiyi etkinleştirdiğini de doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { findChrome, sleep } = require('./helpers.js');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '1.1.2';

let browser;
let extensionId;
let target;

test.before(async () => {
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    userDataDir: await fs.mkdtemp(path.join(os.tmpdir(), 'sss-profile-')),
    args: ['--no-sandbox', '--enable-unsafe-extension-debugging']
  });

  const session = await browser.target().createCDPSession();
  const loaded = await session.send('Extensions.loadUnpacked', { path: ROOT });
  extensionId = loaded.id;
  assert.ok(extensionId, 'Chrome eklenti kimliği döndürmedi');

  // Fixture'ı youtube.com adresinden servis et. Snap'i kapatıyoruz ki
  // ölçtüğümüz şey native tarayıcı davranışı değil, eklentinin kendisi olsun.
  const fixture = await fs.readFile(path.join(ROOT, 'test/fixture.html'), 'utf8');
  target = fixture
    .replace('scroll-snap-type: y mandatory', 'scroll-snap-type: none')
    .replace(/<script src="\.\.\/src\/[^"]+"><\/script>/g, '');
  assert.ok(!target.includes('src/core.js'), 'fixture kendi scriptlerini yüklememeli');
});

test.after(async () => {
  if (browser) await browser.close();
});

async function openYoutubeShorts() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://www.youtube.com/shorts/fixture')) {
      request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: target });
      return;
    }
    request.abort();
  });
  await page.goto('https://www.youtube.com/shorts/fixture', { waitUntil: 'load' });
  await page.waitForSelector('.reel-video-in-sequence-new');
  return page;
}

test('eklenti youtube.com üzerinde wheel jestini devralır', async () => {
  const page = await openYoutubeShorts();
  try {
    await page.mouse.move(500, 400);
    await page.mouse.wheel({ deltaY: 120 });
    await sleep(900);

    const scrollTop = await page.$eval('#shorts-container', (el) => el.scrollTop);
    // Snap kapalı: native kaydırma olsaydı ~120px'te kalırdı.
    assert.equal(scrollTop, 800, `beklenen tam olarak 2. video (800px), gerçek ${scrollTop}px`);
  } finally {
    await page.close();
  }
});

test('anında mod gerçek eklenti üzerinden animasyonsuz atlıyor', async () => {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`, { waitUntil: 'load' });
  await popup.evaluate(() => new Promise((resolve) => chrome.storage.sync.set({ mode: 'jump' }, resolve)));
  await popup.close();

  const page = await openYoutubeShorts();
  try {
    // Content script ayarları asenkron okuyor.
    await sleep(300);
    await page.mouse.move(500, 400);
    await page.mouse.wheel({ deltaY: 120 });

    const immediate = await page.$eval('#shorts-container', (el) => el.scrollTop);
    assert.equal(immediate, 800, `anında atlamalıydı, gerçek ${immediate}px`);

    // Snap geri açıldıktan sonra da konum kaymamalı (milim düzeltme olmasın).
    await sleep(500);
    const settled = await page.$eval('#shorts-container', (el) => el.scrollTop);
    assert.equal(settled, 800, `konum kaydı: ${settled}px`);
  } finally {
    await page.close();
    const reset = await browser.newPage();
    await reset.goto(`chrome-extension://${extensionId}/src/popup.html`, { waitUntil: 'load' });
    await reset.evaluate(
      () => new Promise((resolve) => chrome.storage.sync.set({ mode: 'step', duration: 420 }, resolve))
    );
    await reset.close();
  }
});

test('popup çoklu dil, ayarlar ve manifest doğru çalışıyor', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`, { waitUntil: 'load' });
    await page.waitForSelector('#enabled');

    const info = await page.evaluate(() => {
      const manifest = chrome.runtime.getManifest();
      const text = (key) => document.querySelector(`[data-i18n="${key}"]`).textContent.trim();
      return {
        manifestName: manifest.name,
        manifestDescription: manifest.description,
        version: manifest.version,
        defaultLocale: manifest.default_locale,
        uiLanguage: chrome.i18n.getUILanguage(),
        htmlLang: document.documentElement.lang,
        modeLegend: text('modeLegend'),
        title: document.title
      };
    });

    assert.equal(info.version, VERSION);
    assert.equal(info.defaultLocale, 'en');
    assert.equal(info.manifestName, 'Shorts Smooth Scroll');
    assert.ok(!info.manifestDescription.includes('__MSG__'), 'manifest açıklaması çevrilmemiş');
    assert.ok(info.modeLegend.length > 0, 'popup metni boş');
    assert.equal(info.title, 'Shorts Smooth Scroll');

    // Arayüz, tarayıcının arayüz diline göre çevrilmeli.
    if (info.uiLanguage.startsWith('tr')) {
      assert.equal(info.modeLegend, 'Kaydırma modu');
      assert.equal(info.htmlLang, 'tr');
    } else {
      assert.equal(info.modeLegend, 'Scroll mode');
    }

    assert.equal(await page.$eval('#enabled', (el) => el.checked), true, 'varsayılan olarak etkin olmalı');

    await page.click('input[name="mode"][value="flow"]');
    await page.click('input[name="speed"][value="620"]');
    await sleep(250);

    const stored = await page.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.get({ mode: 'step', enabled: true, duration: 420 }, resolve)
        )
    );
    assert.equal(stored.mode, 'flow');
    assert.equal(stored.enabled, true);
    assert.equal(stored.duration, 620);
  } finally {
    await page.close();
  }
});
