'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { findChrome, sleep } = require('./helpers.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

let server;
let browser;
let baseUrl;

before(async () => {
  server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': (MIME[path.extname(filePath)] || 'text/plain') + '; charset=utf-8' });
      res.end(body);
    } catch (err) {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars']
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openFixture(mode, duration) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto(`${baseUrl}/test/fixture.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__shortsSmoothScroll);
  await page.evaluate(
    (m, d) => window.__shortsSmoothScroll.configure({ mode: m, duration: d }),
    mode || 'step',
    duration || 200
  );
  return page;
}

/** Animasyon boyunca scrollTop'u her karede örnekler. */
async function startSampling(page) {
  await page.evaluate(() => {
    const container = document.querySelector('#shorts-container');
    window.__samples = [];
    window.__sampling = true;
    const tick = () => {
      window.__samples.push(container.scrollTop);
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(page) {
  return page.evaluate(() => {
    window.__sampling = false;
    return {
      samples: window.__samples.slice(),
      final: document.querySelector('#shorts-container').scrollTop
    };
  });
}

function maxStepOf(samples) {
  let max = 0;
  for (let i = 1; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] - samples[i - 1]));
  return max;
}

/** Tek adım atıp kare örneklerini döndürür; istenirse animasyon ortasında blokaj yaratır. */
async function stepSamples(page, options) {
  const opts = options || {};
  await page.evaluate(() => {
    document.querySelector('#shorts-container').scrollTop = 0;
  });
  await sleep(250);
  await page.evaluate((blockAfter) => {
    window.__blocked = false;
    if (!blockAfter) return;
    setTimeout(() => {
      const start = performance.now();
      while (performance.now() - start < 90) {
        /* main thread'i mesgul et */
      }
      window.__blocked = true;
    }, blockAfter);
  }, opts.blockAfter || 0);

  const point = await centerOf(page, '#shorts-container');
  await startSampling(page);
  await wheelAt(page, point.x, point.y, 120);
  await waitForRest(page);
  return stopSampling(page);
}

function assertSmooth(samples, totalDistance) {
  const moving = samples.filter((value, i) => i > 0 && Math.abs(value - samples[i - 1]) > 0.01);
  assert.ok(moving.length >= 8, `animasyon çok kısa: sadece ${moving.length} hareketli kare`);

  let maxStep = 0;
  let backwards = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i] - samples[i - 1];
    if (delta < -0.5) backwards += 1;
    maxStep = Math.max(maxStep, Math.abs(delta));
  }
  assert.equal(backwards, 0, 'animasyon geri sıçradı');
  assert.ok(
    maxStep <= totalDistance * 0.5,
    `tek karede sıçrama: ${maxStep.toFixed(1)}px (toplam ${totalDistance}px)`
  );
}

async function geometry(page) {
  return page.evaluate(() => {
    const container = document.querySelector('#shorts-container');
    const items = Array.from(document.querySelectorAll('.reel-video-in-sequence-new'));
    const top = container.getBoundingClientRect().top;
    return {
      scrollTop: container.scrollTop,
      offsets: items.map((el) => Math.round(el.getBoundingClientRect().top - top + container.scrollTop)),
      height: container.clientHeight
    };
  });
}

async function centerOf(page, selector) {
  return page.$eval(selector, (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function wheelAt(page, x, y, deltaY) {
  await page.mouse.move(x, y);
  await page.mouse.wheel({ deltaY });
}

async function waitForRest(page) {
  await sleep(50);
  await page.waitForFunction(() => window.__shortsSmoothScroll.state().animating === false, {
    timeout: 5000,
    polling: 25
  });
  await sleep(40);
}

function assertIndex(g, expected, label) {
  assert.ok(
    Math.abs(g.scrollTop - g.offsets[expected]) <= 1,
    `${label}: beklenen ${g.offsets[expected]}px, gerçek ${g.scrollTop}px`
  );
}

test('tek tekerlek tıkı tam olarak bir sonraki videoya oturur', async () => {
  const page = await openFixture('step');
  try {
    const point = await centerOf(page, '#shorts-container');
    await wheelAt(page, point.x, point.y, 120);
    await waitForRest(page);
    const g = await geometry(page);
    assertIndex(g, 1, 'tek tık');
  } finally {
    await page.close();
  }
});

test('üç parçaya bölünmüş tek tık iki video atlamaz', async () => {
  const page = await openFixture('step');
  try {
    const point = await centerOf(page, '#shorts-container');
    for (let i = 0; i < 3; i++) {
      await wheelAt(page, point.x, point.y, 33);
      await sleep(20);
    }
    await waitForRest(page);
    const g = await geometry(page);
    assertIndex(g, 1, 'bölünmüş tık');
  } finally {
    await page.close();
  }
});

test('sessizlikten sonraki tık bir adım daha ilerler', async () => {
  const page = await openFixture('step');
  try {
    const point = await centerOf(page, '#shorts-container');
    await wheelAt(page, point.x, point.y, 120);
    await waitForRest(page);
    await sleep(250);
    await wheelAt(page, point.x, point.y, 120);
    await waitForRest(page);
    const g = await geometry(page);
    assertIndex(g, 2, 'ikinci jest');
  } finally {
    await page.close();
  }
});

test('hızlı ardışık tıklar tek jest sayılır, atlama olmaz', async () => {
  const page = await openFixture('step');
  try {
    const point = await centerOf(page, '#shorts-container');
    for (let i = 0; i < 5; i++) {
      await wheelAt(page, point.x, point.y, 120);
      await sleep(60);
    }
    await waitForRest(page);
    const g = await geometry(page);
    assertIndex(g, 1, 'hızlı çevirme');
  } finally {
    await page.close();
  }
});

test('yorum paneli üzerindeki tekerlek feed\'i kaydırmaz', async () => {
  const page = await openFixture('step');
  try {
    const point = await centerOf(page, '#comments');
    await wheelAt(page, point.x, point.y, 200);
    await waitForRest(page);
    const state = await page.evaluate(() => ({
      feed: document.querySelector('#shorts-container').scrollTop,
      comments: document.querySelector('#comments').scrollTop
    }));
    assert.equal(state.feed, 0, 'feed kaymamalı');
    assert.ok(state.comments > 0, 'yorum paneli kaymalıydı');
  } finally {
    await page.close();
  }
});

test('akıcı mod jest bitince en yakın videoya hizalanır', async () => {
  const page = await openFixture('flow');
  try {
    const point = await centerOf(page, '#shorts-container');
    await wheelAt(page, point.x, point.y, 600);
    await sleep(1000);
    const g = await geometry(page);
    assertIndex(g, 1, 'akıcı mod');
  } finally {
    await page.close();
  }
});

test('animasyon sıçramadan, tek yönde ilerleyip tam sınıra oturuyor', async () => {
  const page = await openFixture('step', 420);
  try {
    const point = await centerOf(page, '#shorts-container');
    await startSampling(page);
    await wheelAt(page, point.x, point.y, 120);
    await waitForRest(page);
    const { samples, final } = await stopSampling(page);

    assert.equal(final, 800, `beklenen 800px, gerçek ${final}px`);
    assertSmooth(samples, 800);
  } finally {
    await page.close();
  }
});

test('main thread blokajı sıçramaya değil duraklamaya dönüşür', async () => {
  const page = await openFixture('step', 420);
  try {
    const control = await stepSamples(page, {});
    const blocked = await stepSamples(page, { blockAfter: 70 });

    assert.equal(control.final, 800);
    assert.equal(blocked.final, 800);
    assert.equal(await page.evaluate(() => window.__blocked), true, 'blokaj testi çalışmadı');

    const controlMax = maxStepOf(control.samples);
    const blockedMax = maxStepOf(blocked.samples);
    assert.ok(
      blockedMax <= controlMax * 1.15 + 2,
      `blokaj tek karede sıçrama yaptı: ${blockedMax.toFixed(0)}px (blokajsız en büyük adım ${controlMax.toFixed(0)}px)`
    );
  } finally {
    await page.close();
  }
});

test('animasyon sürerken yeni jest hedefi kaydırır, akış kesilmez', async () => {
  const page = await openFixture('step', 620);
  try {
    const point = await centerOf(page, '#shorts-container');
    await startSampling(page);
    await wheelAt(page, point.x, point.y, 120);

    // Jest arası 200ms > quietGap(150): bu gerçek bir yeni jest.
    await sleep(200);
    const midFlight = await page.$eval('#shorts-container', (el) => el.scrollTop);
    assert.ok(midFlight > 100 && midFlight < 790, `animasyon ortasında olmalıydı, konum ${midFlight}px`);

    await wheelAt(page, point.x, point.y, 120);
    await waitForRest(page);
    const { samples, final } = await stopSampling(page);

    assert.equal(final, 1600, `beklenen 1600px (2. video), gerçek ${final}px`);
    assertSmooth(samples, 1600);
  } finally {
    await page.close();
  }
});
