/* ============================================================
   R&D본부 소식지 — 식단표·밀박스 · 미태그 식사등록 · 외부인 식사신청 · 댓글 비밀번호 (meal.js v3 · 전체본)
   ------------------------------------------------------------
   ① 식단표·밀박스 사진 1번/2번 : 한 장씩 보기 · 보고 있는 번호 창에서 업로드하면 그 사진이 자동 교체
   ② 사원증 미태그 식사등록 : 사번·이름 등록 (날짜 자동) · 오늘 등록 현황(10명 + 스크롤)
      · QR 주소(사이트주소/?untag=1) → 등록 팝업만 전체화면 · "등록 팝업 열기" 버튼은 숨김
   ③ 관리 : 설정/관리자 메뉴 → "🪪 미태그 식사기록" (조회 · 엑셀 · 삭제 · QR코드 저장)
   ④ 외부인 식사 신청 : 신청 팝업(식사일자 포함) · 신청 목록 · 관리자 승인/삭제 (메일 기능 없음)
   ⑤ 중식 샐러드 댓글 : 작성 시 비밀번호 4자리 · 그 비밀번호(또는 관리자 인증코드)로 삭제
   ※ app.js · news-enhance.js · community.js 다음, admin.js 앞에 불러옵니다.
   ※ 모든 데이터는 서버(/api)에 저장합니다. (브라우저 저장소 사용 안 함)
   ============================================================ */

