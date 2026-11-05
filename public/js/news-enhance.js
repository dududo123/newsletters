/* ============================================================
   R&D본부 소식지 — 사진 기능 추가 모듈 (news-enhance.js v1)
   ------------------------------------------------------------
   ① 데스크탑 확대 보기 : 사진 팝업(라이트박스)에서
      마우스 휠 확대/축소 · 드래그로 이동 · 더블클릭 확대/원래대로
      · 하단 [－ 100% ＋ 원래 크기] 버튼 · 키보드 + / - / 0
      (모바일은 기존처럼 손가락 확대를 그대로 사용 — 터치 동작은 건드리지 않음)
   ② 소식지 드래그로 넘기기 : 마우스/손가락으로 좌우로 끌어서 이전·다음 사진
   ③ 소식지 사진 일괄 삭제 : 여러 장 선택 → 인증코드 1회 → 순서대로 삭제

   ※ app.js 는 수정하지 않습니다. app.js 바로 다음에 이 파일만 불러오면 됩니다.
   ※ 멈춤 방지 설계
      - 이벤트는 페이지 로드 시 "한 번만" 등록 (슬라이더를 다시 그려도 중복 등록 없음)
      - 드래그 중에는 화면을 다시 그리지 않고, 사진 위치만 requestAnimationFrame 으로 이동
      - 애니메이션 종료는 transitionend 대신 setTimeout 으로 처리 (이벤트 누락 시 멈춤 방지)
      - 모든 상태 플래그에 안전장치(타임아웃/try-finally) 적용
   ============================================================ */
