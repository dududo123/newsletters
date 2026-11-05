/* ============================================================
   R&D본부 소식지 — 공지 배너 · 이벤트 신청/설문 · 좋아요 (community.js v1)
   ------------------------------------------------------------
   ① 공지 배너   : 상단에 공지 표시 (게시 기간이 지나면 자동으로 내려감)
   ② 신청 / 설문 : 공지에 "이벤트 신청" 또는 "설문"을 붙여서 바로 참여
   ③ 좋아요      : 소식지 사진 · 샐러드 글에 👍 (1인 1회, 다시 누르면 취소)
   ④ 관리        : 설정 → "📢 공지·설문" 탭에서 등록/수정/삭제, 응답 보기, 엑셀(CSV) 받기

   ※ app.js · news-enhance.js 는 수정하지 않습니다. 두 파일 다음에 불러오면 됩니다.
   ※ 모든 데이터는 서버(/cm-api)에 저장합니다. (브라우저 저장소 사용 안 함)
   ※ 멈춤 방지: 이벤트는 한 번만 등록, 좋아요 조회는 모아서 한 번에 요청,
                모든 서버 요청에 시간 제한(15초)과 중복 클릭 방지 적용
   ============================================================ */
(function () {
  "use strict";
  if (window.__communityInstalled) return;
  window.__communityInstalled = true;

  const CM_API = "/cm-api";
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fmtDate(d) { return d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (m, y, mo, da) => `${Number(mo)}/${Number(da)}`) : ""; }
  function fmtDateTime(iso) {
    try { const d = new Date(iso); return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function statusHtml(msg, type) { return msg ? `<div class="status-msg ${type}">${esc(msg)}</div>` : ""; }

  async function cmFetch(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(CM_API + path, {
        method: (options && options.method) || "GET",
        headers: { "Content-Type": "application/json" },
        body: options && options.body ? JSON.stringify(options.body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (res.status === 404 && !data) throw new Error("서버에 community.mjs 가 배포되지 않았습니다.");
      if (!res.ok) throw new Error((data && data.error) || `서버 오류 (${res.status})`);
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("서버 응답이 늦습니다. 잠시 후 다시 시도해주세요.");
      throw err;
    } finally { clearTimeout(timer); }
  }
  const cmGet = (p) => cmFetch(p);
  const cmPost = (p, body) => cmFetch(p, { method: "POST", body });

  /* ---------------- 스타일 ---------------- */
  const style = document.createElement("style");
  style.id = "community-style";
  style.textContent = `
  #cmNoticeArea { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
  #cmNoticeArea:empty { display:none; }
  .cm-notice { display:flex; align-items:center; gap:10px; padding:11px 14px; border-radius:12px;
    background:#FBF3EC; border:1px solid #E6C9A8; color:#5a3d22; font-size:13.5px; line-height:1.5; }
  .cm-notice.important { background:#FBEAE9; border-color:#f0c9c6; color:#7A1519; }
  .cm-notice-badge { flex-shrink:0; font-size:11.5px; font-weight:800; padding:3px 9px; border-radius:999px; background:#fff; border:1px solid currentColor; }
  .cm-notice-text { flex:1; min-width:0; font-weight:700; cursor:default; overflow:hidden; text-overflow:ellipsis; }
  .cm-notice-text.clickable { cursor:pointer; }
  .cm-notice-text.clickable:hover { text-decoration:underline; }
  .cm-notice-sub { font-weight:500; font-size:12px; opacity:.8; margin-left:6px; white-space:nowrap; }
  .cm-notice-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .cm-notice .btn-sm { padding:6px 12px; }
  .cm-notice .cm-done { background:#fff; color:#2e7d32; border:1px solid #a5d6a7; }
  .cm-notice-close { background:none; border:none; color:inherit; opacity:.6; font-size:15px; cursor:pointer; padding:2px 4px; }
  .cm-notice-close:hover { opacity:1; }
  @media (max-width:640px) {
    .cm-notice { flex-wrap:wrap; padding:10px 12px; }
    .cm-notice-text { flex-basis:calc(100% - 80px); white-space:normal; }
    .cm-notice-actions { width:100%; justify-content:flex-end; }
  }

  #cmFormModal { z-index:1100; }
  .cm-detail { white-space:pre-wrap; font-size:13.5px; line-height:1.7; color:var(--text, #2B2422); background:#fff;
    border:1px solid var(--border, #E6DFDA); border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .cm-meta { font-size:12.5px; color:var(--text-muted, #756B67); margin:-6px 0 12px; display:flex; flex-wrap:wrap; gap:8px; }
  .cm-meta b { color:var(--primary, #9C1E22); }
  .cm-options { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
  .cm-option { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--border, #E6DFDA);
    border-radius:10px; background:#fff; cursor:pointer; font-size:14px; }
  .cm-option:hover { border-color:var(--primary, #9C1E22); }
  .cm-option input { accent-color:var(--primary, #9C1E22); width:17px; height:17px; margin:0; }
  .cm-result { margin-bottom:14px; }
  .cm-result-row { margin-bottom:9px; font-size:13px; }
  .cm-result-head { display:flex; justify-content:space-between; margin-bottom:4px; }
  .cm-result-head .mine { color:var(--primary, #9C1E22); font-weight:800; }
  .cm-result-bar { height:9px; border-radius:999px; background:#EFE9E5; overflow:hidden; }
  .cm-result-bar span { display:block; height:100%; background:linear-gradient(90deg,#9C1E22,#C0474B); border-radius:999px; }
  .cm-mine-box { background:#EEF7EE; border:1px solid #c8e6c9; color:#2e5e30; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:12px; line-height:1.6; }

  .cm-like-btn { display:inline-flex; align-items:center; gap:5px; padding:7px 12px; border-radius:999px; cursor:pointer;
    border:1px solid var(--border, #E6DFDA); background:#fff; color:var(--text-muted, #756B67); font-size:12.5px; font-weight:700; font-family:inherit; }
  .cm-like-btn:hover { border-color:var(--primary, #9C1E22); color:var(--primary, #9C1E22); }
  .cm-like-btn.liked { background:#FBEAE9; border-color:#f0c9c6; color:var(--primary, #9C1E22); }
  .cm-like-btn .cm-like-icon { font-size:14px; line-height:1; transition:transform .15s; }
  .cm-like-btn.liked .cm-like-icon { transform:scale(1.15); }
  .cm-like-btn[disabled] { opacity:.7; cursor:wait; }
  .detail-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .detail-actions .cm-like-btn { margin-right:auto; }

  .cm-admin-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
  .cm-admin-list { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
  .cm-admin-item { background:#fff; border:1px solid var(--border, #E6DFDA); border-radius:12px; padding:11px 13px; }
  .cm-admin-item-top { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .cm-admin-title { flex:1; min-width:0; font-weight:700; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cm-tag { font-size:11px; font-weight:800; padding:2px 8px; border-radius:999px; flex-shrink:0; }
  .cm-tag.active { background:#EEF7EE; color:#2e7d32; }
  .cm-tag.scheduled { background:#E8F0FB; color:#1f5fa8; }
  .cm-tag.ended { background:#EFE9E5; color:#756B67; }
  .cm-tag.kind { background:#FBF3EC; color:#8a5a2b; }
  .cm-admin-sub { font-size:12px; color:var(--text-muted, #756B67); margin-bottom:8px; }
  .cm-admin-btns { display:flex; gap:6px; flex-wrap:wrap; }
  .cm-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 12px; }
  .cm-form-grid .field input[type=date] { width:100%; padding:9px 10px; border:1px solid var(--border, #E6DFDA); border-radius:9px; font-family:inherit; }
  .cm-radio-row { display:flex; gap:14px; flex-wrap:wrap; font-size:13px; }
  .cm-radio-row label { display:flex !important; align-items:center; gap:5px; font-weight:500 !important; cursor:pointer; margin:0 !important; }
  .cm-check { display:flex !important; align-items:center; gap:6px; font-weight:500 !important; font-size:13px; cursor:pointer; margin-bottom:6px !important; }
  .cm-sub-box { background:#FAF8F6; border:1px dashed var(--border, #E6DFDA); border-radius:10px; padding:12px; margin-bottom:14px; }
  .field select, .cm-sub-box input[type=number] { padding:9px 10px; border:1px solid var(--border, #E6DFDA); border-radius:9px; font-family:inherit; font-size:14px; background:#fff; }
  .cm-resp-table-wrap { max-height:46vh; overflow:auto; border:1px solid var(--border, #E6DFDA); border-radius:10px; background:#fff; margin-bottom:12px; }
  .cm-resp-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  .cm-resp-table th, .cm-resp-table td { padding:8px 10px; border-bottom:1px solid var(--border, #E6DFDA); text-align:left; vertical-align:top; }
  .cm-resp-table th { background:#F6F4F2; position:sticky; top:0; font-weight:800; }
  @media (max-width:640px) { .cm-form-grid { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);

  /* ============================================================
     ① 공지 배너
     ============================================================ */
  let notices = [];
  const hiddenIds = new Set();      // 이번 화면에서 ✕로 닫은 공지 (새로고침하면 다시 표시)
  const KIND_LABEL = { none: "공지", signup: "신청", poll: "설문" };

  const area = document.createElement("div");
  area.id = "cmNoticeArea";
  const legacyBanner = q("#noticeBanner");
  if (legacyBanner && legacyBanner.parentNode) legacyBanner.parentNode.insertBefore(area, legacyBanner);
  else (q("#viewport") || document.body).prepend(area);

  function noticeSubText(n) {
    if (n.kind === "signup") {
      const cap = n.signup && n.signup.capacity;
      return cap ? `${n.count}/${cap}명` : `${n.count}명 신청`;
    }
    if (n.kind === "poll") return `${n.count}명 참여`;
    return n.end ? `~${fmtDate(n.end)}` : "";
  }

  function renderBanner() {
    const visible = notices.filter((n) => !hiddenIds.has(n.id));
    area.innerHTML = visible.map((n) => {
      const hasModal = n.kind !== "none" || !!n.detail;
      let action = "";
      if (n.kind === "signup") {
        const full = n.signup.capacity > 0 && n.count >= n.signup.capacity && !n.my;
        action = n.my
          ? `<button type="button" class="btn btn-sm cm-done" data-open="${esc(n.id)}">✓ 신청 완료</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-open="${esc(n.id)}" ${full ? "disabled" : ""}>${full ? "마감" : "신청하기"}</button>`;
      } else if (n.kind === "poll") {
        action = n.my
          ? `<button type="button" class="btn btn-sm cm-done" data-open="${esc(n.id)}">✓ 참여 완료</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-open="${esc(n.id)}">참여하기</button>`;
      } else if (n.detail) {
        action = `<button type="button" class="btn btn-ghost btn-sm" data-open="${esc(n.id)}">자세히</button>`;
      } else if (n.link) {
        action = `<a class="btn btn-ghost btn-sm" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">바로가기</a>`;
      }
      const sub = noticeSubText(n);
      return `
        <div class="cm-notice ${n.level === "important" ? "important" : ""}" data-id="${esc(n.id)}">
          <span class="cm-notice-badge">${n.level === "important" ? "중요" : KIND_LABEL[n.kind] || "공지"}</span>
          <span class="cm-notice-text ${hasModal ? "clickable" : ""}" ${hasModal ? `data-open="${esc(n.id)}"` : ""}>
            ${esc(n.title)}${sub ? `<span class="cm-notice-sub">${esc(sub)}</span>` : ""}
          </span>
          <span class="cm-notice-actions">
            ${action}
            <button type="button" class="cm-notice-close" data-hide="${esc(n.id)}" title="닫기">✕</button>
          </span>
        </div>`;
    }).join("");
  }

  area.addEventListener("click", (e) => {
    const hide = e.target.closest("[data-hide]");
    if (hide) { hiddenIds.add(hide.dataset.hide); renderBanner(); return; }
    const open = e.target.closest("[data-open]");
    if (open && !open.disabled) openNoticeModal(open.dataset.open);
  });

  async function refreshNotices() {
    try {
      const data = await cmGet("/notices");
      notices = Array.isArray(data.notices) ? data.notices : [];
    } catch (err) {
      console.warn("[community] 공지 불러오기 실패:", err.message);
      notices = [];
    }
    renderBanner();
  }

  /* ============================================================
     ② 신청 / 설문 참여 창
     ============================================================ */
  const formModal = document.createElement("div");
  formModal.className = "modal-overlay";
  formModal.id = "cmFormModal";
  formModal.innerHTML = `<div class="modal-box wide"><button type="button" class="modal-close" data-cm-close>×</button><div id="cmFormBody"></div></div>`;
  document.body.appendChild(formModal);
  const formBody = q("#cmFormBody", formModal);
  let formBusy = false;
  let currentNoticeId = null;

  function closeFormModal() { if (!formBusy) formModal.classList.remove("open"); }
  formModal.addEventListener("click", (e) => {
    if (e.target === formModal || e.target.closest("[data-cm-close]")) closeFormModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && formModal.classList.contains("open")) closeFormModal();
  });

  function openNoticeModal(id) {
    const n = notices.find((x) => x.id === id);
    if (!n) return;
    currentNoticeId = id;
    renderNoticeModal(n, false, "");
    formModal.classList.add("open");
  }

  function renderPollResult(n) {
    if (!n.tally) return "";
    const total = n.tally.reduce((a, b) => a + b, 0) || 1;
    const mine = new Set((n.my && n.my.choices) || []);
    return `<div class="cm-result">${n.poll.options.map((o, i) => {
      const pct = Math.round(n.tally[i] / total * 100);
      return `<div class="cm-result-row"><div class="cm-result-head"><span class="${mine.has(i) ? "mine" : ""}">${mine.has(i) ? "✓ " : ""}${esc(o)}</span><span>${n.tally[i]}표 (${pct}%)</span></div>
        <div class="cm-result-bar"><span style="width:${pct}%"></span></div></div>`;
    }).join("")}</div>`;
  }

  function renderNoticeModal(n, editing, msg, msgType) {
    let html = `<h3>${esc(n.title)}</h3>`;
    const meta = [];
    if (n.start || n.end) meta.push(`기간 <b>${esc(fmtDate(n.start) || "")} ~ ${esc(fmtDate(n.end) || "")}</b>`);
    if (n.kind === "signup") meta.push(n.signup.capacity ? `신청 <b>${n.count}/${n.signup.capacity}명</b>` : `신청 <b>${n.count}명</b>`);
    if (n.kind === "poll") meta.push(`참여 <b>${n.count}명</b>`);
    if (meta.length) html += `<div class="cm-meta">${meta.join(" · ")}</div>`;
    if (n.detail) html += `<div class="cm-detail">${esc(n.detail)}</div>`;
    if (n.link) html += `<p style="margin:-4px 0 14px;font-size:13px;"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">🔗 관련 링크 열기</a></p>`;

    const showForm = n.kind !== "none" && (!n.my || editing);
    if (n.kind === "signup") {
      if (n.my && !editing) {
        html += `<div class="cm-mine-box">✓ <b>${esc(n.my.name)}</b>님 신청이 완료되었습니다.${n.my.dept ? `<br>소속: ${esc(n.my.dept)}` : ""}${n.my.memo ? `<br>메모: ${esc(n.my.memo)}` : ""}</div>`;
      } else if (showForm) {
        const full = n.signup.capacity > 0 && n.count >= n.signup.capacity && !n.my;
        if (full) html += statusHtml("신청 인원이 마감되었습니다.", "error");
        else html += `
          <div class="field"><label>이름</label><input type="text" id="cmName" maxlength="20" value="${esc(n.my ? n.my.name : "")}" placeholder="이름을 입력하세요"></div>
          ${n.signup.askDept ? `<div class="field"><label>소속 팀</label><input type="text" id="cmDept" maxlength="40" value="${esc(n.my ? n.my.dept : "")}" placeholder="예) R&D인사팀"></div>` : ""}
          ${n.signup.askMemo ? `<div class="field"><label>요청사항 <span class="hint">(선택)</span></label><textarea id="cmMemo" maxlength="300" style="min-height:70px">${esc(n.my ? n.my.memo : "")}</textarea></div>` : ""}`;
      }
    }
    if (n.kind === "poll") {
      html += `<p style="font-weight:800;margin:0 0 10px;font-size:14.5px;">Q. ${esc(n.poll.question)}${n.poll.multiple ? ` <span class="hint" style="font-weight:500;font-size:12px;color:var(--text-muted)">(복수 선택 가능)</span>` : ""}</p>`;
      if (showForm) {
        const mine = new Set((n.my && n.my.choices) || []);
        const type = n.poll.multiple ? "checkbox" : "radio";
        html += `<div class="cm-options">${n.poll.options.map((o, i) =>
          `<label class="cm-option"><input type="${type}" name="cmChoice" value="${i}" ${mine.has(i) ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
      } else if (n.tally) {
        html += renderPollResult(n);
      } else {
        const mine = (n.my && n.my.choices) || [];
        html += `<div class="cm-mine-box">✓ 참여가 완료되었습니다.<br>내 선택: ${mine.map((i) => esc(n.poll.options[i])).join(", ")}</div>`;
      }
    }

    html += `<div id="cmFormStatus">${statusHtml(msg, msgType || "error")}</div><div class="btn-row">`;
    if (n.kind === "none") {
      html += `<button type="button" class="btn btn-ghost" data-cm-close>닫기</button>`;
    } else if (showForm) {
      const full = n.kind === "signup" && n.signup.capacity > 0 && n.count >= n.signup.capacity && !n.my;
      html += `<button type="button" class="btn btn-ghost" id="cmCancelEdit">${editing ? "수정 취소" : "닫기"}</button>`;
      if (!full) html += `<button type="button" class="btn btn-primary" id="cmSubmitBtn">${editing ? "수정 저장" : n.kind === "signup" ? "신청하기" : "제출하기"}</button>`;
    } else {
      html += `<button type="button" class="btn btn-danger" id="cmWithdrawBtn">${n.kind === "signup" ? "신청 취소" : "응답 취소"}</button>
               <button type="button" class="btn btn-ghost" id="cmEditBtn">${n.kind === "signup" ? "신청 정보 수정" : "다시 선택"}</button>
               <button type="button" class="btn btn-primary" data-cm-close>닫기</button>`;
    }
    html += `</div>`;
    formBody.innerHTML = html;

    const submitBtn = q("#cmSubmitBtn", formBody);
    if (submitBtn) submitBtn.addEventListener("click", () => submitResponse(n, editing));
    const cancelEdit = q("#cmCancelEdit", formBody);
    if (cancelEdit) cancelEdit.addEventListener("click", () => { if (editing) renderNoticeModal(n, false, ""); else closeFormModal(); });
    const editBtn = q("#cmEditBtn", formBody);
    if (editBtn) editBtn.addEventListener("click", () => renderNoticeModal(n, true, ""));
    const withdrawBtn = q("#cmWithdrawBtn", formBody);
    if (withdrawBtn) withdrawBtn.addEventListener("click", () => withdrawResponse(n));
    const nameInput = q("#cmName", formBody);
    if (nameInput) setTimeout(() => nameInput.focus(), 50);
  }

  function applyUpdatedNotice(updated) {
    const i = notices.findIndex((x) => x.id === updated.id);
    if (i >= 0) notices[i] = updated;
    renderBanner();
    return updated;
  }

  async function submitResponse(n, editing) {
    if (formBusy) return;
    const body = { id: n.id };
    if (n.kind === "signup") {
      body.name = (q("#cmName", formBody) || {}).value || "";
      body.dept = (q("#cmDept", formBody) || {}).value || "";
      body.memo = (q("#cmMemo", formBody) || {}).value || "";
      if (!body.name.trim()) { q("#cmFormStatus", formBody).innerHTML = statusHtml("이름을 입력해주세요.", "error"); return; }
    } else {
      body.choices = qa("input[name=cmChoice]:checked", formBody).map((el) => Number(el.value));
      if (!body.choices.length) { q("#cmFormStatus", formBody).innerHTML = statusHtml("선택지를 골라주세요.", "error"); return; }
    }
    const btn = q("#cmSubmitBtn", formBody);
    formBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = "저장 중..."; }
    try {
      const data = await cmPost("/respond", body);
      const updated = applyUpdatedNotice(data.notice);
      renderNoticeModal(updated, false, n.kind === "signup" ? (editing ? "신청 정보가 수정되었습니다." : "신청이 완료되었습니다!") : "응답해주셔서 감사합니다!", "success");
    } catch (err) {
      q("#cmFormStatus", formBody).innerHTML = statusHtml(err.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = editing ? "수정 저장" : n.kind === "signup" ? "신청하기" : "제출하기"; }
      if (/마감/.test(err.message)) refreshNotices();
    } finally { formBusy = false; }
  }

  async function withdrawResponse(n) {
    if (formBusy) return;
    if (!confirm(n.kind === "signup" ? "신청을 취소할까요?" : "응답을 취소할까요?")) return;
    formBusy = true;
    const btn = q("#cmWithdrawBtn", formBody);
    if (btn) { btn.disabled = true; btn.textContent = "처리 중..."; }
    try {
      const data = await cmPost("/respond", { id: n.id, cancel: true });
      const updated = applyUpdatedNotice(data.notice);
      renderNoticeModal(updated, false, "취소되었습니다.", "success");
    } catch (err) {
      q("#cmFormStatus", formBody).innerHTML = statusHtml(err.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "취소"; }
    } finally { formBusy = false; }
  }

  /* ============================================================
     ③ 좋아요
     ============================================================ */
  const likeCache = new Map();     // target → { count, liked }
  const likeBusy = new Set();
  let pendingTargets = new Set();
  let likeTimer = 0;

  function likeBtnHtml(target) {
    const v = likeCache.get(target);
    const liked = v && v.liked;
    return `<button type="button" class="cm-like-btn${liked ? " liked" : ""}" data-like="${esc(target)}" title="좋아요">
      <span class="cm-like-icon">👍</span><span class="cm-like-count">${v ? v.count : "·"}</span></button>`;
  }
  function updateLikeButtons(target) {
    const v = likeCache.get(target);
    qa(`.cm-like-btn[data-like="${CSS.escape(target)}"]`).forEach((b) => {
      b.classList.toggle("liked", !!(v && v.liked));
      
      q(".cm-like-count", b).textContent = v ? v.count : "·";
      b.disabled = likeBusy.has(target);
    });
  }
  function requestLikes(targets) {
    targets.forEach((t) => { if (!likeCache.has(t)) pendingTargets.add(t); });
    if (!pendingTargets.size || likeTimer) return;
    likeTimer = setTimeout(async () => {
      likeTimer = 0;
      const list = Array.from(pendingTargets).slice(0, 40);
      list.forEach((t) => pendingTargets.delete(t));
      try {
        const data = await cmGet("/likes?t=" + encodeURIComponent(list.join(",")));
        Object.entries(data.likes || {}).forEach(([t, v]) => { likeCache.set(t, v); updateLikeButtons(t); });
      } catch (err) { console.warn("[community] 좋아요 조회 실패:", err.message); }
      if (pendingTargets.size) requestLikes([]);
    }, 120);
  }

  async function toggleLike(target) {
    if (likeBusy.has(target)) return;
    const prev = likeCache.get(target) || { count: 0, liked: false };
    const want = !prev.liked;
    likeCache.set(target, { count: Math.max(0, prev.count + (want ? 1 : -1)), liked: want });   // 먼저 화면 반영
    likeBusy.add(target);
    updateLikeButtons(target);
    try {
      const data = await cmPost("/like", { target, liked: want });
      likeCache.set(target, { count: data.count, liked: data.liked });
    } catch (err) {
      likeCache.set(target, prev);
      alert("좋아요 처리에 실패했습니다: " + err.message);
    } finally {
      likeBusy.delete(target);
      updateLikeButtons(target);
    }
  }

  // 좋아요 버튼 클릭은 문서 전체에서 한 번만 처리 (다시 그려져도 중복 등록 없음)
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".cm-like-btn");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    toggleLike(b.dataset.like);
  });

  /* 소식지 슬라이더: 현재 사진에 좋아요 버튼 */
  function decorateNewsSlider() {
    const body = q("#newsSliderBody");
    if (!body) return;
    let slides = [], idx = 0, reorder = false;
    try { slides = Array.isArray(newsSlides) ? newsSlides : []; idx = newsSlideIndex; reorder = !!newsReorderMode; } catch (e) { return; }
    const toolbar = q(".news-slider-toolbar", body);
    if (!toolbar || reorder || !slides[idx]) return;
    const target = "news:" + slides[idx].id;
    if (q(".cm-like-btn", toolbar)) return;
    toolbar.insertAdjacentHTML("afterbegin", likeBtnHtml(target));
    requestLikes(slides.map((s) => "news:" + s.id));   // 전체를 한 번에 조회 → 넘길 때 즉시 표시
  }
  if (typeof renderNewsSlider === "function") {
    const originalRender = renderNewsSlider;
    renderNewsSlider = function () {
      const r = originalRender.apply(this, arguments);
      try { decorateNewsSlider(); } catch (err) { console.error("[community] 좋아요(소식지) 오류:", err); }
      return r;
    };
    try { decorateNewsSlider(); } catch (e) {}
  }

  /* 샐러드 상세 화면: 좋아요 버튼 */
  const detailBody = q("#postDetailBody");
  if (detailBody) {
    new MutationObserver(() => {
      const actions = q(".detail-actions", detailBody);
      if (!actions || q(".cm-like-btn", actions)) return;
      let id = null;
      try { id = currentSaladId; } catch (e) {}
      if (!id) return;
      const target = "salad:" + id;
      actions.insertAdjacentHTML("afterbegin", likeBtnHtml(target));
      likeCache.delete(target);          // 상세를 열 때마다 최신 숫자로
      requestLikes([target]);
    }).observe(detailBody, { childList: true });
  }

  /* ============================================================
     ④ 관리 화면 (설정 → 📢 공지·설문)
     ============================================================ */
  const tabs = q("#settingsModal .settings-tabs");
  const statsPane = q("#pane-stats");
  let adminCode = null;
  let adminNotices = [];
  let adminBusy = false;

  if (tabs) {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.dataset.pane = "community";
    tabBtn.textContent = "📢 공지·설문";
    const statsBtn = q('[data-pane="stats"]', tabs);
    if (statsBtn) statsBtn.after(tabBtn); else tabs.appendChild(tabBtn);

    const pane = document.createElement("div");
    pane.className = "settings-pane";
    pane.id = "pane-community";
    pane.innerHTML = `<div id="cmAdminBody"></div>`;
    if (statsPane) statsPane.after(pane); else q("#settingsModal .modal-box").appendChild(pane);

    tabBtn.addEventListener("click", () => {
      qa("#settingsModal .settings-tabs button").forEach((b) => b.classList.remove("active"));
      qa("#settingsModal .settings-pane").forEach((p) => p.classList.remove("active"));
      tabBtn.classList.add("active");
      pane.classList.add("active");
      if (adminCode) loadAdminList(); else renderAdminLocked();
    });
  }
  const adminBody = () => q("#cmAdminBody");

  function renderAdminLocked(msg) {
    adminBody().innerHTML = `
      <div class="settings-note">상단 공지 배너와 이벤트 신청·설문을 관리합니다. 시작하려면 인증코드 확인이 필요합니다.<br>
      (확인 후 이 창을 닫거나 새로고침하기 전까지는 다시 묻지 않습니다)</div>
      ${statusHtml(msg, "error")}
      <div class="btn-row" style="justify-content:flex-start"><button type="button" class="btn btn-primary btn-sm" id="cmUnlockBtn">🔒 관리 시작</button></div>`;
    q("#cmUnlockBtn").addEventListener("click", unlockAdmin);
  }

  async function unlockAdmin() {
    let code = null;
    if (typeof verifyPasscodeAndGet === "function") code = await verifyPasscodeAndGet("공지·설문 관리", "공지와 설문을 관리하려면 인증코드를 입력해주세요.");
    else code = prompt("인증코드를 입력해주세요.");
    if (!code) return;
    try {
      await cmPost("/admin", { action: "verify", code });
      adminCode = code;
      loadAdminList();
    } catch (err) { renderAdminLocked(err.message); }
  }

  async function adminCall(body) {
    try { return await cmPost("/admin", { ...body, code: adminCode }); }
    catch (err) {
      if (/인증코드/.test(err.message)) { adminCode = null; renderAdminLocked("인증코드가 바뀌었거나 올바르지 않습니다. 다시 확인해주세요."); }
      throw err;
    }
  }

  const STATUS_LABEL = { active: "게시 중", scheduled: "예정", ended: "종료" };
  async function loadAdminList(msg, msgType) {
    adminBody().innerHTML = `<div class="empty-mini">불러오는 중...</div>`;
    let data;
    try { data = await adminCall({ action: "list" }); }
    catch (err) { if (adminCode) adminBody().innerHTML = statusHtml("목록을 불러오지 못했습니다: " + err.message, "error"); return; }
    adminNotices = data.notices || [];
    adminBody().innerHTML = `
      <div class="cm-admin-toolbar">
        <button type="button" class="btn btn-primary btn-sm" id="cmNewBtn">＋ 새 공지 등록</button>
        <span style="font-size:12px;color:var(--text-muted)">오늘(${esc(data.today)}) 기준 · 기간이 지나면 배너에서 자동으로 내려갑니다.</span>
      </div>
      ${statusHtml(msg, msgType || "success")}
      <div class="cm-admin-list">
        ${adminNotices.length ? adminNotices.map((n) => `
          <div class="cm-admin-item">
            <div class="cm-admin-item-top">
              <span class="cm-tag ${n.status}">${STATUS_LABEL[n.status]}</span>
              <span class="cm-tag kind">${n.level === "important" ? "중요 · " : ""}${KIND_LABEL[n.kind]}</span>
              <span class="cm-admin-title">${esc(n.title)}</span>
            </div>
            <div class="cm-admin-sub">기간: ${esc(n.start || "제한 없음")} ~ ${esc(n.end || "제한 없음")}
              ${n.kind === "signup" ? ` · 신청 ${n.count}${n.signup.capacity ? "/" + n.signup.capacity : ""}명` : ""}
              ${n.kind === "poll" ? ` · 참여 ${n.count}명` : ""}</div>
            <div class="cm-admin-btns">
              ${n.kind !== "none" ? `<button type="button" class="btn btn-outline btn-sm" data-act="resp" data-id="${esc(n.id)}">📋 응답 보기</button>` : ""}
              <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(n.id)}">수정</button>
              <button type="button" class="btn btn-danger btn-sm" data-act="del" data-id="${esc(n.id)}">삭제</button>
            </div>
          </div>`).join("") : `<div class="empty-mini">등록된 공지가 없습니다. "새 공지 등록"으로 시작하세요.</div>`}
      </div>`;
    q("#cmNewBtn").addEventListener("click", () => renderAdminForm(null));
    qa("[data-act]", adminBody()).forEach((b) => b.addEventListener("click", () => {
      const n = adminNotices.find((x) => x.id === b.dataset.id);
      if (!n) return;
      if (b.dataset.act === "edit") renderAdminForm(n);
      else if (b.dataset.act === "del") deleteNotice(n);
      else if (b.dataset.act === "resp") showResponses(n);
    }));
  }

  function renderAdminForm(n) {
    const isEdit = !!n;
    const v = n || { title: "", detail: "", link: "", level: "info", start: "", end: "", kind: "none" };
    const s = v.signup || { capacity: 0, askDept: true, askMemo: false };
    const p = v.poll || { question: "", options: [], multiple: false, showResult: true };
    const locked = isEdit && n.count > 0;   // 응답이 있으면 종류 변경 불가
    adminBody().innerHTML = `
      <h4 style="margin:0 0 12px;color:var(--primary-dark,#7A1519)">${isEdit ? "공지 수정" : "새 공지 등록"}</h4>
      <div class="field"><label>배너 문구 <span class="hint">(한 줄로 표시)</span></label>
        <input type="text" id="cmfTitle" maxlength="120" value="${esc(v.title)}" placeholder="예) 10월 '소담한 하루' 2차 신청을 받습니다!"></div>
      <div class="field"><label>상세 내용 <span class="hint">(선택 · 배너를 누르면 표시)</span></label>
        <textarea id="cmfDetail" maxlength="2000" style="min-height:90px" placeholder="일정, 장소, 안내사항 등">${esc(v.detail)}</textarea></div>
      <div class="field"><label>관련 링크 <span class="hint">(선택)</span></label>
        <input type="text" id="cmfLink" maxlength="500" value="${esc(v.link)}" placeholder="https://"></div>
      <div class="cm-form-grid">
        <div class="field"><label>게시 시작일 <span class="hint">(비우면 즉시)</span></label><input type="date" id="cmfStart" value="${esc(v.start)}"></div>
        <div class="field"><label>게시 종료일 <span class="hint">(이 날까지 표시)</span></label><input type="date" id="cmfEnd" value="${esc(v.end)}"></div>
      </div>
      <div class="field"><label>중요도</label>
        <div class="cm-radio-row">
          <label><input type="radio" name="cmfLevel" value="info" ${v.level !== "important" ? "checked" : ""}> 일반 (베이지)</label>
          <label><input type="radio" name="cmfLevel" value="important" ${v.level === "important" ? "checked" : ""}> 중요 (빨강)</label>
        </div></div>
      <div class="field"><label>참여 기능 ${locked ? `<span class="hint">(응답이 있어 변경 불가)</span>` : ""}</label>
        <div class="cm-radio-row">
          ${["none", "signup", "poll"].map((k) => `<label><input type="radio" name="cmfKind" value="${k}" ${v.kind === k ? "checked" : ""} ${locked ? "disabled" : ""}> ${{ none: "공지만", signup: "이벤트 신청", poll: "설문/투표" }[k]}</label>`).join("")}
        </div></div>
      <div class="cm-sub-box" id="cmfSignupBox">
        <label class="cm-check" style="margin-bottom:10px !important">정원 <input type="number" id="cmfCap" min="0" max="10000" value="${s.capacity || 0}" style="width:90px"> 명 <span class="hint">(0 = 제한 없음)</span></label>
        <label class="cm-check"><input type="checkbox" id="cmfAskDept" ${s.askDept ? "checked" : ""}> 소속 팀 입력받기</label>
        <label class="cm-check"><input type="checkbox" id="cmfAskMemo" ${s.askMemo ? "checked" : ""}> 요청사항(메모) 입력받기</label>
        <div style="font-size:12px;color:var(--text-muted)">※ 이름은 항상 입력받습니다. 1인 1회 신청이며 신청자가 직접 수정·취소할 수 있습니다.</div>
      </div>
      <div class="cm-sub-box" id="cmfPollBox">
        <div class="field"><label>질문</label><input type="text" id="cmfQuestion" maxlength="200" value="${esc(p.question)}" placeholder="예) 소담한 하루, 다시 열리면 참여하시겠어요?"></div>
        <div class="field"><label>선택지 <span class="hint">(한 줄에 하나씩 · 2~10개)</span></label>
          <textarea id="cmfOptions" style="min-height:90px" placeholder="꼭 참여할게요&#10;시간이 맞으면 참여할게요&#10;이번엔 어려워요">${esc((p.options || []).join("\n"))}</textarea></div>
        <label class="cm-check"><input type="checkbox" id="cmfMultiple" ${p.multiple ? "checked" : ""}> 복수 선택 허용</label>
        <label class="cm-check"><input type="checkbox" id="cmfShowResult" ${p.showResult ? "checked" : ""}> 참여한 사람에게 결과(비율) 보여주기</label>
      </div>
      <div id="cmfStatus"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" id="cmfCancel">목록으로</button>
        <button type="button" class="btn btn-primary" id="cmfSave">${isEdit ? "수정 저장" : "등록하기"}</button>
      </div>`;

    const syncBoxes = () => {
      const kind = (q("input[name=cmfKind]:checked") || {}).value || "none";
      q("#cmfSignupBox").style.display = kind === "signup" ? "" : "none";
      q("#cmfPollBox").style.display = kind === "poll" ? "" : "none";
    };
    qa("input[name=cmfKind]").forEach((r) => r.addEventListener("change", syncBoxes));
    syncBoxes();
    q("#cmfCancel").addEventListener("click", () => loadAdminList());
    q("#cmfSave").addEventListener("click", () => saveNotice(n));
  }

  async function saveNotice(n) {
    if (adminBusy) return;
    const notice = {
      id: n ? n.id : undefined,
      title: q("#cmfTitle").value,
      detail: q("#cmfDetail").value,
      link: q("#cmfLink").value.trim(),
      start: q("#cmfStart").value,
      end: q("#cmfEnd").value,
      level: (q("input[name=cmfLevel]:checked") || {}).value,
      kind: (q("input[name=cmfKind]:checked") || {}).value || "none",
      signup: { capacity: q("#cmfCap").value, askDept: q("#cmfAskDept").checked, askMemo: q("#cmfAskMemo").checked },
      poll: {
        question: q("#cmfQuestion").value,
        options: q("#cmfOptions").value.split("\n").map((s) => s.trim()).filter(Boolean),
        multiple: q("#cmfMultiple").checked,
        showResult: q("#cmfShowResult").checked,
      },
    };
    const st = q("#cmfStatus");
    if (!notice.title.trim()) { st.innerHTML = statusHtml("배너 문구를 입력해주세요.", "error"); return; }
    if (notice.kind === "poll" && notice.poll.options.length < 2) { st.innerHTML = statusHtml("선택지를 2개 이상 입력해주세요.", "error"); return; }
    if (notice.start && notice.end && notice.end < notice.start) { st.innerHTML = statusHtml("종료일이 시작일보다 빠릅니다.", "error"); return; }
    adminBusy = true;
    const btn = q("#cmfSave");
    btn.disabled = true; btn.textContent = "저장 중...";
    try {
      await adminCall({ action: "save", notice });
      await refreshNotices();
      loadAdminList(n ? "수정되었습니다. (모든 방문자에게 즉시 반영)" : "등록되었습니다. (모든 방문자에게 즉시 반영)");
    } catch (err) {
      if (q("#cmfStatus")) {
        q("#cmfStatus").innerHTML = statusHtml(err.message, "error");
        btn.disabled = false; btn.textContent = n ? "수정 저장" : "등록하기";
      }
    } finally { adminBusy = false; }
  }

  async function deleteNotice(n) {
    if (adminBusy) return;
    const extra = n.kind !== "none" && n.count ? `\n※ 신청/응답 ${n.count}건도 함께 삭제됩니다. 필요하면 먼저 '응답 보기'에서 엑셀로 받아두세요.` : "";
    if (!confirm(`'${n.title}' 공지를 삭제할까요?${extra}`)) return;
    adminBusy = true;
    try {
      await adminCall({ action: "delete", id: n.id });
      hiddenIds.delete(n.id);
      await refreshNotices();
      loadAdminList("삭제되었습니다.");
    } catch (err) { alert("삭제에 실패했습니다: " + err.message); }
    finally { adminBusy = false; }
  }

  async function showResponses(n) {
    adminBody().innerHTML = `<div class="empty-mini">응답을 불러오는 중...</div>`;
    let data;
    try { data = await adminCall({ action: "responses", id: n.id }); }
    catch (err) { if (adminCode) adminBody().innerHTML = statusHtml(err.message, "error") + `<div class="btn-row"><button type="button" class="btn btn-ghost" id="cmBack">목록으로</button></div>`;
      const b = q("#cmBack"); if (b) b.addEventListener("click", () => loadAdminList()); return; }
    const nn = data.notice, rows = data.responses || [];
    const isPoll = nn.kind === "poll";
    const head = isPoll ? ["번호", "선택", "이름", "응답 시각"]
      : ["번호", "이름", ...(nn.signup.askDept ? ["소속"] : []), ...(nn.signup.askMemo ? ["요청사항"] : []), "신청 시각"];
    const toRow = (r, i) => isPoll
      ? [i + 1, r.choices.map((c) => nn.poll.options[c]).join(", "), r.name || "", fmtDateTime(r.at)]
      : [i + 1, r.name, ...(nn.signup.askDept ? [r.dept] : []), ...(nn.signup.askMemo ? [r.memo] : []), fmtDateTime(r.at)];
    adminBody().innerHTML = `
      <h4 style="margin:0 0 4px;color:var(--primary-dark,#7A1519)">📋 ${esc(nn.title)}</h4>
      <div class="cm-meta" style="margin:0 0 12px">${isPoll ? `참여 <b>${rows.length}명</b>` : `신청 <b>${rows.length}${nn.signup.capacity ? "/" + nn.signup.capacity : ""}명</b>`}</div>
      ${isPoll ? renderPollResult(nn) : ""}
      ${rows.length ? `<div class="cm-resp-table-wrap"><table class="cm-resp-table">
        <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr>${toRow(r, i).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty-mini">아직 응답이 없습니다.</div>`}
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" id="cmBack">목록으로</button>
        <button type="button" class="btn btn-ghost" id="cmReload">🔄 새로고침</button>
        <button type="button" class="btn btn-primary" id="cmCsv" ${rows.length ? "" : "disabled"}>⬇ 엑셀(CSV) 받기</button>
      </div>`;
    q("#cmBack").addEventListener("click", () => loadAdminList());
    q("#cmReload").addEventListener("click", () => showResponses(n));
    q("#cmCsv").addEventListener("click", () => {
      const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const lines = [head.map(cell).join(","), ...rows.map((r, i) => toRow(r, i).map(cell).join(","))];
      if (isPoll) {
        lines.push("", cell("집계"));
        nn.poll.options.forEach((o, i) => lines.push([cell(o), cell((nn.tally || [])[i] || 0)].join(",")));
      }
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nn.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "응답"}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  /* ---------------- 시작 ---------------- */
  refreshNotices();
})();