/* ---------- QR코드 생성기 (외부 라이브러리 없음) ---------- */
window.MiniQR = window.MiniQR || (function () {
  const V = {1:[26,10,[[1,16]]],2:[44,16,[[1,28]]],3:[70,26,[[1,44]]],4:[100,18,[[2,32]]],5:[134,24,[[2,43]]],
    6:[172,16,[[4,27]]],7:[196,18,[[4,31]]],8:[242,22,[[2,38],[2,39]]],9:[292,22,[[3,36],[2,37]]],10:[346,26,[[4,43],[1,44]]]};
  const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; };
  function rsDiv(deg) { const d = new Array(deg).fill(0); d[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { d[j] = mul(d[j], root); if (j + 1 < deg) d[j] ^= d[j + 1]; } root = mul(root, 2); } return d; }
  function rsRem(data, div) { const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text)); let ver = 0;
    for (let v = 1; v <= 10; v++) { const cap = V[v][2].reduce((a, [n, k]) => a + n * k, 0); if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) { ver = v; break; } }
    if (!ver) throw new Error("주소가 너무 깁니다.");
    const [, ecLen, groups] = V[ver]; const capBytes = groups.reduce((a, [n, k]) => a + n * k, 0);
    const bits = []; const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, capBytes * 8 - bits.length)); while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    for (let p = 0xEC; data.length < capBytes; p ^= 0xEC ^ 0x11) data.push(p);
    const blocks = []; let k = 0; const div = rsDiv(ecLen);
    groups.forEach(([n, len]) => { for (let i = 0; i < n; i++) { const d = data.slice(k, k + len); k += len; blocks.push([d, rsRem(d, div)]); } });
    const out = []; const maxD = Math.max(...blocks.map((b) => b[0].length));
    for (let i = 0; i < maxD; i++) blocks.forEach((b) => { if (i < b[0].length) out.push(b[0][i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b[1][i]));
    const size = ver * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const F = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) { const dist = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, dist !== 2 && dist !== 4); } } });
    const al = ALIGN[ver], n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const drawFormat = (mask) => { let rem = mask; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((mask << 10) | rem) ^ 0x5412; const bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i)); for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true); };
    drawFormat(0);
    if (ver >= 7) { let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = (ver << 12) | rem; for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!F[y][x] && i < out.length * 8) { M[y][x] = ((out[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; } } }
    const mf = [(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,
      (x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
    const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && mf[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => { let p = 0, dark = 0;
      for (let y = 0; y < size; y++) { let run = 1; for (let x = 0; x < size; x++) { if (M[y][x]) dark++; if (x && M[y][x] === M[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let x = 0; x < size; x++) { let run = 1; for (let y = 1; y < size; y++) { if (M[y][x] === M[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10; };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { apply(m); drawFormat(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
    apply(best); drawFormat(best); return { size, modules: M, version: ver };
  }
  function toCanvas(text, canvas, px) {
    const q = encode(text), border = 4, scale = px || 8, dim = (q.size + border * 2) * scale;
    canvas.width = dim; canvas.height = dim; const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, dim, dim); g.fillStyle = "#000";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) g.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
    return q;
  }
  return { encode, toCanvas };
})();

(function () {
  "use strict";
  if (window.__mealModuleInstalled) return;
  window.__mealModuleInstalled = true;
  window.__extrasInstalled = true;   // 예전 extras.js 를 불러와도 중복 실행되지 않도록

  const POPUP_PARAM = "untag";
  const st = (el, msg, type) => { if (el) el.innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : ""; };
  const todayKST = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return ""; } };
  const isPopupMode = new URLSearchParams(location.search).has(POPUP_PARAM);
  const siteBase = () => location.href.split(/[?#]/)[0];
  const popupUrl = () => siteBase() + "?" + POPUP_PARAM + "=1";
  const on = (sel, evt, fn) => { const el = $(sel); if (el) el.addEventListener(evt, fn); return el; };

  try { SECTION_TITLE_DEFAULTS.mealplan = "식단표 · 밀박스"; } catch (e) {}

  /* 식단 사진을 크게 볼 때 '소식지 사진 조회수'가 잘못 올라가지 않도록 */
  let mealLightbox = false;
  if (typeof trackSectionView === "function") {
    const originalTrack = trackSectionView;
    trackSectionView = function (section) { if (mealLightbox && section === "news") return; return originalTrack.apply(this, arguments); };
  }
  const lbEl = $("#lightbox");
  if (lbEl) new MutationObserver(() => { if (!lbEl.classList.contains("open")) mealLightbox = false; }).observe(lbEl, { attributes: true, attributeFilter: ["class"] });

  /* ======================= ① 식단표·밀박스 사진 ======================= */
  const SLOTS = [{ no: 1, label: "식단표" }, { no: 2, label: "밀박스" }];
  let mealPhotos = [];
  let curSlot = 1;
  let swipeMoved = false;
  const photoOf = (no) => mealPhotos.find((p) => Number(p.slot) === no);

  async function loadMealPhotos() {
    try { const d = await apiGet("/meal-photos"); mealPhotos = Array.isArray(d) ? d : []; } catch (err) { mealPhotos = []; }
    renderMealPhotos();
  }
  function renderMealPhotos() {
    const box = $("#mealPhotoBody"); if (!box) return;
    const s = SLOTS[curSlot - 1], p = photoOf(curSlot);
    box.innerHTML = `
      <div class="meal-viewer-tabs" role="tablist">${SLOTS.map((x) => `
        <button type="button" role="tab" data-slot="${x.no}" class="${x.no === curSlot ? "active" : ""}" aria-selected="${x.no === curSlot}">
          <span class="no">${x.no}</span>${x.label} <span class="st">${photoOf(x.no) ? "" : "(없음)"}</span></button>`).join("")}
      </div>
      <div class="meal-viewer${p ? "" : " empty"}" id="mealViewer" data-slot="${curSlot}">
        ${p ? `<img src="${imageUrl(p.imageId)}" alt="${curSlot}번 ${s.label} 사진" draggable="false" decoding="async">`
            : `<div class="meal-viewer-empty"><div class="icon">📷</div>${curSlot}번 ${s.label} 사진이 없습니다<br>아래 버튼으로 올려주세요</div>`}
        <span class="meal-viewer-label">${curSlot}번 · ${s.label}</span>
        <button type="button" class="meal-viewer-nav prev" aria-label="이전 사진">‹</button>
        <button type="button" class="meal-viewer-nav next" aria-label="다음 사진">›</button>
        <span class="meal-viewer-counter">${curSlot} / 2</span>
      </div>
      <div class="meal-viewer-bar">
        <span class="meta">${p ? formatDate(p.date) + " 업로드" : "아직 사진 없음"}</span>
        ${p ? `<button type="button" class="btn btn-ghost btn-sm meal-del">삭제</button>` : ""}
        <button type="button" class="btn btn-primary meal-up">📷 ${curSlot}번 사진 ${p ? "교체" : "업로드"}</button>
      </div>
      <p class="meal-viewer-hint">업로드하면 지금 보고 있는 <b>${curSlot}번 사진</b>이 새 사진으로 바뀝니다.</p>`;
    const viewer = $("#mealViewer");
    $all(".meal-viewer-tabs button", box).forEach((b) => b.addEventListener("click", () => { curSlot = Number(b.dataset.slot); renderMealPhotos(); }));
    $all(".meal-viewer-nav", box).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); curSlot = curSlot === 1 ? 2 : 1; renderMealPhotos(); }));
    $(".meal-up", box).addEventListener("click", startUpload);
    const del = $(".meal-del", box); if (del) del.addEventListener("click", () => deleteMealPhoto(curSlot));
    viewer.addEventListener("click", (e) => {
      if (e.target.closest(".meal-viewer-nav") || swipeMoved) return;
      if (!p) { startUpload(); return; }
      const list = SLOTS.map((x) => photoOf(x.no)).filter(Boolean);
      trackSectionView(curSlot === 1 ? "mealplan" : "mealbox");
      mealLightbox = true;
      openLightboxGallery(list.map((x) => imageUrl(x.imageId)), Math.max(0, list.findIndex((x) => Number(x.slot) === curSlot)));
    });
    let sx = 0, sy = 0, touching = false;
    viewer.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; touching = true; swipeMoved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    viewer.addEventListener("touchmove", (e) => { if (!touching) return; const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy; if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) swipeMoved = true; }, { passive: true });
    viewer.addEventListener("touchend", (e) => { if (!touching) return; touching = false; const dx = ((e.changedTouches[0] || {}).clientX || sx) - sx;
      if (swipeMoved && Math.abs(dx) > 40) { curSlot = curSlot === 1 ? 2 : 1; renderMealPhotos(); }
      setTimeout(() => { swipeMoved = false; }, 60); });
  }
  let uploadSlot = null;
  function startUpload() {
    uploadSlot = curSlot;
    const inp = $("#mealReplaceInput"); if (!inp) return;
    inp.value = ""; inp.click();
  }
  on("#mealReplaceInput", "change", async (e) => {
    const file = e.target.files && e.target.files[0];
    const no = uploadSlot; uploadSlot = null;
    if (!file || !no) return;
    if (!file.type.startsWith("image/")) { alert("이미지 파일만 선택할 수 있어요."); return; }
    const code = window.__adminCode || await verifyPasscodeAndGet(`${no}번 ${SLOTS[no - 1].label} 사진`, "사진을 올리려면 인증코드를 입력해주세요.");
    if (!code) return;
    const viewer = $("#mealViewer");
    if (viewer) viewer.insertAdjacentHTML("beforeend", `<div class="meal-busy">올리는 중...</div>`);
    try {
      const data = await resizeImageFile(file, 1600, 0.8);
      await apiPut("/meal-photos", { slot: no, image: data, code });
    } catch (err) { alert("사진 저장에 실패했습니다: " + err.message); }
    curSlot = no;
    await loadMealPhotos();
    const v = $("#mealViewer"); if (v) { v.classList.remove("flash"); void v.offsetWidth; v.classList.add("flash"); }
  });
  async function deleteMealPhoto(no) {
    if (!confirm(`${no}번 ${SLOTS[no - 1].label} 사진을 삭제할까요?`)) return;
    const code = window.__adminCode || await verifyPasscodeAndGet("삭제 확인", "사진을 삭제하려면 인증코드를 입력해주세요.");
    if (!code) return;
    try { await apiDelete(`/meal-photos?slot=${no}&code=${encodeURIComponent(code)}`); }
    catch (err) { alert("삭제 중 오류가 발생했습니다: " + err.message); return; }
    await loadMealPhotos();
  }

  /* ======================= 밀박스 탭 ======================= */
  $all(".mb-tabs button").forEach((b) => b.addEventListener("click", () => {
    $all(".mb-tabs button").forEach((x) => { const act = x === b; x.classList.toggle("active", act); x.setAttribute("aria-selected", act); });
    $all(".mb-pane").forEach((p) => p.classList.toggle("active", p.id === "mb-" + b.dataset.mb));
    trackSectionView("mealbox");
    if (b.dataset.mb === "guest") loadGuestList();
  }));

  /* ======================= ② 미태그 등록 ======================= */
  let lastNewId = null;
  async function registerUntag(empRaw, nameRaw) {
    const empNo = String(empRaw || "").replace(/\s/g, ""), name = String(nameRaw || "").trim();
    if (!empNo) throw Object.assign(new Error("사번을 입력해주세요."), { field: "emp" });
    if (!/^[A-Za-z0-9]{3,12}$/.test(empNo)) throw Object.assign(new Error("사번은 영문/숫자 3~12자로 입력해주세요."), { field: "emp" });
    if (!name) throw Object.assign(new Error("이름을 입력해주세요."), { field: "name" });
    const r = await apiPost("/untag", { empNo, name });
    lastNewId = r.id; loadToday();
    return { ...r, name };
  }
  on("#untagForm", "submit", async (e) => {
    e.preventDefault();
    const s = $("#untagStatus"), empI = $("#untagEmpNo"), nameI = $("#untagName"), btn = $("#untagSubmitBtn");
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "등록 중...";
    try {
      const r = await registerUntag(empI.value, nameI.value);
      st(s, `✅ ${r.name}님, ${r.date} 식사 등록이 완료되었습니다.`, "success");
      empI.value = ""; nameI.value = ""; empI.blur(); nameI.blur();
      $("#untagList").scrollTop = 0;
    } catch (err) { st(s, err.message, "error"); if (err.field) (err.field === "emp" ? empI : nameI).focus(); }
    finally { btn.disabled = false; btn.textContent = "등록"; }
  });
  async function loadToday() {
    const listEl = $("#untagList"); if (!listEl) return;
    let d;
    try { d = await apiGet("/untag/today"); }
    catch (err) { listEl.innerHTML = `<div class="untag-empty"><div class="icon">⚠️</div>목록을 불러오지 못했습니다.</div>`; return; }
    const set = (sel, v, html) => { const el = $(sel); if (el) el[html ? "innerHTML" : "textContent"] = v; };
    set("#untagTodayLabel", `오늘(${d.date.slice(5).replace("-", "/")}) 등록 현황`);
    set("#untagCount", `${d.count}명`);
    set("#upDate", `${d.date.slice(0, 4)}년 ${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일`);
    set("#upCount", `오늘 등록 인원 <b>${d.count}명</b>`, true);
    listEl.innerHTML = d.items.length ? d.items.map((r, i) => `
      <div class="untag-row${r.id === lastNewId ? " new" : ""}"><span class="no">${d.count - i}</span><span>${escapeHtml(r.empNo)}</span><span>${escapeHtml(r.name)}</span></div>`).join("")
      : `<div class="untag-empty"><div class="icon">🍱</div>오늘 등록된 인원이 없습니다.</div>`;
    const more = $("#untagMore");
    if (more) { if (d.count > 10) { more.textContent = `↕ 목록을 스크롤하면 나머지 ${d.count - 10}명을 볼 수 있어요`; more.classList.remove("hidden"); } else more.classList.add("hidden"); }
    lastNewId = null;
  }
  /* 화면을 켜둔 채 날짜가 바뀌어도 새 날짜 목록으로 (5분마다 · 화면이 보일 때만) */
  setInterval(() => { if (document.visibilityState === "visible") loadToday(); }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadToday(); });

  /* 등록 팝업 (QR 주소 ?untag=1 로 접속 시 전체화면) */
  const popup = $("#untagPopup");
  function resetPopup() { $("#upForm").hidden = false; $("#upDone").hidden = true; $("#upEmpNo").value = ""; $("#upName").value = ""; st($("#upStatus"), ""); }
  if (popup) {
    on("#untagPopupBtn", "click", () => { resetPopup(); openModal("untagPopup"); });
    on("#upForm", "submit", async (e) => {
      e.preventDefault();
      const btn = $("#upSubmit"); if (btn.disabled) return;
      const empI = $("#upEmpNo"), nameI = $("#upName");
      btn.disabled = true; btn.textContent = "등록 중...";
      try {
        const r = await registerUntag(empI.value, nameI.value);
        empI.blur(); nameI.blur();
        $("#upDoneMsg").textContent = `${r.name}님, 등록 완료!`;
        $("#upDoneSub").textContent = `${r.date} 식사가 등록되었습니다.`;
        $("#upForm").hidden = true; $("#upDone").hidden = false;
      } catch (err) { st($("#upStatus"), err.message, "error"); if (err.field) (err.field === "emp" ? empI : nameI).focus(); }
      finally { btn.disabled = false; btn.textContent = "등록하기"; }
    });
    on("#upAgain", "click", () => { resetPopup(); $("#upEmpNo").focus(); });
    on("#upClose", "click", () => { if (isPopupMode) resetPopup(); else closeModal("untagPopup"); });
    if (isPopupMode) {
      document.body.classList.add("untag-only");
      popup.classList.add("open");
      $("#upClose").textContent = "처음으로";
      document.title = "사원증 미태그 식사등록";
      new MutationObserver(() => { if (!popup.classList.contains("open")) popup.classList.add("open"); }).observe(popup, { attributes: true, attributeFilter: ["class"] });
      document.body.classList.remove("modal-open");
    }
  }

  /* ======================= ③ 관리: 미태그 식사기록 ======================= */
  let adminCode = null, adminRows = [];
  function drawQr(canvas, url) { try { MiniQR.toCanvas(url, canvas, 8); return true; } catch (e) { return false; } }
  window.UntagQR = { popupUrl, drawQr };

  function renderAdminLocked() {
    const body = $("#untagAdminBody"); if (!body) return;
    if (window.__adminCode) { adminCode = window.__adminCode; renderAdminShell(); refreshAdmin(); return; }
    body.innerHTML = `<div class="ut-lock"><div class="icon">🔒</div>사번·이름이 포함된 개인정보라 <b>인증 후</b> 볼 수 있습니다.<br><br>
      <button type="button" class="btn btn-primary btn-sm" id="utUnlockBtn">인증하고 보기</button></div>`;
    $("#utUnlockBtn").addEventListener("click", async () => {
      const code = await verifyPasscodeAndGet("미태그 식사기록 조회", "개인정보 보호를 위해 인증코드를 입력해주세요.");
      if (!code) return; adminCode = code; renderAdminShell(); await refreshAdmin();
    });
  }
  function renderAdminShell() {
    $("#untagAdminBody").innerHTML = `
      <div class="settings-note">사원 화면은 <b>매일 0시에 새로 시작</b>되지만, 여기 기록은 그대로 보관됩니다.<br>
        관리자가 지우지 않아도 <b>3개월이 지난 기록은 자동 삭제</b>됩니다. (현재 기준: <b id="utPurgeBase">-</b> 이전 기록)</div>
      <div class="ut-summary">
        <div class="ut-card"><div class="l">전체 보관</div><div class="n" id="utTotal">0</div></div>
        <div class="ut-card"><div class="l">조회 결과</div><div class="n" id="utFiltered">0</div></div>
        <div class="ut-card"><div class="l">오늘 등록</div><div class="n" id="utToday">0</div></div>
      </div>
      <div class="ut-filter">
        <input type="date" id="utFrom" aria-label="시작일"> ~ <input type="date" id="utTo" aria-label="종료일">
        <button type="button" class="btn btn-ghost btn-sm" id="utThisMonth">이번 달</button>
        <button type="button" class="btn btn-ghost btn-sm" id="utAllRange">전체 기간</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-primary btn-sm" id="utExportBtn">⬇ 엑셀 다운로드</button>
      </div>
      <div class="ut-table-wrap"><table class="ut-table">
        <thead><tr><th class="chk"><input type="checkbox" id="utChkAll" aria-label="전체 선택"></th><th>사번</th><th>이름</th><th>날짜</th><th>등록시각</th></tr></thead>
        <tbody id="utBody"></tbody></table></div>
      <div class="ut-qr">
        <canvas id="utQrCanvas" width="170" height="170" aria-label="등록 팝업 QR코드"></canvas>
        <div>
          <h4>📱 등록 팝업 QR코드</h4>
          <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:6px">구내식당에 붙여둘 QR입니다. 찍으면 <b>사번·이름 등록 팝업</b>이 바로 열려요.</div>
          <input type="text" id="utQrUrl" aria-label="팝업 주소">
          <div id="utQrWarn"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost btn-sm" id="utQrCopy">주소 복사</button>
            <button type="button" class="btn btn-ghost btn-sm" id="utQrOpen">팝업 주소 열기</button>
            <button type="button" class="btn btn-primary btn-sm" id="utQrSave">QR 이미지 저장</button>
          </div>
        </div>
      </div>
      <div class="ut-danger"><h4>🗑 데이터 삭제</h4><div class="btn-row">
        <button type="button" class="btn btn-danger btn-sm" id="utDelSel">선택 삭제</button>
        <button type="button" class="btn btn-danger btn-sm" id="utDelRange">조회 결과 전체 삭제</button>
        <button type="button" class="btn btn-danger btn-sm" id="utDelAll">전체 데이터 리셋</button></div></div>
      <div id="utStatus"></div>`;
    $("#utFrom").addEventListener("change", refreshAdmin);
    $("#utTo").addEventListener("change", refreshAdmin);
    $("#utAllRange").addEventListener("click", () => { $("#utFrom").value = ""; $("#utTo").value = ""; refreshAdmin(); });
    $("#utThisMonth").addEventListener("click", () => { const t = todayKST(); $("#utFrom").value = t.slice(0, 8) + "01"; $("#utTo").value = t; refreshAdmin(); });
    $("#utChkAll").addEventListener("change", (e) => $all("#utBody input[type=checkbox]").forEach((c) => { c.checked = e.target.checked; }));
    $("#utExportBtn").addEventListener("click", exportExcel);
    $("#utDelSel").addEventListener("click", () => {
      const ids = $all("#utBody input[type=checkbox]:checked").map((c) => c.value);
      if (!ids.length) { st($("#utStatus"), "삭제할 기록을 선택해주세요.", "error"); return; }
      if (!confirm(`선택한 ${ids.length}건을 삭제할까요? 되돌릴 수 없습니다.`)) return; doDelete({ ids });
    });
    $("#utDelRange").addEventListener("click", () => {
      if (!adminRows.length) { st($("#utStatus"), "조회된 기록이 없습니다.", "error"); return; }
      if (!confirm(`조회 결과 ${adminRows.length}건을 모두 삭제할까요?\n되돌릴 수 없습니다.`)) return;
      doDelete({ ids: adminRows.map((r) => r.id) });
    });
    $("#utDelAll").addEventListener("click", () => {
      const total = Number($("#utTotal").textContent) || 0;
      if (!total) { st($("#utStatus"), "삭제할 기록이 없습니다.", "error"); return; }
      if (!confirm(`보관 중인 전체 ${total}건을 리셋합니다.\n엑셀로 먼저 백업하는 것을 권장합니다. 계속할까요?`)) return;
      if (prompt('정말 삭제하려면 "전체삭제"라고 입력하세요.') !== "전체삭제") { st($("#utStatus"), "입력이 일치하지 않아 취소되었습니다.", "error"); return; }
      doDelete({ all: true });
    });
    const qrIn = $("#utQrUrl");
    const redraw = () => {
      const u = qrIn.value.trim(), warn = $("#utQrWarn");
      if (!/^https?:\/\//.test(u)) warn.innerHTML = `<div class="warn">http(s)로 시작하는 실제 사이트 주소여야 휴대폰에서 열려요.</div>`;
      else if (/\/\/(localhost|127\.)/.test(u)) warn.innerHTML = `<div class="warn">localhost 주소는 휴대폰에서 열리지 않아요.</div>`;
      else warn.innerHTML = "";
      drawQr($("#utQrCanvas"), u || " ");
    };
    qrIn.value = popupUrl(); qrIn.addEventListener("input", redraw); redraw();
    $("#utQrCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(qrIn.value); st($("#utStatus"), "주소를 복사했습니다.", "success"); } catch (e) { prompt("아래 주소를 복사하세요", qrIn.value); } });
    $("#utQrOpen").addEventListener("click", () => window.open(qrIn.value, "_blank"));
    $("#utQrSave").addEventListener("click", () => {
      const src = $("#utQrCanvas"), pad = 40, cv = document.createElement("canvas");
      cv.width = src.width + pad * 2; cv.height = src.height + pad * 2 + 70;
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, pad, pad);
      g.fillStyle = "#9C1E22"; g.textAlign = "center"; g.font = "bold 26px 'Malgun Gothic', sans-serif";
      g.fillText("사원증 미태그 식사등록", cv.width / 2, src.height + pad + 40);
      const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "사원증미태그_식사등록_QR.png"; a.click();
    });
  }
  async function refreshAdmin() {
    if (!adminCode || !$("#utBody")) return;
    let d;
    try { d = await apiPost("/untag/admin/list", { code: adminCode, from: $("#utFrom").value, to: $("#utTo").value }); }
    catch (err) { st($("#utStatus"), "불러오지 못했습니다: " + err.message, "error"); return; }
    adminRows = d.items;
    $("#utPurgeBase").textContent = d.purgeBefore; $("#utTotal").textContent = d.total;
    $("#utFiltered").textContent = d.items.length; $("#utToday").textContent = d.today; $("#utChkAll").checked = false;
    $("#utBody").innerHTML = d.items.length ? d.items.map((r) => `<tr><td class="chk"><input type="checkbox" value="${escapeHtml(r.id)}" aria-label="선택"></td>
      <td>${escapeHtml(r.empNo)}</td><td>${escapeHtml(r.name)}</td><td>${r.date}</td><td>${timeOf(r.at)}</td></tr>`).join("")
      : `<tr><td colspan="5"><div class="empty-mini">기록이 없습니다.</div></td></tr>`;
  }
  async function doDelete(payload) {
    try { const r = await apiPost("/untag/admin/delete", { code: adminCode, ...payload }); await refreshAdmin(); await loadToday(); st($("#utStatus"), `${r.deleted}건 삭제했습니다.`, "success"); }
    catch (err) { st($("#utStatus"), "삭제에 실패했습니다: " + err.message, "error"); }
  }
  on("#settingsBtn", "click", () => { adminCode = null; adminRows = []; renderAdminLocked(); });
  renderAdminLocked();

  /* admin.js 상단 관리자 메뉴에 버튼 추가 (admin.js 수정 없이) */
  new MutationObserver((_, obs) => {
    const bar = $("#adminBar"); if (!bar || $("[data-pane='untag']", bar)) return;
    const ref = $("[data-pane='code']", bar);
    [["untag", "🪪 미태그 식사기록"], ["guest", "🍽 외부인 식사신청"]].forEach(([pane, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.pane = pane; b.textContent = label;
      if (ref) ref.before(b); else bar.appendChild(b);
    });
    obs.disconnect();
  }).observe(document.body, { childList: true });

  /* 엑셀(.xlsx): 사번 / 이름 / 날짜 */
  function exportExcel() {
    if (!adminRows.length) { st($("#utStatus"), "다운로드할 기록이 없습니다.", "error"); return; }
    const rows = adminRows.slice().sort((a, b) => (a.date === b.date ? (a.at < b.at ? -1 : 1) : (a.date < b.date ? -1 : 1)));
    const blob = buildXlsx("미태그 식사기록", ["사번", "이름", "날짜"], rows.map((r) => [r.empNo, r.name, r.date]));
    const f = $("#utFrom").value, t = $("#utTo").value, a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `사원증미태그_식사기록_${f || "전체"}${t ? "~" + t : ""}.xlsx`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    st($("#utStatus"), `${rows.length}건을 엑셀로 내보냈습니다.`, "success");
  }
  function buildXlsx(sheetName, header, data) {
    const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const col = (i) => String.fromCharCode(65 + i);
    const row = (cells, r, s) => `<row r="${r}">${cells.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t>${x(v)}</t></is></c>`).join("")}</row>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/></cols><sheetData>${row(header, 1, 1)}${data.map((d, i) => row(d, i + 2)).join("")}</sheetData><autoFilter ref="A1:C${data.length + 1}"/></worksheet>`;
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${x(sheetName)}'!$A$1:$C$${data.length + 1}</definedName></definedNames></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7E9E9"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": sheet };
    return new Blob([zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, db.length, true); lh.setUint32(22, db.length, true); lh.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(lh.buffer), nb, db);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, db.length, true); ch.setUint32(24, db.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb); offset += 30 + nb.length + db.length;
    }
    const cd = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22)), n = Object.keys(files).length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, n, true); end.setUint16(10, n, true); end.setUint32(12, cd, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
  }

  /* ============================================================
     ④ 외부인 식사 신청  (v6 · 식사일자 추가 · 관리자 삭제 · 메일 기능 없음)
       · [＋ 신청하기] → 팝업(사번·이름·부서·외부업체·식사인원수·식사일자·방문사유) → 신청
       · 신청 목록: 최신 신청이 맨 위 · 표 안에서 휠/손가락 스크롤 · 식사일자 열 표시
       · 관리: 설정/관리자 메뉴 → "🍽 외부인 식사신청"
         (전체 이력 · 신청 시간 · 식사일자 · 승인/승인취소 · 선택/조회결과/전체 삭제)
     ============================================================ */
  const GUEST_ADMIN_PARAM = "guest";
  const guestAdminUrl = () => location.href.split(/[?#]/)[0] + "?admin=" + GUEST_ADMIN_PARAM;
  const dtOf = (iso) => { try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return ""; } };
  const mealDateOf = (d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return "-";
    const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(d + "T00:00:00Z").getUTCDay()];
    return `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${w})`;
  };
  const statusBadge = (s) => s === "approved" ? `<span class="gm-badge ok">승인</span>` : s === "rejected" ? `<span class="gm-badge no">반려</span>` : `<span class="gm-badge wait">대기</span>`;

  /* index.html 수정 없이: 식사일자 입력칸 · 목록 열 · 화면 스타일 추가 */
  (function addGuestMealDateUi() {
    const th = $("#gmListBody") && $("#gmListBody").closest("table").querySelector("thead tr");
    if (th && !th.querySelector(".gm-th-date")) th.insertAdjacentHTML("afterbegin", `<th class="gm-th-date">식사일자</th>`);
    const countField = $("#gmCountInput") && $("#gmCountInput").closest(".up-field");
    if (countField && !$("#gmMealDate")) {
      countField.insertAdjacentHTML("afterend", `
        <div class="up-field"><label for="gmMealDate">식사일자</label><input type="date" id="gmMealDate" required></div>`);
    }
  })();
  const todayStr = todayKST;

  async function loadGuestList() {
    const body = $("#gmListBody"); if (!body) return;
    let d;
    try { d = await apiGet("/guest-meal/list"); }
    catch (err) { body.innerHTML = `<tr><td colspan="8"><div class="gm-empty">⚠️ 목록을 불러오지 못했습니다.</div></td></tr>`; return; }
    $("#gmCount").textContent = `${d.count}건`;
    body.innerHTML = d.items.length ? d.items.map((r) => `
      <tr${r.id === window.__gmNewId ? ' class="new"' : ""}>
        <td class="date">${mealDateOf(r.mealDate)}</td>
        <td>${escapeHtml(r.empNo)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.dept)}</td>
        <td>${escapeHtml(r.company)}</td><td class="num">${Number(r.count) || 0}명</td>
        <td class="reason" title="${escapeHtml(r.reason)}">${escapeHtml(r.reason)}</td><td>${statusBadge(r.status)}</td>
      </tr>`).join("")
      : `<tr><td colspan="8"><div class="gm-empty">🍽 아직 신청 내역이 없습니다.</div></td></tr>`;
    window.__gmNewId = null;
  }

  /* 신청 팝업 */
  function resetGuestForm() {
    $("#gmForm").reset(); $("#gmForm").hidden = false; $("#gmDone").hidden = true; st($("#gmStatus"), "");
    $("#gmCountInput").value = "1";
    const md = $("#gmMealDate"); if (md) { md.value = todayStr(); md.min = todayStr(); }
  }
  $("#gmOpenBtn").addEventListener("click", () => { resetGuestForm(); openModal("guestMealModal"); setTimeout(() => $("#gmEmpNo").focus(), 80); });
  $("#gmDoneClose").addEventListener("click", () => closeModal("guestMealModal"));
  $("#gmForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#gmSubmit"); if (btn.disabled) return;
    const v = {
      empNo: $("#gmEmpNo").value.replace(/\s/g, ""), name: $("#gmName").value.trim(), dept: $("#gmDept").value.trim(),
      company: $("#gmCompany").value.trim(), count: parseInt($("#gmCountInput").value, 10),
      mealDate: ($("#gmMealDate") ? $("#gmMealDate").value : ""), reason: $("#gmReason").value.trim(),
    };
    const fail = (msg, id) => { st($("#gmStatus"), msg, "error"); if (id) $(id).focus(); };
    if (!/^[A-Za-z0-9]{3,12}$/.test(v.empNo)) return fail("사번은 영문/숫자 3~12자로 입력해주세요.", "#gmEmpNo");
    if (!v.name) return fail("이름을 입력해주세요.", "#gmName");
    if (!v.dept) return fail("부서를 입력해주세요.", "#gmDept");
    if (!v.company) return fail("외부업체명을 입력해주세요.", "#gmCompany");
    if (!Number.isFinite(v.count) || v.count < 1 || v.count > 100) return fail("식사 인원수는 1~100명으로 입력해주세요.", "#gmCountInput");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.mealDate)) return fail("식사일자를 선택해주세요.", "#gmMealDate");
    if (v.mealDate < todayStr()) return fail("식사일자는 오늘 이후 날짜로 선택해주세요.", "#gmMealDate");
    if (!v.reason) return fail("방문 사유를 입력해주세요.", "#gmReason");
    btn.disabled = true; btn.textContent = "신청 중...";
    try {
      const r = await apiPost("/guest-meal", v);
      window.__gmNewId = r.id;
            $("#gmDoneMsg").textContent = `${v.name}님, 외부인 식사 신청이 완료되었습니다.`;
      $("#gmDoneSub").textContent = `식사일자 ${mealDateOf(v.mealDate)} · 관리자가 승인하면 목록의 '승인여부'가 바뀝니다.`;
      $("#gmForm").hidden = true; $("#gmDone").hidden = false;
      await loadGuestList();
      const wrap = $("#gmListWrap"); if (wrap) wrap.scrollTop = 0;
    } catch (err) { fail(err.message); }
    finally { btn.disabled = false; btn.textContent = "신청하기"; }
  });

  /* 관리: 외부인 식사신청 탭 */
  let gmAdminCode = null, gmRows = [], gmFilter = "all";
  function renderGuestAdminLocked() {
    if (window.__adminCode) { gmAdminCode = window.__adminCode; renderGuestAdminShell(); refreshGuestAdmin(); return; }
    $("#guestAdminBody").innerHTML = `<div class="ut-lock"><div class="icon">🔒</div>신청자 개인정보가 포함되어 <b>인증 후</b> 볼 수 있습니다.<br><br>
      <button type="button" class="btn btn-primary btn-sm" id="gmUnlockBtn">인증하고 보기</button></div>`;
    $("#gmUnlockBtn").addEventListener("click", async () => {
      const code = await verifyPasscodeAndGet("외부인 식사신청 관리", "인증코드를 입력해주세요.");
      if (!code) return; gmAdminCode = code; renderGuestAdminShell(); await refreshGuestAdmin();
    });
  }
  function renderGuestAdminShell() {
    $("#guestAdminBody").innerHTML = `
      <div class="settings-note">외부인 식사신청 <b>전체 이력</b>입니다. 신청 시간은 자동으로 기록되며, [승인]을 누르면 신청자 화면의 승인여부가 바로 바뀝니다.</div>
      <div class="ut-summary">
        <div class="ut-card"><div class="l">전체 신청</div><div class="n" id="gmTotal">0</div></div>
        <div class="ut-card"><div class="l">승인 대기</div><div class="n" id="gmWait">0</div></div>
        <div class="ut-card"><div class="l">승인 완료</div><div class="n" id="gmOk">0</div></div>
      </div>
      <div class="ut-filter">
        <div class="gm-seg" role="tablist">
          <button type="button" data-f="all" class="active">전체</button>
          <button type="button" data-f="pending">대기</button>
          <button type="button" data-f="approved">승인</button>
        </div>
        <div class="gm-date-filter">식사일자
          <input type="date" id="gmFrom" aria-label="식사일자 시작"> ~ <input type="date" id="gmTo" aria-label="식사일자 끝">
          <button type="button" class="btn btn-ghost btn-sm" id="gmDateClear">전체 기간</button>
        </div>
        <span class="grow"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="gmRefresh">🔄 새로고침</button>
      </div>
      <div class="ut-table-wrap gm-admin-wrap"><table class="ut-table gm-admin-table">
        <thead><tr><th class="chk"><input type="checkbox" id="gmChkAll" aria-label="전체 선택"></th><th>신청 시간</th><th>식사일자</th><th>사번</th><th>이름</th><th>부서</th><th>외부업체</th><th>인원</th><th>방문사유</th><th>승인여부</th><th>처리</th></tr></thead>
        <tbody id="gmAdminBody"></tbody></table></div>
      <div class="ut-danger"><h4>🗑 신청 데이터 삭제</h4><div class="btn-row">
        <button type="button" class="btn btn-danger btn-sm" id="gmDelSel">선택 삭제</button>
        <button type="button" class="btn btn-danger btn-sm" id="gmDelShown">조회 결과 전체 삭제</button>
        <button type="button" class="btn btn-danger btn-sm" id="gmDelAll">전체 데이터 리셋</button></div></div>
      <div id="gmAdminStatus"></div>`;
    $all(".gm-seg button").forEach((b) => b.addEventListener("click", () => {
      gmFilter = b.dataset.f; $all(".gm-seg button").forEach((x) => x.classList.toggle("active", x === b)); drawGuestAdmin();
    }));
    $("#gmFrom").addEventListener("change", drawGuestAdmin);
    $("#gmTo").addEventListener("change", drawGuestAdmin);
    $("#gmDateClear").addEventListener("click", () => { $("#gmFrom").value = ""; $("#gmTo").value = ""; drawGuestAdmin(); });
    $("#gmRefresh").addEventListener("click", refreshGuestAdmin);
    $("#gmChkAll").addEventListener("change", (e) => $all("#gmAdminBody input[type=checkbox]").forEach((c) => { c.checked = e.target.checked; }));
    $("#gmAdminBody").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-gm]"); if (!b) return;
      const approve = b.dataset.gm === "approve";
      b.disabled = true;
      try {
        await apiPost("/guest-meal/admin/approve", { code: gmAdminCode, id: b.dataset.id, approved: approve });
        st($("#gmAdminStatus"), approve ? "승인했습니다." : "승인을 취소했습니다.", "success");
        await refreshGuestAdmin(); loadGuestList();
      } catch (err) { st($("#gmAdminStatus"), "처리에 실패했습니다: " + err.message, "error"); b.disabled = false; }
    });
    $("#gmDelSel").addEventListener("click", () => {
      const ids = $all("#gmAdminBody input[type=checkbox]:checked").map((c) => c.value);
      if (!ids.length) { st($("#gmAdminStatus"), "삭제할 신청 건을 선택해주세요.", "error"); return; }
      if (!confirm(`선택한 ${ids.length}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      deleteGuest({ ids });
    });
    $("#gmDelShown").addEventListener("click", () => {
      const rows = filteredGuestRows();
      if (!rows.length) { st($("#gmAdminStatus"), "조회된 신청 건이 없습니다.", "error"); return; }
      if (!confirm(`지금 표에 보이는 ${rows.length}건을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
      deleteGuest({ ids: rows.map((r) => r.id) });
    });
    $("#gmDelAll").addEventListener("click", () => {
      if (!gmRows.length) { st($("#gmAdminStatus"), "삭제할 신청 건이 없습니다.", "error"); return; }
      if (!confirm(`외부인 식사신청 전체 ${gmRows.length}건을 리셋합니다. 계속할까요?`)) return;
      if (prompt('정말 삭제하려면 "전체삭제"라고 입력하세요.') !== "전체삭제") { st($("#gmAdminStatus"), "입력이 일치하지 않아 취소되었습니다.", "error"); return; }
      deleteGuest({ all: true });
    });
  }
  async function deleteGuest(payload) {
    try {
      const r = await apiPost("/guest-meal/admin/delete", { code: gmAdminCode, ...payload });
      await refreshGuestAdmin(); loadGuestList();
      st($("#gmAdminStatus"), `${r.deleted}건 삭제했습니다.`, "success");
    } catch (err) { st($("#gmAdminStatus"), "삭제에 실패했습니다: " + err.message, "error"); }
  }
  async function refreshGuestAdmin() {
    if (!gmAdminCode || !$("#gmAdminBody")) return;
    let d;
    try { d = await apiPost("/guest-meal/admin/list", { code: gmAdminCode }); }
    catch (err) { st($("#gmAdminStatus"), "불러오지 못했습니다: " + err.message, "error"); return; }
    gmRows = d.items || [];
    $("#gmTotal").textContent = gmRows.length;
    $("#gmWait").textContent = gmRows.filter((r) => r.status !== "approved").length;
    $("#gmOk").textContent = gmRows.filter((r) => r.status === "approved").length;
    drawGuestAdmin();
  }
  function filteredGuestRows() {
    const f = $("#gmFrom") ? $("#gmFrom").value : "", t = $("#gmTo") ? $("#gmTo").value : "";
    return gmRows.filter((r) => (gmFilter === "all" || (gmFilter === "approved" ? r.status === "approved" : r.status !== "approved"))
      && (!f || (r.mealDate || "") >= f) && (!t || ((r.mealDate || "") && r.mealDate <= t)));
  }
  function drawGuestAdmin() {
    const rows = filteredGuestRows();
    if ($("#gmChkAll")) $("#gmChkAll").checked = false;
    $("#gmAdminBody").innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td class="chk"><input type="checkbox" value="${escapeHtml(r.id)}" aria-label="선택"></td>
        <td class="nowrap">${dtOf(r.createdAt)}</td><td class="date">${mealDateOf(r.mealDate)}</td>
        <td>${escapeHtml(r.empNo)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.dept)}</td>
        <td>${escapeHtml(r.company)}</td><td class="num">${Number(r.count) || 0}명</td><td class="reason-full">${escapeHtml(r.reason)}</td>
        <td>${statusBadge(r.status)}${r.approvedAt ? `<div class="gm-sub">${dtOf(r.approvedAt)}</div>` : ""}</td>
        <td>${r.status === "approved"
          ? `<button type="button" class="btn btn-ghost btn-sm" data-gm="cancel" data-id="${escapeHtml(r.id)}">승인 취소</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-gm="approve" data-id="${escapeHtml(r.id)}">승인</button>`}</td>
      </tr>`).join("")
      : `<tr><td colspan="11"><div class="empty-mini">해당하는 신청이 없습니다.</div></td></tr>`;
  }
  $("#settingsBtn").addEventListener("click", () => { gmAdminCode = null; gmRows = []; renderGuestAdminLocked(); });
  renderGuestAdminLocked();

  /* 관리자 링크(?admin=guest)로 들어온 경우: 관리자 로그인 후 '외부인 식사신청' 탭을 바로 엶 */
  if (new URLSearchParams(location.search).get("admin") === GUEST_ADMIN_PARAM) {
    const openGuestPane = () => {
      $("#settingsBtn").click();
      const tab = $('#settingsModal .settings-tabs button[data-pane="guest"]'); if (tab) tab.click();
    };
    if (document.body.classList.contains("is-admin")) setTimeout(openGuestPane, 300);
    else new MutationObserver((_, obs) => {
      if (!document.body.classList.contains("is-admin")) return;
      obs.disconnect(); setTimeout(openGuestPane, 300);
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  loadGuestList();
  setInterval(() => { if (document.visibilityState === "visible" && $("#mb-guest").classList.contains("active")) loadGuestList(); }, 5 * 60 * 1000);

  /* ======================= ⑤ 샐러드 댓글 비밀번호 ======================= */
  let pendingCommentPw = "";
  const origFetch = window.fetch.bind(window);
  /* 댓글 등록 요청(/api/comments POST)에 비밀번호를 함께 담아 보냄 */
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input.url;
      const method = ((init && init.method) || "GET").toUpperCase();
      if (method === "POST" && /^\/api\/comments\/?$/.test(url) && init && init.body) {
        const body = JSON.parse(init.body);
        body.password = pendingCommentPw;
        return origFetch(input, { ...init, body: JSON.stringify(body) }).then((res) => {
          if (res.ok) { const pw = $("#commentPwInput"); if (pw) pw.value = ""; }
          return res;
        });
      }
    } catch (e) {}
    return origFetch(input, init);
  };
  function enhanceCommentForm() {
    const form = $("#commentForm");
    if (!form || $("#commentPwInput", form)) return;
    const author = $("#commentAuthorInput", form);
    if (!author) return;
    const pw = document.createElement("input");
    pw.type = "password"; pw.id = "commentPwInput"; pw.className = "comment-pw-input";
    pw.maxLength = 4; pw.inputMode = "numeric"; pw.autocomplete = "new-password";
    pw.placeholder = "비밀번호 4자리"; pw.setAttribute("aria-label", "댓글 비밀번호 숫자 4자리");
    pw.addEventListener("input", () => { pw.value = pw.value.replace(/\D/g, "").slice(0, 4); });
    const col = document.createElement("div"); col.className = "comment-id-col";
    author.replaceWith(col); col.append(author, pw);
    const hint = $(".comment-hint", form);
    if (hint) hint.innerHTML = "누구나 자유롭게 댓글을 남길 수 있어요. <b>비밀번호 4자리</b>는 댓글을 지울 때 필요해요.";
  }
  const detailBody = $("#postDetailBody");
  if (detailBody) new MutationObserver(enhanceCommentForm).observe(detailBody, { childList: true, subtree: true });
  enhanceCommentForm();
  document.addEventListener("submit", (e) => {
    if (!e.target || e.target.id !== "commentForm") return;
    const pw = $("#commentPwInput"); const v = pw ? pw.value.trim() : "";
    if (!/^\d{4}$/.test(v)) {
      e.preventDefault(); e.stopImmediatePropagation();
      st($("#commentFormStatus"), "댓글 비밀번호를 숫자 4자리로 입력해주세요. (댓글을 지울 때 필요해요)", "error");
      if (pw) pw.focus();
      return;
    }
    pendingCommentPw = v;
  }, true);

  /* 비밀번호 입력 창 */
  function askCommentPw() {
    return new Promise((resolve) => {
      let m = $("#cmPwModal");
      if (!m) {
        m = document.createElement("div"); m.id = "cmPwModal"; m.className = "modal-overlay";
        m.innerHTML = `<div class="modal-box"><h3>댓글 삭제</h3>
          <p class="desc">댓글을 쓸 때 정한 <b>비밀번호 4자리</b>를 입력해주세요.<br>(관리자는 인증코드 입력)</p>
          <input type="password" id="cmPwInput" inputmode="numeric" autocomplete="off" maxlength="20" aria-label="댓글 비밀번호">
          <div class="btn-row"><button type="button" class="btn btn-ghost" id="cmPwCancel">취소</button><button type="button" class="btn btn-danger" id="cmPwOk">삭제</button></div></div>`;
        document.body.appendChild(m);
      }
      const inp = $("#cmPwInput", m); inp.value = "";
      m.classList.add("open"); setTimeout(() => inp.focus(), 50);
      const done = (v) => { m.classList.remove("open"); $("#cmPwOk", m).onclick = $("#cmPwCancel", m).onclick = inp.onkeydown = m.onclick = null; resolve(v); };
      $("#cmPwOk", m).onclick = () => done(inp.value.trim() || null);
      $("#cmPwCancel", m).onclick = () => done(null);
      m.onclick = (e) => { if (e.target === m) done(null); };
      inp.onkeydown = (e) => { if (e.key === "Enter") done(inp.value.trim() || null); if (e.key === "Escape") done(null); };
    });
  }
  /* 삭제: 비밀번호 4자리(또는 관리자 인증코드) */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest && e.target.closest(".comment-del-btn");
    if (!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const password = window.__adminCode || await askCommentPw();
    if (!password) return;
    btn.disabled = true;
    try { await apiDelete(`/comments?id=${encodeURIComponent(btn.dataset.id)}&code=${encodeURIComponent(password)}`); }
    catch (err) { alert(err.message); btn.disabled = false; return; }
    const item = btn.closest(".comment-item"), list = $("#commentList");
    if (item) item.remove();
    const n = list ? $all(".comment-item", list).length : 0;
    const label = $("#commentCountLabel"); if (label) label.textContent = `댓글 ${n}개`;
    if (list && !n) list.innerHTML = `<div class="comment-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</div>`;
  }, true);

  window.MealModule = { loadMealPhotos, loadToday, loadGuestList, refreshAdmin: () => { refreshAdmin(); refreshGuestAdmin(); } };
  const note = $(".gm-side-note"); if (note) note.innerHTML = "신청 후 관리자가 승인하면 신청 목록의 <b>승인여부</b>가 바뀝니다.";
  loadMealPhotos();
  loadToday();
})();


/* ============================================================
   ★ QR 등록 화면 탭 (meal.js v7.1 추가분 · meal.js 맨 끝에 붙여넣기)
   ------------------------------------------------------------
   · QR 주소(사이트주소/?untag=1)로 들어오면 카드 맨 위에
     [🪪 사원증 미태그] [🍽 외부인 식사 신청] 선택 버튼이 생김
   · 버튼을 누르면 그에 맞는 입력 화면으로 바뀜
   · 외부인 탭으로 바로 여는 주소: 사이트주소/?untag=1&tab=guest
   ============================================================ */
(function () {
  "use strict";
  if (window.__qrTabsInstalled) return;
  if (!new URLSearchParams(location.search).has("untag")) return;   // QR 주소일 때만
  const untagPopup = document.getElementById("untagPopup");
  const guestModal = document.getElementById("guestMealModal");
  const openBtn = document.getElementById("gmOpenBtn");
  if (!untagPopup || !guestModal || !openBtn) return;
  window.__qrTabsInstalled = true;

  /* 화면 스타일 */
  const css = document.createElement("style");
  css.textContent = `
    .qr-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; background: #fff; border-bottom: 1px solid var(--border); }
    .qr-tabs button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 46px; border: 1.5px solid var(--border); background: #FAF8F6; color: var(--text-muted); border-radius: 11px; font-size: 14.5px; font-weight: 800; font-family: inherit; cursor: pointer; }
    .qr-tabs button.active { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: 0 3px 10px rgba(156,30,34,.25); }
    html body.untag-only.qr-guest > #untagPopup { display: none !important; }
    html body.untag-only.qr-guest > #guestMealModal {
      display: flex !important; position: static; background: transparent; inset: auto;
      padding: 24px 14px calc(24px + env(safe-area-inset-bottom));
      min-height: 100vh; min-height: 100dvh; align-items: center; justify-content: center; overflow: visible;
    }
    body.untag-only #guestMealModal .modal-box, body.untag-only #untagPopup .modal-box { max-width: 460px; }
    body.untag-only #guestMealModal .modal-box { box-shadow: 0 10px 34px rgba(43,36,34,.15); margin: 0 auto; max-height: none; overflow: visible; }
    body.untag-only #guestMealModal .modal-close { display: none; }
    @media (max-width: 640px) {
      html body.untag-only.qr-guest > #guestMealModal { align-items: flex-start; padding: 10px 8px calc(24px + env(safe-area-inset-bottom)); }
      body.untag-only #untagPopup { align-items: flex-start; padding-top: 10px; }
      .qr-tabs button { font-size: 13.5px; }
    }`;
  document.head.appendChild(css);

  /* 선택 버튼 */
  const tabs = document.createElement("div");
  tabs.className = "qr-tabs"; tabs.setAttribute("role", "tablist");
  tabs.innerHTML = `
    <button type="button" role="tab" data-qr="untag">🪪 사원증 미태그</button>
    <button type="button" role="tab" data-qr="guest">🍽 외부인 식사 신청</button>`;

  let mode = null;
  function show(next) {
    if (mode === next) return;
    mode = next;
    const box = (next === "guest" ? guestModal : untagPopup).querySelector(".modal-box");
    box.prepend(tabs);                                   // 지금 보이는 카드 맨 위로 이동
    tabs.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.qr === next; b.classList.toggle("active", on); b.setAttribute("aria-selected", on);
    });
    document.body.classList.toggle("qr-guest", next === "guest");
    if (next === "guest") {
      openBtn.click();                                   // 신청 화면 초기화 (식사일자 = 오늘)
      setTimeout(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }, 120);   // 모바일 키보드 자동으로 안 뜨게
      document.title = "외부인 식사 신청";
    } else {
      document.title = "사원증 미태그 식사등록";
    }
    document.body.classList.remove("modal-open");
    const u = new URL(location.href);
    if (next === "guest") u.searchParams.set("tab", "guest"); else u.searchParams.delete("tab");
    history.replaceState(null, "", u);
    window.scrollTo(0, 0);
  }
  tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-qr]"); if (b) show(b.dataset.qr); });

  /* 외부인 신청 화면: 닫히지 않게 유지 · [확인]을 누르면 새 신청 화면으로 */
  new MutationObserver(() => {
    if (mode === "guest" && !guestModal.classList.contains("open")) guestModal.classList.add("open");
  }).observe(guestModal, { attributes: true, attributeFilter: ["class"] });
  const doneBtn = document.getElementById("gmDoneClose");
  if (doneBtn) {
    doneBtn.textContent = "새로 신청하기";
    doneBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      openBtn.click(); window.scrollTo(0, 0);
    }, true);
  }
  guestModal.addEventListener("click", (e) => { if (e.target === guestModal) e.stopImmediatePropagation(); }, true);   // 바깥 눌러도 안 닫힘

  show(new URLSearchParams(location.search).get("tab") === "guest" ? "guest" : "untag");
})();