(function () {
  "use strict";
  if (window.__newsEnhanceInstalled) return;
  window.__newsEnhanceInstalled = true;

  /* ---------- 공통 ---------- */
  function q(sel, root) { return (root || document).querySelector(sel); }
  // app.js 의 전역 변수(let)는 같은 전역 영역이므로 직접 읽고 쓸 수 있습니다.
  function getSlides() { try { return Array.isArray(newsSlides) ? newsSlides : []; } catch (e) { return []; } }
  function getIndex() { try { return newsSlideIndex; } catch (e) { return 0; } }
  function setIndex(v) { try { newsSlideIndex = v; } catch (e) {} }
  function isReorderMode() { try { return !!newsReorderMode; } catch (e) { return false; } }
  function urlOf(slide) { try { return imageUrl(slide.imageId); } catch (e) { return "/api/image/" + slide.imageId; } }
  function esc(s) { try { return escapeHtml(s); } catch (e) { return String(s == null ? "" : s); } }

  /* ---------- 스타일 (별도 CSS 파일 없이 여기서 추가) ---------- */
  const style = document.createElement("style");
  style.id = "news-enhance-style";
  style.textContent = `
    /* ① 라이트박스 확대 */
    #lightbox { overflow: hidden; }
    #lightbox #lightboxImg {
      position: relative; z-index: 1; transform-origin: 50% 50%;
      -webkit-user-drag: none; user-select: none; -webkit-user-select: none;
    }
    #lightbox .close-btn, #lightbox .lightbox-nav-btn, #lightbox .lightbox-counter { z-index: 3; }
    .ne-zoom-bar {
      display: none; position: absolute; right: 22px; bottom: 22px; z-index: 3;
      align-items: center; gap: 4px; padding: 4px; border-radius: 999px;
      background: rgba(255,255,255,0.14); color: #fff; font-size: 13px; font-weight: 700;
    }
    .ne-zoom-bar button {
      border: none; background: transparent; color: #fff; cursor: pointer; font-family: inherit;
      min-width: 32px; height: 32px; border-radius: 999px; font-size: 16px; font-weight: 700; padding: 0 10px;
    }
    .ne-zoom-bar button:hover { background: rgba(255,255,255,0.22); }
    .ne-zoom-bar button.ne-reset { font-size: 12.5px; }
    .ne-zoom-bar .ne-zoom-val { min-width: 46px; text-align: center; }
    @media (hover: hover) and (pointer: fine) {
      .ne-zoom-bar { display: flex; }
      #lightbox #lightboxImg { cursor: zoom-in; }
      #lightbox.ne-zoomed #lightboxImg { cursor: grab; }
      #lightbox #lightboxImg.ne-dragging { cursor: grabbing; }
      #lightbox.ne-zoomed .lightbox-counter { opacity: .55; }
    }

    /* ② 소식지 드래그 넘기기 */
    .news-slider-frame.ne-swipeable { touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; }
    .news-slider-frame.ne-swipeable img { -webkit-user-drag: none; }
    .news-slider-frame.ne-swiping img { cursor: grabbing; }
    @keyframes neEnterNext { from { transform: translateX(36px); opacity: .2; } to { transform: none; opacity: 1; } }
    @keyframes neEnterPrev { from { transform: translateX(-36px); opacity: .2; } to { transform: none; opacity: 1; } }
    .news-slider-frame img.ne-enter-next { animation: neEnterNext .2s ease-out; }
    .news-slider-frame img.ne-enter-prev { animation: neEnterPrev .2s ease-out; }

    /* ③ 일괄 삭제 */
    .news-slider-toolbar .ne-bulk-btn { margin-left: auto; }
    #newsBulkDeleteModal { z-index: 990; } /* 인증코드 창(1000)이 위에 뜨도록 */
    .ne-bulk-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; font-size: 13px; }
    .ne-bulk-head label { display: flex; align-items: center; gap: 6px; font-weight: 700; cursor: pointer; }
    .ne-bulk-head .ne-bulk-count { color: var(--danger, #B3261E); font-weight: 700; }
    .ne-bulk-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;
      max-height: 52vh; overflow-y: auto; padding: 2px;
    }
    .ne-bulk-item {
      position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; cursor: pointer;
      border: 2px solid var(--border, #E6DFDA); background: #F0EDEA; display: block;
    }
    .ne-bulk-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ne-bulk-item input { position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; margin: 0; accent-color: var(--danger, #B3261E); cursor: pointer; }
    .ne-bulk-item .ne-bulk-no {
      position: absolute; right: 6px; bottom: 6px; background: rgba(43,36,34,0.65); color: #fff;
      font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px;
    }
    .ne-bulk-item.checked { border-color: var(--danger, #B3261E); }
    .ne-bulk-item.checked img { opacity: .55; }
    #newsBulkDeleteModal .btn-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  `;
  document.head.appendChild(style);

  /* ============================================================
     ① 데스크탑 확대 보기 (라이트박스)
     ============================================================ */
  const lb = q("#lightbox");
  const lbImg = q("#lightboxImg");
  let lbSuppressClickUntil = 0;
  let lastRenderedIndex = null;   // 슬라이더에 현재 표시 중인 사진 번호
  let lbReset = function () {};

  if (lb && lbImg) {
    const MIN = 1, MAX = 5;
    let scale = 1, tx = 0, ty = 0;        // 목표 값
    let aTx = 0, aTy = 0;                  // 실제로 화면에 적용된 이동 값
    let rafId = 0;
    let drag = null;
    let lastPointerType = "mouse";

    lbImg.draggable = false;

    const bar = document.createElement("div");
    bar.className = "ne-zoom-bar";
    bar.innerHTML = `
      <button type="button" data-z="out" title="축소 (-)">－</button>
      <span class="ne-zoom-val">100%</span>
      <button type="button" data-z="in" title="확대 (+)">＋</button>
      <button type="button" data-z="reset" class="ne-reset" title="원래 크기 (0)">원래 크기</button>`;
    lb.appendChild(bar);
    const zoomVal = q(".ne-zoom-val", bar);

    function apply() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      const isIdentity = scale === 1 && tx === 0 && ty === 0;
      lbImg.style.transform = isIdentity ? "" : `translate(${tx}px, ${ty}px) scale(${scale})`;
      aTx = tx; aTy = ty;
      lb.classList.toggle("ne-zoomed", scale > 1);
      zoomVal.textContent = Math.round(scale * 100) + "%";
    }
    function schedule() {
      if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; apply(); });
    }
    function clampPan() {
      const w = lbImg.offsetWidth || 0, h = lbImg.offsetHeight || 0;
      const mx = Math.max(0, (w * scale - w) / 2);
      const my = Math.max(0, (h * scale - h) / 2);
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    }
    function reset() {
      drag = null;
      lbImg.classList.remove("ne-dragging");
      scale = 1; tx = 0; ty = 0;
      apply();
    }
    lbReset = reset;

    // 기준점(clientX, clientY)을 중심으로 확대/축소
    function zoomAt(newScale, cx, cy) {
      newScale = Math.min(MAX, Math.max(MIN, newScale));
      if (!isFinite(newScale) || Math.abs(newScale - scale) < 0.0001) return;
      const r = lbImg.getBoundingClientRect();
      // 현재 화면상 사진 중심 (적용된 변환 기준)
      const centerX = r.left + r.width / 2 - aTx + tx;
      const centerY = r.top + r.height / 2 - aTy + ty;
      if (cx == null) { cx = centerX; cy = centerY; }
      const k = 1 - newScale / scale;
      tx += (cx - centerX) * k;
      ty += (cy - centerY) * k;
      scale = newScale;
      if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
      clampPan();
      apply();
    }

    // 마우스 휠 / 노트북 터치패드 확대 (팝업이 열려 있을 때만)
    lb.addEventListener("wheel", (e) => {
      if (!lb.classList.contains("open")) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
      const delta = Math.max(-300, Math.min(300, e.deltaY));
      zoomAt(scale * Math.exp(-delta * unit), e.clientX, e.clientY);
    }, { passive: false });

    // 확대 버튼
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.stopPropagation();
      const z = btn.dataset.z;
      if (z === "in") zoomAt(scale * 1.4);
      else if (z === "out") zoomAt(scale / 1.4);
      else reset();
    });

    // 사진 드래그: 확대 상태면 이동, 원래 크기면(갤러리) 좌우로 넘기기 — 마우스만 처리
    lbImg.addEventListener("pointerdown", (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (e.pointerType !== "mouse" || e.button !== 0) return;   // 터치는 기존 모바일 동작 유지
      e.preventDefault();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty, moved: false, mode: scale > 1 ? "pan" : "swipe" };
      try { lbImg.setPointerCapture(e.pointerId); } catch (err) {}
    });
    lbImg.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        drag.moved = true;
        lbImg.classList.add("ne-dragging");
      }
      if (drag.mode === "pan") {
        tx = drag.tx0 + dx; ty = drag.ty0 + dy;
        clampPan();
        schedule();
      } else if (lb.classList.contains("gallery-mode")) {
        tx = dx; ty = 0;
        schedule();
      }
    });
    function endLbDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      lbImg.classList.remove("ne-dragging");
      try { lbImg.releasePointerCapture(e.pointerId); } catch (err) {}
      if (d.moved) lbSuppressClickUntil = Date.now() + 120;
      if (d.mode === "swipe") {
        const dx = e.clientX - d.sx;
        tx = 0; ty = 0; apply();
        if (e.type === "pointerup" && d.moved && Math.abs(dx) > 60 &&
            lb.classList.contains("gallery-mode") && typeof lightboxGalleryStep === "function") {
          lightboxGalleryStep(dx < 0 ? 1 : -1);
        }
      }
    }
    lbImg.addEventListener("pointerup", endLbDrag);
    lbImg.addEventListener("pointercancel", endLbDrag);
    lbImg.addEventListener("lostpointercapture", (e) => { if (drag && e.pointerId === drag.id) endLbDrag(e); });
    lb.addEventListener("dragstart", (e) => e.preventDefault());

    // 더블클릭: 확대 ↔ 원래대로 (마우스만)
    lbImg.addEventListener("dblclick", (e) => {
      if (lastPointerType !== "mouse") return;
      e.preventDefault();
      if (scale > 1) reset(); else zoomAt(2.5, e.clientX, e.clientY);
    });

    // 드래그 직후 발생하는 클릭이 팝업을 닫지 않도록 차단
    document.addEventListener("click", (e) => {
      if (Date.now() < lbSuppressClickUntil && lb.contains(e.target)) {
        lbSuppressClickUntil = 0;   // 바로 다음 클릭 1번만 차단
        e.stopPropagation(); e.preventDefault();
      }
    }, true);

    // 키보드: + / - / 0
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(scale * 1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(scale / 1.25); }
      else if (e.key === "0") { e.preventDefault(); reset(); }
    });

    // 사진이 바뀌거나 팝업이 닫히면 확대 상태 초기화
    new MutationObserver(() => reset()).observe(lbImg, { attributes: true, attributeFilter: ["src"] });
    new MutationObserver(() => {
      if (lb.classList.contains("open")) return;
      reset();
      // 팝업에서 넘겨본 위치를 소식지 슬라이더에도 반영
      if (lastRenderedIndex !== null && lastRenderedIndex !== getIndex() && typeof renderNewsSlider === "function") {
        try { renderNewsSlider(); } catch (err) { console.error(err); }
      }
    }).observe(lb, { attributes: true, attributeFilter: ["class"] });

    // 모바일 팝업(갤러리)에서 한 손가락으로 좌우로 밀어 넘기기
    //  - passive 리스너만 사용 → 기존 손가락 확대(핀치)에 전혀 간섭하지 않음
    //  - 화면을 확대한 상태에서는 넘기지 않음 (확대 후 이동과 충돌 방지)
    let touchStart = null;
    lb.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { touchStart = null; return; }
      if (e.target.closest("button")) { touchStart = null; return; }
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    lb.addEventListener("touchmove", (e) => { if (e.touches.length > 1) touchStart = null; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      const s = touchStart; touchStart = null;
      if (!s || !lb.classList.contains("gallery-mode")) return;
      const vv = window.visualViewport;
      if (vv && vv.scale > 1.01) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.time < 800 &&
          typeof lightboxGalleryStep === "function") {
        lbSuppressClickUntil = Date.now() + 120;
        lightboxGalleryStep(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  /* ============================================================
     ② 소식지 슬라이더 — 드래그로 넘기기
     ============================================================ */
  const sliderBody = q("#newsSliderBody");
  let sw = null;                 // 진행 중인 드래그 정보
  let swRaf = 0;
  let animating = false;
  let animTimer = 0;
  let enterDir = null;           // 새 사진 등장 방향
  let sliderSuppressClickUntil = 0;

  function cancelSwipe(snapBack) {
    const s = sw;
    sw = null;
    if (swRaf) { cancelAnimationFrame(swRaf); swRaf = 0; }
    if (!s) return;
    s.frame.classList.remove("ne-swiping");
    if (snapBack && s.img && s.img.isConnected) {
      s.img.style.transition = "transform .18s ease-out";
      s.img.style.transform = "";
      setTimeout(() => { if (s.img) s.img.style.transition = ""; }, 220);
    } else if (s.img) {
      s.img.style.transition = ""; s.img.style.transform = "";
    }
  }

  function goToSlide(delta) {
    const slides = getSlides();
    if (slides.length < 2 || typeof renderNewsSlider !== "function") return;
    setIndex((getIndex() + delta + slides.length) % slides.length);
    enterDir = delta > 0 ? "next" : "prev";
    renderNewsSlider();
  }

  if (sliderBody) {
    sliderBody.addEventListener("pointerdown", (e) => {
      if (animating) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const frame = e.target.closest(".news-slider-frame");
      if (!frame || !sliderBody.contains(frame)) return;
      if (e.target.closest("button")) return;           // ‹ › ✕ 버튼은 원래대로
      if (isReorderMode()) return;                      // 순서 변경 중에는 드래그 비활성
      if (getSlides().length < 2) return;
      if (sw) {
        // 두 번째 손가락(핀치) → 드래그 취소. 오래된(멈춘) 상태면 정리 후 새로 시작
        const stale = Date.now() - sw.last > 1500;
        cancelSwipe(true);
        if (!stale) return;
      }
      const img = q("#newsSlideImg", frame);
      if (!img) return;
      img.classList.remove("ne-enter-next", "ne-enter-prev");
      sw = {
        id: e.pointerId, type: e.pointerType, sx: e.clientX, sy: e.clientY, dx: 0,
        t0: Date.now(), last: Date.now(), locked: null, frame, img, width: frame.clientWidth || 300,
      };
      if (e.pointerType === "mouse") e.preventDefault();   // 글자 선택/사진 끌기 방지
    });

    // move/up 은 window 에서 받습니다 → 마우스가 사진 밖으로 나가도 정상 종료
    window.addEventListener("pointermove", (e) => {
      if (!sw || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.sx, dy = e.clientY - sw.sy;
      sw.last = Date.now();
      if (sw.locked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        sw.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (sw.locked === "y") { cancelSwipe(false); return; }   // 세로 스크롤은 브라우저에 맡김
        sw.frame.classList.add("ne-swiping");
        sw.img.style.transition = "none";
      }
      sw.dx = dx;
      if (!swRaf) {
        swRaf = requestAnimationFrame(() => {
          swRaf = 0;
          if (sw && sw.img) sw.img.style.transform = `translateX(${sw.dx}px)`;
        });
      }
    });

    function endSwipe(e) {
      if (!sw || e.pointerId !== sw.id) return;
      const s = sw;
      if (s.locked !== "x") { cancelSwipe(false); return; }
      sliderSuppressClickUntil = Date.now() + 120;      // 드래그 직후 클릭으로 팝업 열림 방지
      const dt = Date.now() - s.t0;
      const threshold = Math.min(80, s.width * 0.18);
      const flick = Math.abs(s.dx) > 25 && dt < 260;
      if (e.type !== "pointerup" || !(Math.abs(s.dx) > threshold || flick)) {
        cancelSwipe(true);
        return;
      }
      // 넘기기 확정: 현재 사진을 밖으로 밀어낸 뒤 다음 사진 표시
      sw = null;
      if (swRaf) { cancelAnimationFrame(swRaf); swRaf = 0; }
      s.frame.classList.remove("ne-swiping");
      const dir = s.dx < 0 ? 1 : -1;
      animating = true;
      s.img.style.transition = "transform .16s ease-out";
      s.img.style.transform = `translateX(${dir > 0 ? -s.width : s.width}px)`;
      clearTimeout(animTimer);
      animTimer = setTimeout(() => {
        try { goToSlide(dir); }
        catch (err) { console.error("[news-enhance] 넘기기 오류:", err); }
        finally { animating = false; }
      }, 170);
    }
    window.addEventListener("pointerup", endSwipe);
    window.addEventListener("pointercancel", endSwipe);
    window.addEventListener("blur", () => { if (sw) cancelSwipe(true); });

    sliderBody.addEventListener("click", (e) => {
      if (Date.now() < sliderSuppressClickUntil) {
        sliderSuppressClickUntil = 0;   // 바로 다음 클릭 1번만 차단
        e.stopPropagation(); e.preventDefault();
      }
    }, true);
    sliderBody.addEventListener("dragstart", (e) => {
      if (e.target.closest(".news-slider-frame")) e.preventDefault();
    });
  }

  /* 슬라이더가 다시 그려질 때마다 추가 요소 장착 (가벼운 작업만 수행) */
  function decorateSlider() {
    if (!sliderBody) return;
    // 드래그 도중 다시 그려졌다면 드래그 상태 정리
    if (sw && !sw.frame.isConnected) { sw = null; }
    const slides = getSlides();
    lastRenderedIndex = slides.length ? getIndex() : null;
    const frame = q(".news-slider-frame", sliderBody);
    const img = q("#newsSlideImg", sliderBody);
    if (img) {
      img.draggable = false;
      if (enterDir) {
        img.classList.add(enterDir === "next" ? "ne-enter-next" : "ne-enter-prev");
        const target = img;
        setTimeout(() => target.classList.remove("ne-enter-next", "ne-enter-prev"), 260);
      }
    }
    enterDir = null;
    if (frame) frame.classList.toggle("ne-swipeable", slides.length > 1 && !isReorderMode());

    // ③ 일괄 삭제 버튼
    const toolbar = q(".news-slider-toolbar", sliderBody);
    if (toolbar && !isReorderMode() && slides.length > 0 && !q(".ne-bulk-btn", toolbar)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-danger btn-sm ne-bulk-btn";
      btn.id = "newsBulkDeleteBtn";
      btn.textContent = "🗑 사진 일괄 삭제";
      btn.addEventListener("click", openBulkDeleteModal);
      toolbar.appendChild(btn);
    }

    // 선택된 썸네일이 보이도록 썸네일 줄만 스크롤 (페이지 스크롤은 건드리지 않음)
    const thumbs = q("#newsSlideThumbs", sliderBody);
    const active = thumbs && q("img.active", thumbs);
    if (thumbs && active) {
      const left = active.offsetLeft - thumbs.offsetLeft;
      if (left < thumbs.scrollLeft || left + active.offsetWidth > thumbs.scrollLeft + thumbs.clientWidth) {
        thumbs.scrollLeft = Math.max(0, left - thumbs.clientWidth / 2 + active.offsetWidth / 2);
      }
    }

    // 앞뒤 사진 1장씩만 미리 받아두기 (넘길 때 빈 화면 방지)
    if (slides.length > 1) {
      const i = getIndex();
      [i + 1, i - 1].forEach((k) => {
        const s = slides[(k + slides.length) % slides.length];
        if (s && s.imageId) { const pre = new Image(); pre.decoding = "async"; pre.src = urlOf(s); }
      });
    }
  }

  if (typeof renderNewsSlider === "function") {
    const originalRender = renderNewsSlider;
    renderNewsSlider = function () {
      const result = originalRender.apply(this, arguments);
      try { decorateSlider(); } catch (err) { console.error("[news-enhance] 슬라이더 장식 오류:", err); }
      return result;
    };
    // 이미 그려져 있는 경우 대비
    try { decorateSlider(); } catch (err) {}
  } else {
    console.warn("[news-enhance] renderNewsSlider 를 찾지 못해 드래그/일괄삭제 기능을 건너뜁니다.");
  }

  /* ============================================================
     ③ 소식지 사진 일괄 삭제
     ============================================================ */
  let bulkModal = null;
  let bulkBusy = false;

  function ensureBulkModal() {
    if (bulkModal) return bulkModal;
    bulkModal = document.createElement("div");
    bulkModal.className = "modal-overlay";
    bulkModal.id = "newsBulkDeleteModal";
    bulkModal.innerHTML = `
      <div class="modal-box wide">
        <button type="button" class="modal-close" data-ne-close>×</button>
        <h3>소식지 사진 일괄 삭제</h3>
        <p class="desc">삭제할 사진을 선택하세요. 삭제한 사진은 되돌릴 수 없습니다.</p>
        <div class="ne-bulk-head">
          <label><input type="checkbox" id="neBulkAll"> 전체 선택</label>
          <span class="ne-bulk-count" id="neBulkCount">0장 선택</span>
        </div>
        <div class="ne-bulk-grid" id="neBulkGrid"></div>
        <div id="neBulkStatus"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-ne-close>취소</button>
          <button type="button" class="btn btn-danger" id="neBulkDeleteBtn" disabled>선택한 사진 삭제</button>
        </div>
      </div>`;
    document.body.appendChild(bulkModal);

    bulkModal.addEventListener("click", (e) => {
      if (bulkBusy) return;
      if (e.target === bulkModal || e.target.closest("[data-ne-close]")) closeBulkModal();
    });
    q("#neBulkGrid", bulkModal).addEventListener("change", (e) => {
      const item = e.target.closest(".ne-bulk-item");
      if (item) item.classList.toggle("checked", e.target.checked);
      updateBulkCount();
    });
    q("#neBulkAll", bulkModal).addEventListener("change", (e) => {
      const on = e.target.checked;
      bulkModal.querySelectorAll("#neBulkGrid input[type=checkbox]").forEach((cb) => {
        cb.checked = on;
        cb.closest(".ne-bulk-item").classList.toggle("checked", on);
      });
      updateBulkCount();
    });
    q("#neBulkDeleteBtn", bulkModal).addEventListener("click", runBulkDelete);
    return bulkModal;
  }

  function selectedIds() {
    return Array.from(bulkModal.querySelectorAll("#neBulkGrid input[type=checkbox]:checked")).map((cb) => cb.value);
  }
  function updateBulkCount() {
    const all = bulkModal.querySelectorAll("#neBulkGrid input[type=checkbox]");
    const n = selectedIds().length;
    q("#neBulkCount", bulkModal).textContent = `${n}장 선택`;
    q("#neBulkAll", bulkModal).checked = all.length > 0 && n === all.length;
    const btn = q("#neBulkDeleteBtn", bulkModal);
    btn.disabled = bulkBusy || n === 0;
    btn.textContent = n ? `선택한 사진 ${n}장 삭제` : "선택한 사진 삭제";
  }
  function setBulkStatus(msg, type) {
    q("#neBulkStatus", bulkModal).innerHTML = msg ? `<div class="status-msg ${type}">${esc(msg)}</div>` : "";
  }
  function closeBulkModal() { if (bulkModal && !bulkBusy) bulkModal.classList.remove("open"); }

  function openBulkDeleteModal() {
    if (isReorderMode()) return;
    const slides = getSlides();
    if (!slides.length) return;
    ensureBulkModal();
    q("#neBulkGrid", bulkModal).innerHTML = slides.map((s, idx) => `
      <label class="ne-bulk-item">
        <img src="${urlOf(s)}" alt="소식지 사진 ${idx + 1}" loading="lazy" decoding="async" draggable="false">
        <input type="checkbox" value="${esc(s.id)}">
        <span class="ne-bulk-no">${idx + 1}</span>
      </label>`).join("");
    q("#neBulkAll", bulkModal).checked = false;
    q("#neBulkAll", bulkModal).disabled = false;
    setBulkStatus("", "");
    updateBulkCount();
    bulkModal.classList.add("open");
  }

  async function runBulkDelete() {
    if (bulkBusy) return;
    const ids = selectedIds();
    if (!ids.length) return;
    if (typeof verifyPasscodeAndGet !== "function" || typeof apiDelete !== "function") {
      setBulkStatus("삭제 기능을 불러오지 못했습니다. 페이지를 새로고침 해주세요.", "error");
      return;
    }
    if (!confirm(`선택한 사진 ${ids.length}장을 삭제할까요?\n삭제한 사진은 되돌릴 수 없습니다.`)) return;
    const code = await verifyPasscodeAndGet("일괄 삭제 확인", `사진 ${ids.length}장을 삭제하려면 인증코드를 입력해주세요.`);
    if (!code) return;

    bulkBusy = true;
    const delBtn = q("#neBulkDeleteBtn", bulkModal);
    delBtn.disabled = true;
    bulkModal.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.disabled = true; });

    let done = 0;
    let errorMsg = null;
    try {
      // 한 장씩 순서대로 삭제 (서버에 한꺼번에 부담을 주지 않음)
      for (const id of ids) {
        delBtn.textContent = `삭제 중... (${done + 1}/${ids.length})`;
        try {
          await apiDelete(`/news-slides?id=${encodeURIComponent(id)}&code=${encodeURIComponent(code)}`);
          done++;
        } catch (err) {
          errorMsg = err && err.message ? err.message : String(err);
          break;   // 오류가 나면 즉시 중단 (같은 오류 반복 방지)
        }
      }
      try { if (typeof loadNewsSlides === "function") await loadNewsSlides(); } catch (err) { console.error(err); }
      setIndex(0);
      if (typeof renderNewsSlider === "function") renderNewsSlider();
    } finally {
      bulkBusy = false;
    }

    if (errorMsg) {
      setBulkStatus(`${done}장 삭제 후 오류로 중단되었습니다: ${errorMsg}`, "error");
      // 남은 사진 기준으로 목록 다시 표시
      const keep = new Set(getSlides().map((s) => String(s.id)));
      bulkModal.querySelectorAll("#neBulkGrid .ne-bulk-item").forEach((item) => {
        const cb = q("input", item);
        if (!keep.has(cb.value)) item.remove(); else cb.disabled = false;
      });
      q("#neBulkAll", bulkModal).disabled = false;
      updateBulkCount();
    } else {
      setBulkStatus(`사진 ${done}장을 삭제했습니다.`, "success");
      delBtn.textContent = "삭제 완료";
      setTimeout(closeBulkModal, 700);
    }
  }

  // 팝업이 열려 있을 때 Esc 로 일괄삭제 창 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && bulkModal && bulkModal.classList.contains("open")) closeBulkModal();
  });
})();
