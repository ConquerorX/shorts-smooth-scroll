'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

function gesture(overrides) {
  return Core.createGesture(
    Object.assign({ threshold: 30, quietGap: 150, repeatAfter: 420 }, overrides || {})
  );
}

test('tek tekerlek tıkı tam olarak bir adım üretir', () => {
  const g = gesture();
  assert.equal(g.feed(120, 1000), 1);
  // Aynı jest devam ediyor: ikinci adım yok.
  assert.equal(g.feed(120, 1040), 0);
  assert.equal(g.feed(120, 1080), 0);
});

test('üç parçaya bölünmüş tek tık da tek adım üretir', () => {
  const g = gesture();
  let steps = 0;
  [1000, 1020, 1040].forEach((ts) => {
    if (g.feed(33, ts) !== 0) steps += 1;
  });
  assert.equal(steps, 1);
});

test('trackpad küçük deltalari eşiğe ulaşınca tek adım', () => {
  const g = gesture();
  // 8 + 16 + 24 = 48 px, 30 px eşiğini üçüncü event'te geçer.
  const results = [8, 16, 24, 32].map((delta, i) => g.feed(delta, 1000 + i * 12));
  assert.deepEqual(results, [0, 0, 1, 0]);
});

test('sessizlikten sonra yeni jest yeni adım hakkı verir', () => {
  const g = gesture();
  assert.equal(g.feed(120, 1000), 1);
  assert.equal(g.feed(120, 1100), 0); // 100ms ara: aynı jest, tekrar hakkı dolmadı
  assert.equal(g.feed(120, 1300), 1); // 200ms > quietGap: yeni jest
});

test('hızlı ve kesintisiz çevirmede adımlar repeatAfter ile sınırlı', () => {
  const g = gesture();
  let steps = 0;
  for (let ts = 0; ts <= 600; ts += 50) {
    if (g.feed(100, ts) !== 0) steps += 1;
  }
  // t=0'da bir adım, t=450'te tekrar hakkı -> toplam 2.
  assert.equal(steps, 2);
});

test('yön değişince biriken delta sıfırlanır', () => {
  const g = gesture();
  assert.equal(g.feed(-20, 1000), 0);
  assert.equal(g.feed(20, 1010), 0); // ters yön: birikim sıfırlandı, 20 < 30
  assert.equal(g.feed(20, 1020), 1);
});

test('reset birikimi ve jest durumunu temizler', () => {
  const g = gesture();
  assert.equal(g.feed(25, 1000), 0);
  assert.equal(g.accumulated, 25);
  g.reset();
  assert.equal(g.accumulated, 0);
  assert.equal(g.feed(25, 1010), 0);
});

test('normalizeWheel deltaMode birimlerini piksele çevirir', () => {
  assert.equal(Core.normalizeWheel(100, 0, 800), 100);
  assert.equal(Core.normalizeWheel(3, 1, 800), 48);
  assert.equal(Core.normalizeWheel(1, 2, 800), 800);
  assert.equal(Core.normalizeWheel(Number.NaN, 0, 800), 0);
});

test('nearestIndex en yakin ofseti bulur', () => {
  const offsets = [0, 800, 1600];
  assert.equal(Core.nearestIndex(offsets, 0), 0);
  assert.equal(Core.nearestIndex(offsets, 300), 0);
  assert.equal(Core.nearestIndex(offsets, 420), 1);
  assert.equal(Core.nearestIndex(offsets, 460), 1);
  assert.equal(Core.nearestIndex(offsets, 1600), 2);
  assert.equal(Core.nearestIndex([], 100), -1);
});

test('clamp sinirlari korur', () => {
  assert.equal(Core.clamp(-1, 0, 5), 0);
  assert.equal(Core.clamp(3, 0, 5), 3);
  assert.equal(Core.clamp(9, 0, 5), 5);
});

test('kısa süre daha büyük lambda (daha hızlı yaklaşma) verir', () => {
  const fast = Core.lambdaForDuration(240);
  const normal = Core.lambdaForDuration(420);
  const soft = Core.lambdaForDuration(620);
  assert.ok(fast > normal && normal > soft);
  assert.ok(Math.abs(normal - 10.86) < 0.05);
});

test('lambda uç değerlerde güvenli kalır', () => {
  assert.ok(Core.lambdaForDuration(0) <= 4560 / 60);
  assert.ok(Core.lambdaForDuration(100000) >= 4560 / 2000);
  assert.ok(isFinite(Core.lambdaForDuration(undefined)));
  assert.ok(Core.lambdaForDuration(undefined) > 0);
});

test('smoothFactor kare hızından bağımsız', () => {
  const lambda = 10.86;
  assert.equal(Core.smoothFactor(lambda, 0), 0);
  assert.equal(Core.smoothFactor(lambda, 10), 1);

  // 8ms'lik iki adım ≈ 16ms'lik tek adım (üstel yaklaşmanın özelliği)
  const twoSteps = 1 - Math.pow(1 - Core.smoothFactor(lambda, 0.008), 2);
  const oneStep = Core.smoothFactor(lambda, 0.016);
  assert.ok(Math.abs(twoSteps - oneStep) < 0.002);
});
