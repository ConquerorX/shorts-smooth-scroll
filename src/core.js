/**
 * Shorts Smooth Scroll - saf mantık katmanı (DOM yok, test edilebilir).
 *
 * Hem content script olarak <script> ile yüklenir (globalThis.ShortsSnapCore)
 * hem de Node testlerinde require() ile kullanılır.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.ShortsSnapCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /**
   * Tekerlek deltasını piksele çevirir.
   * deltaMode: 0 = pixel, 1 = line, 2 = page
   */
  function normalizeWheel(deltaY, deltaMode, viewportHeight) {
    if (typeof deltaY !== 'number' || !isFinite(deltaY)) return 0;
    if (deltaMode === 1) return deltaY * 16;
    if (deltaMode === 2) return deltaY * (viewportHeight || 0);
    return deltaY;
  }

  /** Verilen scroll konumuna en yakın öğe ofsetinin indeksi. */
  function nearestIndex(offsets, scrollTop) {
    if (!offsets || offsets.length === 0) return -1;
    var best = 0;
    var bestDistance = Infinity;
    for (var i = 0; i < offsets.length; i++) {
      var distance = Math.abs(offsets[i] - scrollTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /**
   * Jest makinesi: "tek jest = tek adım".
   *
   * Chromium tek bir tekerlek tıkını bazen tek event, bazen 3-4 küçük event
   * olarak gönderir. Bu yüzden "delta eşiği geçti mi" yerine jest bazlı
   * çalışıyoruz: jest ilk event'te başlar, sessizlik `quietGap`'i geçince
   * biter ve bir jestte EN FAZLA bir adım atılır. Jest kesintisiz devam
   * ederse (hızlı çevirme) `repeatAfter` ms'de bir yeni adım hakkı doğar.
   *
   * feed(delta, now) -> -1 | 0 | 1
   */
  function createGesture(opts) {
    opts = opts || {};
    var threshold = Math.max(1, opts.threshold || 30);
    var quietGap = Math.max(16, opts.quietGap || 150);
    var repeatAfter = Math.max(quietGap, opts.repeatAfter || 420);

    var acc = 0;
    var lastTs = -Infinity;
    var stepAt = -Infinity;
    var tookStep = false;

    function begin(now) {
      acc = 0;
      tookStep = false;
      stepAt = -Infinity;
    }

    function feed(delta, now) {
      if (typeof delta !== 'number' || !isFinite(delta) || delta === 0) return 0;
      if (now - lastTs > quietGap) begin(now);
      lastTs = now;

      if (!tookStep) {
        if (acc !== 0 && Math.sign(delta) !== Math.sign(acc)) acc = 0;
        acc += delta;
        if (Math.abs(acc) >= threshold) {
          var dir = Math.sign(acc);
          acc = 0;
          tookStep = true;
          stepAt = now;
          return dir;
        }
        return 0;
      }

      // Aynı jest sürüyor: sadece periyodik tekrar hakkı.
      if (now - stepAt >= repeatAfter) {
        stepAt = now;
        return Math.sign(delta);
      }
      return 0;
    }

    function reset() {
      acc = 0;
      lastTs = -Infinity;
      stepAt = -Infinity;
      tookStep = false;
    }

    return {
      feed: feed,
      reset: reset,
      get accumulated() {
        return acc;
      }
    };
  }

  /**
   * Animasyon hızı: hedefe yaklaşma katsayısı (1/s).
   * Kullanıcıya "süre" olarak sunulur ama motor üstel yaklaşma kullanır;
   * süre büyüdükçe katsayı küçülür (daha yumuşak, daha uzun kuyruk).
   */
  function lambdaForDuration(ms) {
    var duration = typeof ms === 'number' && isFinite(ms) ? ms : 420;
    return 4560 / clamp(duration, 60, 2000);
  }

  /**
   * Kare hızından bağımsız yumuşatma katsayısı: x += (hedef - x) * factor.
   * dt büyükse (kare atlandıysa) 1'e yaklaşır, animasyon "geri kalmaz".
   */
  function smoothFactor(lambda, dt) {
    if (!(dt > 0)) return 0;
    return 1 - Math.exp(-Math.max(0, lambda) * dt);
  }

  return {
    clamp: clamp,
    normalizeWheel: normalizeWheel,
    nearestIndex: nearestIndex,
    createGesture: createGesture,
    lambdaForDuration: lambdaForDuration,
    smoothFactor: smoothFactor
  };
});
