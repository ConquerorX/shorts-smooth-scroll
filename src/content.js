/* Shorts Smooth Scroll - content script
 *
 * Sorun: Shorts'ta kaydırma üç katmanın birbirine girmesi.
 *   1) Chromium tekerlek tıkını kendi yumuşak kaydırma animasyonuna çeviriyor,
 *   2) `scroll-snap-type: y mandatory` o animasyonun ortasında kendi snap
 *      animasyonunu başlatıp ilkini iptal ediyor,
 *   3) YouTube scroll event'inde aktif videoyu değiştirip yeni reel mount ediyor.
 * Sonuç: bazen hiç gitmiyor, bazen iki video atlıyor.
 *
 * Çözüm: wheel jestini capture fazında devralıp kendi easing'imizle tek jestte
 * tek videoya oturuyoruz. Animasyon sırasında scroll-snap ve scroll-behavior
 * geçici olarak kapatılıyor ki kimse animasyonumuza karışmasın.
 *
 * ÖNEMLİ: YouTube'un DOM'u sürümden sürüme değişiyor. Bu yüzden hiçbir öğe
 * sınıfına/tag'ine bağlı değiliz; kaydırma konteynerini ve "sayfa boyu"
 * öğelerini ölçerek buluyoruz.
 */
(function () {
  'use strict';

  if (globalThis.__shortsSmoothScrollLoaded) return;
  globalThis.__shortsSmoothScrollLoaded = true;

  var Core = globalThis.ShortsSnapCore;
  if (!Core) return;

  var HOST_SELECTOR = 'ytd-shorts';
  var SCROLLER_ID = '#shorts-container';
  var DEFAULTS = { enabled: true, mode: 'step', duration: 420 };
  var GESTURE_OPTS = { threshold: 30, quietGap: 150, repeatAfter: 420 };

  var cfg = { enabled: DEFAULTS.enabled, mode: DEFAULTS.mode, duration: DEFAULTS.duration };
  var state = { container: null, items: [] };
  var gesture = Core.createGesture(GESTURE_OPTS);

  // Animasyon durumu. Üstel yaklaşma kullanıyoruz: hedef değişince hız
  // sıfırlanmıyor, akış kesintisiz devam ediyor (jest zincirleme).
  var anim = { raf: 0, x: 0, target: 0, last: 0, container: null, done: null };
  var animating = false;
  var restore = null;
  var settleTimer = 0;

  /* ---------------------------------------------------------------- config */

  function applyConfig(values) {
    if (!values) return;
    if (typeof values.enabled === 'boolean') cfg.enabled = values.enabled;
    if (values.mode === 'step' || values.mode === 'flow') cfg.mode = values.mode;
    if (typeof values.duration === 'number' && isFinite(values.duration)) cfg.duration = values.duration;
  }

  function hasExtensionStorage() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.sync;
    } catch (err) {
      return false;
    }
  }

  if (hasExtensionStorage()) {
    try {
      chrome.storage.sync.get(DEFAULTS, function (values) {
        applyConfig(values);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync') return;
        var patch = {};
        for (var key in DEFAULTS) {
          if (Object.prototype.hasOwnProperty.call(changes, key)) patch[key] = changes[key].newValue;
        }
        applyConfig(patch);
      });
    } catch (err) {
      /* depolama yoksa varsayılanlarla devam */
    }
  }

  /* ------------------------------------------------------------ keşif (DOM) */

  function isScrollStyle(value) {
    return value === 'auto' || value === 'scroll' || value === 'overlay';
  }

  /**
   * Feed'in scroll konteyneri. Önce bilinen id'ye bakar; olmazsa ytd-shorts
   * içindeki en uzun kaydırılabilir alanı bulur. Sonuç önbelleklenir.
   */
  function findScroller() {
    var known = document.querySelector(SCROLLER_ID);
    if (known && known.scrollHeight - known.clientHeight > 4 && isScrollStyle(getComputedStyle(known).overflowY)) {
      return known;
    }

    var host = document.querySelector(HOST_SELECTOR);
    if (!host) return null;

    var best = null;
    var bestRange = 4;
    var nodes = host.querySelectorAll('div, section, main, ' + HOST_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var range = el.scrollHeight - el.clientHeight;
      if (range <= bestRange) continue;
      if (!isScrollStyle(getComputedStyle(el).overflowY)) continue;
      best = el;
      bestRange = range;
    }
    return best;
  }

  /**
   * Konteynerin çocukları arasından "sayfa boyu" öğeleri toplar.
   * Mevcut YouTube yapısı: #shorts-container > #shorts-inner-container > div...
   * (o yüzden tek sarmalayıcı katmanını da tarıyoruz). Sıfır yükseklikli
   * template/placeholder div'leri yükseklik filtresiyle eleniyor.
   */
  function findItems(container) {
    if (!container) return [];
    var minHeight = Math.max(40, container.clientHeight * 0.5);
    var best = [];

    function pageSized(parent) {
      var out = [];
      for (var i = 0; i < parent.children.length; i++) {
        var el = parent.children[i];
        if (el.getBoundingClientRect().height >= minHeight) out.push(el);
      }
      return out;
    }

    best = pageSized(container);
    if (best.length >= 2) return best;

    for (var i = 0; i < container.children.length; i++) {
      var nested = pageSized(container.children[i]);
      if (nested.length > best.length) best = nested;
    }
    return best;
  }

  function collect() {
    var container = findScroller();
    var items = container ? findItems(container) : [];
    state = { container: container, items: items };
    return state;
  }

  function ensure(force) {
    if (force || !state.container || !state.container.isConnected) return collect();
    return state;
  }

  function scrollOf(container) {
    return container ? container.scrollTop : window.scrollY || 0;
  }

  function setScrollY(container, y) {
    if (container) container.scrollTop = y;
    else window.scrollTo({ top: y, behavior: 'instant' });
  }

  function maxScrollOf(container) {
    if (container) return Math.max(0, container.scrollHeight - container.clientHeight);
    return Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
  }

  /** Her öğenin, scroll konteynerinin içerik koordinatındaki üst kenarı. */
  function offsetsOf(container, items) {
    var baseTop = 0;
    var baseScroll = 0;
    if (container) {
      baseTop = container.getBoundingClientRect().top;
      baseScroll = container.scrollTop;
    } else {
      baseScroll = window.scrollY || 0;
    }
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push(Math.round(items[i].getBoundingClientRect().top - baseTop + baseScroll));
    }
    return out;
  }

  /**
   * İmlecin altında, bizim konteynerimize kadar olan iç içe kaydırılabilir bir
   * alan (yorum paneli, açıklama vs.) varsa oraya karışmayız.
   */
  function nestedScrollerBlocks(target, container, dir) {
    var el = target;
    while (el && el !== container) {
      if (el.nodeType === 1) {
        var max = el.scrollHeight - el.clientHeight;
        if (max > 2 && isScrollStyle(getComputedStyle(el).overflowY)) {
          if (dir > 0 ? el.scrollTop < max - 1 : el.scrollTop > 1) return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  /* ------------------------------------------------------------- animasyon */

  function startAnimStyles(container) {
    applyRestore();
    if (container) {
      restore = {
        target: container,
        snap: container.style.scrollSnapType,
        behavior: container.style.scrollBehavior
      };
      container.style.scrollSnapType = 'none';
      container.style.scrollBehavior = 'auto';
    } else {
      var html = document.documentElement;
      restore = { target: html, snap: undefined, behavior: html.style.scrollBehavior };
      html.style.scrollBehavior = 'auto';
    }
  }

  function applyRestore() {
    if (!restore) return;
    var saved = restore;
    restore = null;
    if (saved.snap !== undefined) saved.target.style.scrollSnapType = saved.snap;
    saved.target.style.scrollBehavior = saved.behavior;
  }

  /**
   * Hedefe doğru yumuşak kaydırma başlatır. Animasyon sürerken tekrar
   * çağrılırsa sadece hedef güncellenir: mevcut hız korunur, konum sıçramaz.
   */
  function glideTo(container, targetY, done) {
    anim.target = targetY;
    anim.done = done || null;
    anim.container = container;

    if (anim.raf) return; // zaten akıyor: sadece hedef değişti

    var from = scrollOf(container);
    if (Math.abs(targetY - from) < 1) {
      setScrollY(container, targetY);
      applyRestore();
      animating = false;
      if (done) done();
      return;
    }

    anim.x = from;
    anim.last = performance.now();
    startAnimStyles(container);
    anim.raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    var container = anim.container;
    // Kare atlanmış olsa bile animasyon geri kalmaz, ama sıçramaz da:
    // dt 64ms ile sınırlı, katsayı dt'ye göre hesaplanıyor.
    var dt = Math.min(64, Math.max(0, now - anim.last)) / 1000;
    anim.last = now;

    var lambda = Core.lambdaForDuration(cfg.duration);
    anim.x += (anim.target - anim.x) * Core.smoothFactor(lambda, dt);

    if (Math.abs(anim.target - anim.x) <= 1) {
      anim.x = anim.target;
      setScrollY(container, anim.x);
      anim.raf = 0;
      applyRestore();
      animating = false;
      var done = anim.done;
      anim.done = null;
      if (done) done();
      return;
    }

    setScrollY(container, anim.x);
    anim.raf = requestAnimationFrame(tick);
  }

  /** Animasyonu iptal et, stilleri geri al (native kaydırma devralacaksa). */
  function hardStop() {
    if (anim.raf) {
      cancelAnimationFrame(anim.raf);
      anim.raf = 0;
    }
    anim.done = null;
    applyRestore();
    animating = false;
    gesture.reset();
  }

  /**
   * Animasyonu hedefe anında tamamla. Tıklama gibi bir araya girme olduğunda
   * yarı yolda bırakıp snap motoruna sıçratmak yerine hedefe oturtur.
   */
  function finishNow() {
    if (!anim.raf) return;
    cancelAnimationFrame(anim.raf);
    setScrollY(anim.container, anim.target);
    anim.raf = 0;
    applyRestore();
    animating = false;
    var done = anim.done;
    anim.done = null;
    gesture.reset();
    if (done) done();
  }

  /* ---------------------------------------------------------------- adımlar */

  /** Öğe geometrisi bulunamazsa sayfa boyu adım (Shorts'ta sayfa = video). */
  function pageTarget(container, dir, base) {
    var page = (container ? container.clientHeight : window.innerHeight) || 1;
    var current = typeof base === 'number' ? base : scrollOf(container);
    var target = Core.clamp(current + dir * page, 0, maxScrollOf(container));
    return Math.abs(target - current) < 1 ? null : target;
  }

  function stepBy(context, dir, retried) {
    if (!context) return;
    var offsets = offsetsOf(context.container, context.items);

    // Konteyner yeni hazırsa (ilk yükleme) bir kez yeniden topla.
    if (offsets.length < 2 && !retried) {
      var initial = ensure(true);
      if (initial && initial.items.length !== context.items.length) return stepBy(initial, dir, true);
      if (initial) {
        context = initial;
        offsets = offsetsOf(context.container, context.items);
      }
    }

    // Animasyon sürerken yeni jest: mevcut hedefin bir ötesine geç, konumdan değil.
    var base = animating ? anim.target : scrollOf(context.container);
    var target = null;

    if (offsets.length >= 2) {
      var next = Core.nearestIndex(offsets, base) + dir;
      if (next >= 0 && next < offsets.length) target = offsets[next];
    }

    if (target === null && !retried) {
      // Liste sonuna geldiysek YouTube yeni videoları mount etmiş olabilir.
      var before = context.items.length;
      var fresh = ensure(true);
      if (fresh && fresh.items.length !== before) return stepBy(fresh, dir, true);
    }

    if (target === null) target = pageTarget(context.container, dir, base);
    if (target === null) return;

    animating = true;
    glideTo(context.container, target, function () {
      animating = false;
    });
  }

  /* ----------------------------------------------------------- akıcı mod */

  function suppressSnap(container) {
    if (!container || container.dataset.sssSnap !== undefined) return;
    container.dataset.sssSnap = container.style.scrollSnapType;
    container.style.scrollSnapType = 'none';
  }

  function restoreSnap(container) {
    if (!container || container.dataset.sssSnap === undefined) return;
    container.style.scrollSnapType = container.dataset.sssSnap;
    delete container.dataset.sssSnap;
  }

  function settleFlow(context) {
    if (!cfg.enabled || cfg.mode !== 'flow' || !context) {
      if (context) restoreSnap(context.container);
      return;
    }
    var offsets = offsetsOf(context.container, context.items);
    var current = scrollOf(context.container);
    var target = null;

    if (offsets.length >= 2) {
      target = offsets[Core.nearestIndex(offsets, current)];
    } else {
      var page = (context.container ? context.container.clientHeight : window.innerHeight) || 1;
      target = Core.clamp(Math.round(current / page) * page, 0, maxScrollOf(context.container));
    }

    restoreSnap(context.container);
    if (target === null || Math.abs(target - current) < 2) return;

    animating = true;
    glideTo(context.container, target, function () {
      animating = false;
    });
  }

  /* ------------------------------------------------------------- olaylar */

  function onWheel(event) {
    if (!cfg.enabled) return;
    if (event.ctrlKey) return; // zoom jesti
    var dy = event.deltaY;
    if (!dy) return;

    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (!target.closest(HOST_SELECTOR)) return;

    var context = ensure();
    if (!context || !context.container) return;
    // İmleç feed'in dışında (ör. sağdaki yorum paneli): native davranış kalsın.
    if (!context.container.contains(target)) return;

    var px = Core.normalizeWheel(dy, event.deltaMode, context.container.clientHeight);
    if (!px) return;
    if (nestedScrollerBlocks(target, context.container, Math.sign(px))) return;

    if (cfg.mode === 'flow') {
      // Native kaydırma devam etsin; sadece snap motorunu jest boyunca sustur.
      if (anim.raf) hardStop();
      suppressSnap(context.container);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        settleTimer = 0;
        settleFlow(ensure());
      }, 170);
      return;
    }

    // step modu: native kaydırmayı tamamen biz yönetiyoruz.
    event.preventDefault();
    // Jest makinesi her durumda beslenir; aksi hâlde tek tıkın parçaları
    // "yeni jest" sanılıp animasyon bitince ikinci adım atılıyor.
    var dir = gesture.feed(px, performance.now());
    if (!dir) return;
    // Animasyon sürüyorsa stepBy hedefi kaydırır, animasyon kesilmez.
    stepBy(context, dir, false);
  }

  function onPointerDown(event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(HOST_SELECTOR)) return;
    finishNow();
  }

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('touchstart', finishNow, { capture: true, passive: true });

  /* ------------------------------------------------------- hata ayıklama */

  globalThis.__shortsSmoothScroll = {
    getConfig: function () {
      return { enabled: cfg.enabled, mode: cfg.mode, duration: cfg.duration };
    },
    configure: function (patch) {
      applyConfig(patch);
      return this.getConfig();
    },
    step: function (dir) {
      stepBy(ensure() || collect(), dir > 0 ? 1 : -1, false);
    },
    state: function () {
      ensure();
      return {
        container: state.container ? state.container.id || state.container.tagName.toLowerCase() : null,
        items: state.items.length,
        animating: animating
      };
    }
  };
})();
