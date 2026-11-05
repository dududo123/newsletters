/* ============================================================
   R&D본부 소식지 — 서버 연동 + 조회수 트래킹
   ============================================================ */

const API_BASE = "/api";
const MAX_NEWS_SLIDES = 50;
const SECTION_TITLE_DEFAULTS = {
  salad: "중식 샐러드 신청공간",
  news: "소식지",
  mealplan: "식단표",
  mealbox: "밀박스",
};
const GALLERY_LABELS = { mealplan: "식단표", mealbox: "밀박스" };
const BG_DEFAULT_ADJUST = { posX: 50, posY: 50, zoom: 100 };

function imageUrl(imageId) { return imageId ? `${API_BASE}/image/${imageId}` : ""; }

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  } catch (e) { return ""; }
}

function resizeImageFile(file, maxDim, quality) {
  maxDim = maxDim || 1440;
  quality = quality || 0.78;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || `서버 오류 (${res.status})`);
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("서버 응답이 오지 않았습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    throw err;
  }
}
const apiGet = (path) => apiFetch(path, { method: "GET" });
const apiPost = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body) });
const apiPut = (path, body) => apiFetch(path, { method: "PUT", body: JSON.stringify(body) });
const apiDelete = (path) => apiFetch(path, { method: "DELETE" });

/* ---------- 조회수 트래킹 ---------- */
function alreadyCounted(key, windowMs) {
  try {
    const now = Date.now();
    const raw = localStorage.getItem("viewlog");
    const log = raw ? JSON.parse(raw) : {};
    Object.keys(log).forEach((k) => { if (now - log[k] > 86400000 * 2) delete log[k]; });
    if (log[key] && now - log[key] < windowMs) {
      localStorage.setItem("viewlog", JSON.stringify(log));
      return true;
    }
    log[key] = now;
    localStorage.setItem("viewlog", JSON.stringify(log));
    return false;
  } catch (e) { return false; }
}

function trackView(payload, dedupeKey, windowMs) {
  try {
    if (dedupeKey && alreadyCounted(dedupeKey, windowMs)) return;
    apiPost("/stats/track", payload).catch(() => {});
  } catch (e) {}
}

function trackSiteVisit() {
  const today = new Date().toISOString().slice(0, 10);
  trackView({ type: "site" }, `site-${today}`, 86400000);
}

function trackSectionView(section, id) {
  const key = id ? `sec-${section}-${id}` : `sec-${section}`;
  trackView({ type: "section", section, id }, key, 30 * 60 * 1000);
}

/* ---------- 모달 ---------- */
function syncBodyScrollLock() {
  const anyOpen = $all(".modal-overlay.open").length > 0 || $("#lightbox").classList.contains("open");
  document.body.classList.toggle("modal-open", anyOpen);
}
function openModal(id) { $("#" + id).classList.add("open"); syncBodyScrollLock(); }
function closeModal(id) { $("#" + id).classList.remove("open"); syncBodyScrollLock(); }

/* 인증 창(passModal)은 askPasscode()가 직접 닫기를 관리하므로
   여기 공용 닫기 처리에서는 제외합니다. (중복 처리로 응답이 꼬이는 것 방지) */
$all("[data-close]").forEach((el) => {
  if (el.dataset.close === "passModal") return;
  el.addEventListener("click", () => closeModal(el.dataset.close));
});
$all(".modal-overlay").forEach((overlay) => {
  if (overlay.id === "passModal") return;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { overlay.classList.remove("open"); syncBodyScrollLock(); }
  });
});

/* ---------- 인증 ---------- */
function askPasscode(title, desc) {
  return new Promise((resolve) => {
    const modal = $("#passModal");
    const input = $("#passModalInput");
    const confirmBtn = $("#passModalConfirm");
    const cancelBtn = $("#passModalCancel");
    const closeBtn = modal.querySelector(".modal-close");

    $("#passModalTitle").textContent = title || "인증코드 확인";
    $("#passModalDesc").textContent = desc || "계속하려면 인증코드를 입력해주세요.";
    input.value = "";
    openModal("passModal");
    setTimeout(() => input.focus(), 50);

    const cleanup = (val) => {
      closeModal("passModal");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      modal.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      document.removeEventListener("keydown", onEsc, true);
      resolve(val);
    };

    /* [수정] 예전에는 배경이나 × 버튼으로 닫으면 응답이 돌아오지 않아
       "저장 중..." 상태로 멈춰버렸습니다. 이제 어떤 방법으로 닫아도
       '취소'로 처리되어 원래 화면으로 깔끔히 돌아옵니다. */
    modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
    if (closeBtn) closeBtn.onclick = () => cleanup(null);

    /* ESC로 닫을 때, 뒤에 있는 설정창까지 같이 닫히지 않도록
       이 창에서 이벤트를 먼저 가로채 처리합니다. */
    function onEsc(e) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      cleanup(null);
    }
    document.addEventListener("keydown", onEsc, true);

    confirmBtn.onclick = () => cleanup(input.value.trim());
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => { if (e.key === "Enter") cleanup(input.value.trim()); };
  });
}

async function verifyPasscodeAndGet(title, desc) {
  const val = await askPasscode(title, desc);
  if (val === null) return null;
  try {
    const result = await apiPost("/auth/verify", { code: val });
    if (!result.ok) { alert("인증코드가 올바르지 않습니다."); return null; }
    return val;
  } catch (err) {
    alert("인증 확인 중 오류가 발생했습니다: " + err.message);
    return null;
  }
}

/* ---------- 공용 헬퍼 ---------- */
function setupDropZone(dropZoneEl, fileInputEl, onFiles) {
  ["dragover", "dragenter"].forEach((evt) => dropZoneEl.addEventListener(evt, (e) => { e.preventDefault(); dropZoneEl.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((evt) => dropZoneEl.addEventListener(evt, (e) => { e.preventDefault(); dropZoneEl.classList.remove("dragover"); }));
  dropZoneEl.addEventListener("drop", (e) => onFiles(e.dataTransfer.files));
  fileInputEl.addEventListener("change", (e) => { onFiles(e.target.files); fileInputEl.value = ""; });
}

function renderPreviewGrid(gridEl, images, onRemove) {
  gridEl.innerHTML = images.map((src, idx) => `
    <div class="preview-item">
      <img src="${src}">
      <button type="button" class="remove" data-idx="${idx}">✕</button>
    </div>`).join("");
  $all(".remove", gridEl).forEach((btn) => btn.addEventListener("click", () => onRemove(Number(btn.dataset.idx))));
}

let bootData = null;

/* ---------- 식단표 / 밀박스 ---------- */
function renderGalleryFromRecord(catKey, record) {
  const bodyEl = $("#galleryBody-" + catKey);
  const label = GALLERY_LABELS[catKey];

  if (!record || !record.imageId) {
    bodyEl.innerHTML = `<div class="gallery-empty"><div class="icon">🖼️</div>아직 업로드된 사진이 없습니다.</div>`;
    return;
  }

  const url = imageUrl(record.imageId);
  bodyEl.innerHTML = `
    <div class="gallery-single">
      <div class="gallery-single-frame">
        <img src="${url}" alt="${label}" loading="lazy" decoding="async">
        <button type="button" class="del-btn" title="삭제">✕</button>
      </div>
      <div class="gallery-single-meta">${formatDate(record.date)} 업로드</div>
    </div>`;

  const frame = $(".gallery-single-frame", bodyEl);
  frame.querySelector("img").addEventListener("click", () => {
    trackSectionView(catKey);
    openLightbox(url);
  });
  frame.querySelector(".del-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteGalleryImage(catKey);
  });
}

async function refreshGallery(catKey) {
  try { renderGalleryFromRecord(catKey, await apiGet(`/gallery?category=${catKey}`)); }
  catch (err) {
    $("#galleryBody-" + catKey).innerHTML = `<div class="gallery-empty"><div class="icon">⚠️</div>목록을 불러오지 못했습니다.</div>`;
  }
}

async function handleDeleteGalleryImage(catKey) {
  if (!confirm("이 사진을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 사진을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiDelete(`/gallery?category=${catKey}&code=${encodeURIComponent(code)}`);
    await refreshGallery(catKey);
  } catch (err) { alert("삭제 중 오류가 발생했습니다: " + err.message); }
}

let uploadTargetCategory = null;
let uploadSelectedImage = null;

function reRenderUploadPreview() {
  renderPreviewGrid($("#uploadPreviewGrid"), uploadSelectedImage ? [uploadSelectedImage] : [], () => {
    uploadSelectedImage = null; reRenderUploadPreview();
  });
}

setupDropZone($("#uploadDropZone"), $("#uploadFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  if (files.length > 1) showUploadStatus("이 항목은 사진을 1장만 업로드할 수 있어 첫 번째 사진만 선택되었습니다.", "error");
  try { uploadSelectedImage = await resizeImageFile(files[0], 1600, 0.8); }
  catch (e) { showUploadStatus("사진을 처리하는 중 오류가 발생했습니다.", "error"); }
  reRenderUploadPreview();
});

function showUploadStatus(msg, type) {
  $("#uploadFormStatus").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
}

$all("[data-action='upload']").forEach((btn) => {
  btn.addEventListener("click", () => {
    uploadTargetCategory = btn.dataset.category;
    const label = GALLERY_LABELS[uploadTargetCategory];
    $("#uploadModalTitle").textContent = `${label} 사진 업로드`;
    $("#uploadModalDesc").textContent = `${label} 사진은 1장만 등록할 수 있으며, 새로 업로드하면 기존 사진은 자동으로 교체됩니다.`;
    uploadSelectedImage = null;
    reRenderUploadPreview();
    showUploadStatus("", "");
    $("#uploadForm").reset();
    openModal("uploadModal");
  });
});

$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#uploadCodeInput").value.trim();
  if (!uploadSelectedImage) { showUploadStatus("사진을 1장 첨부해주세요.", "error"); return; }
  if (!code) { showUploadStatus("인증코드를 입력해주세요.", "error"); return; }

  const submitBtn = $("#uploadSubmitBtn");
  submitBtn.disabled = true; submitBtn.textContent = "업로드 중...";
  try {
    await apiPut(`/gallery?category=${uploadTargetCategory}`, { image: uploadSelectedImage, code });
    showUploadStatus("업로드가 완료되었습니다!", "success");
    await refreshGallery(uploadTargetCategory);
    setTimeout(() => closeModal("uploadModal"), 700);
  } catch (err) {
    showUploadStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "업로드";
  }
});

/* ---------- 중식 샐러드 ---------- */
let saladList = [];
let saladSearchKeyword = "";
let saladShowCount = 2;
const PAGE_STEP = 3;

function renderSaladFeed() {
  const listEl = $("#saladList");
  const moreRowEl = $("#saladMoreRow");

  let sorted = saladList.slice();
  if (saladSearchKeyword.trim()) {
    const kw = saladSearchKeyword.trim().toLowerCase();
    sorted = sorted.filter((p) => (p.title || "").toLowerCase().includes(kw));
  }

  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="empty-mini">🥗 ${saladSearchKeyword.trim() ? "검색 결과가 없습니다." : "아직 등록된 글이 없습니다. '새 포스트'로 첫 글을 올려보세요!"}</div>`;
    moreRowEl.innerHTML = "";
    return;
  }

  const visible = sorted.slice(0, saladShowCount);
  listEl.innerHTML = visible.map((p) => {
    const titleText = p.title && p.title.trim() ? p.title : "중식 샐러드";
    const thumb = p.thumbId
      ? `<img class="news-thumb" src="${imageUrl(p.thumbId)}" alt="${escapeHtml(titleText)}" loading="lazy" decoding="async">`
      : `<div class="news-thumb placeholder">🥗</div>`;
    const snippet = (p.content || "").slice(0, 60);
    return `
      <button type="button" class="news-item" data-id="${p.id}">
        ${thumb}
        <div class="news-item-body">
          <div class="news-title">${escapeHtml(titleText)}</div>
          ${snippet ? `<div class="news-snippet">${escapeHtml(snippet)}</div>` : ""}
          <div class="news-meta"><span>👤</span><span>${escapeHtml(p.author || "R&D인사팀")}</span><span>·</span><span>${formatDate(p.date)}</span><span>·</span><span>💬 ${p.commentCount || 0}</span></div>
        </div>
      </button>`;
  }).join("");

  $all(".news-item", listEl).forEach((item) => {
    item.addEventListener("click", () => openSaladDetail(item.dataset.id));
  });

  if (sorted.length > saladShowCount) {
    moreRowEl.innerHTML = `<button type="button" class="feed-more-btn">더보기 ▾ (${sorted.length - saladShowCount})</button>`;
    $(".feed-more-btn", moreRowEl).addEventListener("click", () => { saladShowCount += PAGE_STEP; renderSaladFeed(); });
  } else if (sorted.length > 2) {
    moreRowEl.innerHTML = `<button type="button" class="feed-collapse-btn">접기 ▲</button>`;
    $(".feed-collapse-btn", moreRowEl).addEventListener("click", () => { saladShowCount = 2; renderSaladFeed(); });
  } else {
    moreRowEl.innerHTML = "";
  }
}

async function refreshSaladList() {
  try { saladList = await apiGet("/salad"); }
  catch (err) { $("#saladList").innerHTML = `<div class="empty-mini">⚠️ 목록을 불러오지 못했습니다.</div>`; return; }
  renderSaladFeed();
}

$("#saladSearchToggle").addEventListener("click", () => {
  const row = $("#saladSearchRow");
  const isHidden = row.style.display === "none";
  row.style.display = isHidden ? "block" : "none";
  $("#saladSearchToggle").classList.toggle("active", isHidden);
  if (isHidden) setTimeout(() => $("#saladSearchInput").focus(), 50);
  else { $("#saladSearchInput").value = ""; saladSearchKeyword = ""; saladShowCount = 2; renderSaladFeed(); }
});
$("#saladSearchInput").addEventListener("input", (e) => {
  saladSearchKeyword = e.target.value; saladShowCount = 2; renderSaladFeed();
});

let currentSaladId = null;

async function openSaladDetail(id) {
  currentSaladId = id;
  trackSectionView("salad", id);

  const body = $("#postDetailBody");
  body.innerHTML = `<div class="empty-mini">불러오는 중...</div>`;
  openModal("postDetailModal");

  let item;
  try { item = await apiGet(`/salad?id=${encodeURIComponent(id)}`); }
  catch (err) { body.innerHTML = `<div class="empty-mini">불러오는 중 오류가 발생했습니다.</div>`; return; }

  const titleText = item.title && item.title.trim() ? item.title : "중식 샐러드";
  const gallery = (item.images || []).map((imgId) => {
    const u = imageUrl(imgId);
    return `<img src="${u}" data-full="${u}" alt="${escapeHtml(titleText)}" loading="lazy" decoding="async">`;
  }).join("");

  body.innerHTML = `
    <span class="post-detail-cat">중식 샐러드</span>
    <h2 class="post-detail-title">${escapeHtml(titleText)}</h2>
    <div class="post-detail-meta"><span>👤 ${escapeHtml(item.author || "R&D인사팀")}</span><span>·</span><span>${formatDate(item.date)}</span></div>
    ${gallery ? `<div class="image-gallery">${gallery}</div>` : ""}
    ${item.content ? `<div class="post-detail-content">${escapeHtml(item.content)}</div>` : ""}
    <div class="detail-actions">
      <button class="btn btn-danger btn-sm" id="deleteSaladBtn">삭제</button>
    </div>
    <div class="comments-section">
      <h4 id="commentCountLabel">댓글</h4>
      <div class="comment-list" id="commentList"></div>
      <form id="commentForm" class="comment-form">
        <p class="comment-hint">누구나 자유롭게 댓글을 남길 수 있어요.</p>
        <div class="comment-form-row">
          <input type="text" id="commentAuthorInput" placeholder="이름 (선택)" maxlength="20">
          <textarea id="commentTextInput" placeholder="댓글을 입력하세요" required></textarea>
        </div>
        <div id="commentFormStatus"></div>
        <div class="comment-form-actions">
          <button type="submit" class="btn btn-primary btn-sm">댓글 등록</button>
        </div>
      </form>
    </div>`;

  $all(".image-gallery img", body).forEach((img) => img.addEventListener("click", () => openLightbox(img.dataset.full)));
  $("#deleteSaladBtn").addEventListener("click", handleDeleteSalad);

  await renderComments("salad", id);
  $("#commentForm").addEventListener("submit", handleCommentSubmit);
}

async function handleDeleteSalad() {
  if (!confirm("정말 이 글을 삭제하시겠습니까? (댓글도 함께 삭제됩니다)")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 글을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try { await apiDelete(`/salad?id=${currentSaladId}&code=${encodeURIComponent(code)}`); }
  catch (err) { alert("삭제 중 오류가 발생했습니다: " + err.message); return; }
  closeModal("postDetailModal");
  await refreshSaladList();
}

async function renderComments(feedKey, itemId) {
  const listEl = $("#commentList");
  const countLabelEl = $("#commentCountLabel");
  if (!listEl) return;

  let comments;
  try { comments = await apiGet(`/comments?feedKey=${feedKey}&itemId=${itemId}`); }
  catch (err) { listEl.innerHTML = `<div class="comment-empty">댓글을 불러오지 못했습니다.</div>`; return; }

  if (countLabelEl) countLabelEl.textContent = `댓글 ${comments.length}개`;

  if (comments.length === 0) {
    listEl.innerHTML = `<div class="comment-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</div>`;
    return;
  }

  listEl.innerHTML = comments.map((c) => `
    <div class="comment-item">
      <div class="comment-item-head">
        <span class="comment-author">${escapeHtml(c.author || "익명")}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="comment-date">${formatDate(c.date)}</span>
          <button type="button" class="comment-del-btn" data-id="${c.id}">삭제</button>
        </span>
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    </div>`).join("");

  $all(".comment-del-btn", listEl).forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteComment(btn.dataset.id, feedKey, itemId));
  });
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const authorInput = $("#commentAuthorInput");
  const textInput = $("#commentTextInput");
  const statusEl = $("#commentFormStatus");
  const text = textInput.value.trim();
  if (!text) { statusEl.innerHTML = `<div class="status-msg error">댓글 내용을 입력해주세요.</div>`; return; }

  try { await apiPost("/comments", { feedKey: "salad", itemId: currentSaladId, author: authorInput.value.trim(), text }); }
  catch (err) { statusEl.innerHTML = `<div class="status-msg error">댓글 저장에 실패했습니다: ${escapeHtml(err.message)}</div>`; return; }

  textInput.value = ""; statusEl.innerHTML = "";
  await renderComments("salad", currentSaladId);
  const target = saladList.find((p) => p.id === currentSaladId);
  if (target) { target.commentCount = (target.commentCount || 0) + 1; renderSaladFeed(); }
}

async function handleDeleteComment(commentId, feedKey, itemId) {
  if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("댓글 삭제 확인", "댓글을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try { await apiDelete(`/comments?id=${commentId}&code=${encodeURIComponent(code)}`); }
  catch (err) { alert("삭제 중 오류가 발생했습니다: " + err.message); return; }
  await renderComments(feedKey, itemId);
  const target = saladList.find((p) => p.id === itemId);
  if (target) { target.commentCount = Math.max((target.commentCount || 1) - 1, 0); renderSaladFeed(); }
}

const MAX_SALAD_IMAGES = 8;
let saladSelectedImages = [];

function reRenderSaladPreview() {
  renderPreviewGrid($("#saladPreviewGrid"), saladSelectedImages, (idx) => {
    saladSelectedImages.splice(idx, 1); reRenderSaladPreview();
  });
}

setupDropZone($("#saladDropZone"), $("#saladFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  const room = MAX_SALAD_IMAGES - saladSelectedImages.length;
  if (files.length > room) showSaladStatus(`사진은 최대 ${MAX_SALAD_IMAGES}장까지 첨부할 수 있습니다.`, "error");
  for (const file of files.slice(0, Math.max(room, 0))) {
    try { saladSelectedImages.push(await resizeImageFile(file)); }
    catch (e) { showSaladStatus("사진을 처리하는 중 오류가 발생했습니다.", "error"); }
  }
  reRenderSaladPreview();
});

function showSaladStatus(msg, type) {
  $("#saladFormStatus").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
}

$("#newSaladBtn").addEventListener("click", () => {
  saladSelectedImages = []; reRenderSaladPreview(); showSaladStatus("", "");
  $("#saladForm").reset(); openModal("saladModal");
});

$("#saladForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#saladTitleInput").value.trim();
  const author = $("#saladAuthorInput").value.trim();
  const content = $("#saladContentInput").value.trim();
  const code = $("#saladCodeInput").value.trim();
  if (!title) { showSaladStatus("제목을 입력해주세요.", "error"); return; }
  if (!code) { showSaladStatus("인증코드를 입력해주세요.", "error"); return; }

  const submitBtn = $("#saladSubmitBtn");
  submitBtn.disabled = true; submitBtn.textContent = "발행 중...";
  try {
    const newItem = await apiPost("/salad", { title, author, content, images: saladSelectedImages.slice(), code });
    showSaladStatus("등록되었습니다!", "success");
    saladShowCount = 2;
    await refreshSaladList();
    setTimeout(() => { closeModal("saladModal"); openSaladDetail(newItem.id); }, 600);
  } catch (err) {
    showSaladStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "발행하기";
  }
});

/* ---------- 소식지 슬라이더 ---------- */
let newsSlides = [];
let newsSlideIndex = 0;
let newsReorderMode = false;
let newsReorderCode = null;
let newsReorderChanged = false;

let newsTrackEl = null;
let newsDragStartX = 0;
let newsDragDeltaX = 0;
let newsIsDragging = false;
let newsSwipeBound = false;
let newsDragFrameWidth = 1;
let newsDragPendingX = 0;
let newsDragRafId = null;

async function loadNewsSlides() { newsSlides = await apiGet("/news-slides"); }

function updateNewsTrackPosition(animate = true) {
  if (!newsTrackEl || !newsTrackEl.isConnected) return;
  if (!animate) {
    newsTrackEl.classList.add("no-anim");
    newsTrackEl.style.transform = `translateX(-${newsSlideIndex * 100}%)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (newsTrackEl && newsTrackEl.isConnected) newsTrackEl.classList.remove("no-anim");
      });
    });
  } else {
    newsTrackEl.style.transform = `translateX(-${newsSlideIndex * 100}%)`;
  }
}

function updateNewsSliderIndicators() {
  const counterEl = $("#newsSlideCounter");
  if (counterEl) counterEl.textContent = `${newsSlideIndex + 1} / ${newsSlides.length}`;
  $all("#newsSlideDots .news-slider-dot").forEach((dot, idx) => dot.classList.toggle("active", idx === newsSlideIndex));
  $all("#newsSlideThumbs img").forEach((img, idx) => img.classList.toggle("active", idx === newsSlideIndex));
  const moveLeftBtn = $("#newsMoveLeftBtn");
  const moveRightBtn = $("#newsMoveRightBtn");
  if (moveLeftBtn) moveLeftBtn.disabled = newsSlideIndex === 0;
  if (moveRightBtn) moveRightBtn.disabled = newsSlideIndex === newsSlides.length - 1;
}

function updateNewsSlideWindow() {
  if (!newsTrackEl || !newsTrackEl.isConnected) return;
  if (isLightboxOpen()) return;
  const imgs = $all("img", newsTrackEl);
  const len = imgs.length;
  if (len === 0) return;

  const keep = new Set();
  for (let d = -1; d <= 1; d++) keep.add(((newsSlideIndex + d) % len + len) % len);

  imgs.forEach((img, idx) => {
    const wanted = img.dataset.imgsrc;
    if (!wanted) return;
    if (keep.has(idx)) { if (img.getAttribute("src") !== wanted) img.setAttribute("src", wanted); }
    else if (img.hasAttribute("src")) img.removeAttribute("src");
  });
}

function goToNewsSlide(index, animate = true) {
  const len = newsSlides.length;
  if (len === 0) return;
  newsSlideIndex = ((index % len) + len) % len;
  updateNewsTrackPosition(animate);
  updateNewsSliderIndicators();
  updateNewsSlideWindow();
}

function renderNewsSlider() {
  const bodyEl = $("#newsSliderBody");
  const slides = newsSlides;

  if (!slides || slides.length === 0) {
    bodyEl.innerHTML = `
      <div class="news-slider-empty">
        <div class="icon">📰</div>
        아직 등록된 소식지 사진이 없습니다.<br>"＋ 사진 추가"로 첫 소식지 사진을 올려보세요!
      </div>`;
    newsTrackEl = null;
    return;
  }

  if (newsSlideIndex >= slides.length) newsSlideIndex = slides.length - 1;
  if (newsSlideIndex < 0) newsSlideIndex = 0;
  const current = slides[newsSlideIndex];
  const canReorder = slides.length > 1;

  const slidesHtml = slides.map((s, idx) => `
    <div class="news-slider-slide">
      <img data-imgsrc="${imageUrl(s.imageId)}" alt="소식지 사진 ${idx + 1}" decoding="async" draggable="false">
    </div>`).join("");

  bodyEl.innerHTML = `
    <div class="news-slider">
      <div class="news-slider-frame" id="newsSlideFrame">
        <div class="news-slider-track" id="newsSlideTrack">${slidesHtml}</div>
        ${slides.length > 1 ? `
          <button type="button" class="news-slider-nav-btn prev" id="newsSlidePrev">‹</button>
          <button type="button" class="news-slider-nav-btn next" id="newsSlideNext">›</button>
        ` : ""}
        <div class="news-slider-counter" id="newsSlideCounter">${newsSlideIndex + 1} / ${slides.length}</div>
        ${newsReorderMode ? "" : `<button type="button" class="news-slider-delbtn" id="newsSlideDelBtn" title="이 사진 삭제">✕</button>`}
      </div>
      ${slides.length > 1 ? `
        <div class="news-slider-dots" id="newsSlideDots">
          ${slides.map((s, idx) => `<button type="button" class="news-slider-dot ${idx === newsSlideIndex ? "active" : ""}" data-idx="${idx}" aria-label="${idx + 1}번째 사진으로 이동"></button>`).join("")}
        </div>` : ""}
      <div class="news-slider-toolbar">
        ${canReorder ? (newsReorderMode ? `
          <button type="button" class="btn btn-outline btn-sm" id="newsMoveLeftBtn" ${newsSlideIndex === 0 ? "disabled" : ""}>◀ 앞으로</button>
          <button type="button" class="btn btn-outline btn-sm" id="newsMoveRightBtn" ${newsSlideIndex === slides.length - 1 ? "disabled" : ""}>뒤로 ▶</button>
          <button type="button" class="btn btn-primary btn-sm" id="newsReorderDoneBtn">✅ 순서 변경 완료</button>
          <button type="button" class="btn btn-ghost btn-sm" id="newsReorderCancelBtn">취소</button>
          <span class="news-reorder-hint">${newsReorderChanged ? "변경됨 — 완료를 눌러 저장하세요" : "버튼으로 자유롭게 옮긴 뒤 완료를 누르세요"}</span>
        ` : `
          <button type="button" class="btn btn-ghost btn-sm" id="newsReorderToggleBtn">↔ 사진 순서 변경</button>
        `) : ""}
      </div>
      ${slides.length > 1 ? `<div class="news-slider-thumbs" id="newsSlideThumbs"></div>` : ""}
    </div>`;

  newsTrackEl = $("#newsSlideTrack");
  updateNewsTrackPosition(false);
  updateNewsSlideWindow();

  $all(".news-slider-slide img", newsTrackEl).forEach((img) => {
    img.addEventListener("click", () => {
      if (newsReorderMode) return;
      if (Math.abs(newsDragDeltaX) > 5) return;
      const cur = newsSlides[newsSlideIndex];
      if (cur) trackSectionView("news", cur.id);
      openLightboxGallery(slides.map((s) => imageUrl(s.imageId)), newsSlideIndex, (idx) => {
        goToNewsSlide(idx, false);
      });
    });
  });

  const prevBtn = $("#newsSlidePrev");
  const nextBtn = $("#newsSlideNext");
  if (prevBtn) prevBtn.addEventListener("click", () => goToNewsSlide(newsSlideIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToNewsSlide(newsSlideIndex + 1));

  const delBtn = $("#newsSlideDelBtn");
  if (delBtn) delBtn.addEventListener("click", () => handleDeleteNewsSlide(current.id));

  const reorderToggleBtn = $("#newsReorderToggleBtn");
  if (reorderToggleBtn) reorderToggleBtn.addEventListener("click", startNewsReorderMode);

  const moveLeftBtn = $("#newsMoveLeftBtn");
  const moveRightBtn = $("#newsMoveRightBtn");
  if (moveLeftBtn) moveLeftBtn.addEventListener("click", () => moveNewsSlideLocally(newsSlideIndex, newsSlideIndex - 1));
  if (moveRightBtn) moveRightBtn.addEventListener("click", () => moveNewsSlideLocally(newsSlideIndex, newsSlideIndex + 1));

  const doneBtn = $("#newsReorderDoneBtn");
  if (doneBtn) doneBtn.addEventListener("click", finishNewsReorderMode);
  const cancelBtn = $("#newsReorderCancelBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", cancelNewsReorderMode);

  $all("#newsSlideDots .news-slider-dot").forEach((dot) => {
    dot.addEventListener("click", () => goToNewsSlide(Number(dot.dataset.idx)));
  });

  const thumbsEl = $("#newsSlideThumbs");
  if (thumbsEl) {
    thumbsEl.innerHTML = slides.map((s, idx) =>
      `<img src="${imageUrl(s.imageId)}" data-idx="${idx}" class="${idx === newsSlideIndex ? "active" : ""}" alt="썸네일 ${idx + 1}" loading="lazy" decoding="async">`
    ).join("");
    $all("img", thumbsEl).forEach((img) => {
      img.addEventListener("click", () => goToNewsSlide(Number(img.dataset.idx)));
    });
  }

  if (slides.length > 1) setupNewsSwipe();
}

function setupNewsSwipe() {
  const frame = $("#newsSlideFrame");
  if (!frame || !newsTrackEl) return;

  const onStart = (clientX) => {
    if (newsReorderMode) return;
    if (isLightboxOpen()) return;
    newsIsDragging = true;
    newsDragStartX = clientX;
    newsDragDeltaX = 0;
    newsDragFrameWidth = frame.offsetWidth || 1;
    newsTrackEl.classList.add("dragging");
  };
  const onEnd = () => { endNewsDrag(); };

  frame.addEventListener("mousedown", (e) => { e.preventDefault(); onStart(e.clientX); });
  frame.addEventListener("touchstart", (e) => onStart(e.touches[0].clientX), { passive: true });
  frame.addEventListener("touchmove", (e) => {
    if (!newsIsDragging) return;
    scheduleNewsDragFrame(e.touches[0].clientX);
  }, { passive: true });
  frame.addEventListener("touchend", onEnd);
  frame.addEventListener("touchcancel", onEnd);
  frame.addEventListener("dragstart", (e) => e.preventDefault());

  if (!newsSwipeBound) {
    window.addEventListener("mousemove", (e) => {
      if (isLightboxOpen()) { if (newsIsDragging) cancelNewsDrag(); return; }
      if (!newsIsDragging) return;
      scheduleNewsDragFrame(e.clientX);
    });
    window.addEventListener("mouseup", () => {
      if (isLightboxOpen()) { if (newsIsDragging) cancelNewsDrag(); return; }
      if (newsIsDragging) endNewsDrag();
    });
    window.addEventListener("dragend", () => { if (newsIsDragging) cancelNewsDrag(); });
    window.addEventListener("blur", () => { if (newsIsDragging) cancelNewsDrag(); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && newsIsDragging) cancelNewsDrag();
    });
    newsSwipeBound = true;
  }
}

function scheduleNewsDragFrame(clientX) {
  newsDragPendingX = clientX;
  if (newsDragRafId !== null) return;
  newsDragRafId = requestAnimationFrame(() => {
    newsDragRafId = null;
    applyNewsDragTransform();
  });
}

function applyNewsDragTransform() {
  if (!newsIsDragging || !newsTrackEl || !newsTrackEl.isConnected) return;
  newsDragDeltaX = newsDragPendingX - newsDragStartX;
  const percent = (newsDragDeltaX / newsDragFrameWidth) * 100;
  newsTrackEl.style.transform = `translateX(calc(-${newsSlideIndex * 100}% + ${percent}%))`;
}

function endNewsDrag() {
  if (!newsIsDragging) return;
  newsIsDragging = false;
  if (newsDragRafId !== null) { cancelAnimationFrame(newsDragRafId); newsDragRafId = null; }
  if (newsTrackEl && newsTrackEl.isConnected) newsTrackEl.classList.remove("dragging");

  const threshold = newsDragFrameWidth * 0.18;
  if (newsDragDeltaX > threshold) goToNewsSlide(newsSlideIndex - 1);
  else if (newsDragDeltaX < -threshold) goToNewsSlide(newsSlideIndex + 1);
  else updateNewsTrackPosition(true);

  setTimeout(() => { newsDragDeltaX = 0; }, 50);
}

function cancelNewsDrag() {
  newsIsDragging = false;
  if (newsDragRafId !== null) { cancelAnimationFrame(newsDragRafId); newsDragRafId = null; }
  if (newsTrackEl && newsTrackEl.isConnected) newsTrackEl.classList.remove("dragging");
  newsDragDeltaX = 0;
  updateNewsTrackPosition(true);
}

function hardStopNewsDrag() {
  newsIsDragging = false;
  newsDragDeltaX = 0;
  if (newsDragRafId !== null) { cancelAnimationFrame(newsDragRafId); newsDragRafId = null; }
  if (newsTrackEl && newsTrackEl.isConnected) newsTrackEl.classList.remove("dragging");
}

async function startNewsReorderMode() {
  const code = await verifyPasscodeAndGet(
    "사진 순서 변경",
    "순서 변경을 시작하려면 인증코드를 입력해주세요. (이후 완료를 누를 때까지 다시 묻지 않습니다)"
  );
  if (!code) return;
  newsReorderCode = code;
  newsReorderMode = true;
  newsReorderChanged = false;
  renderNewsSlider();
}

function moveNewsSlideLocally(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= newsSlides.length) return;
  const tmp = newsSlides[fromIndex];
  newsSlides[fromIndex] = newsSlides[toIndex];
  newsSlides[toIndex] = tmp;
  newsSlideIndex = toIndex;
  newsReorderChanged = true;
  renderNewsSlider();
}

async function finishNewsReorderMode() {
  const doneBtn = $("#newsReorderDoneBtn");
  if (!newsReorderChanged) { exitNewsReorderMode(); renderNewsSlider(); return; }
  if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = "저장 중..."; }
  try {
    await apiPut("/news-slides/reorder", { order: newsSlides.map((s) => s.id), code: newsReorderCode });
    exitNewsReorderMode();
    await loadNewsSlides();
    renderNewsSlider();
  } catch (err) {
    alert("순서 저장에 실패했습니다: " + err.message);
    if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = "✅ 순서 변경 완료"; }
  }
}

async function cancelNewsReorderMode() {
  if (newsReorderChanged && !confirm("변경한 순서를 저장하지 않고 취소할까요?")) return;
  exitNewsReorderMode();
  await loadNewsSlides();
  renderNewsSlider();
}

function exitNewsReorderMode() {
  newsReorderMode = false; newsReorderCode = null; newsReorderChanged = false;
}

async function handleDeleteNewsSlide(id) {
  if (!confirm("이 사진을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 사진을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try { await apiDelete(`/news-slides?id=${id}&code=${encodeURIComponent(code)}`); }
  catch (err) { alert("삭제 중 오류가 발생했습니다: " + err.message); return; }
  await loadNewsSlides();
  renderNewsSlider();
}

let newsUploadSelectedImages = [];

function reRenderNewsUploadPreview() {
  renderPreviewGrid($("#newsUploadPreviewGrid"), newsUploadSelectedImages, (idx) => {
    newsUploadSelectedImages.splice(idx, 1); reRenderNewsUploadPreview();
  });
}

function showNewsUploadStatus(msg, type) {
  $("#newsUploadFormStatus").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
}

setupDropZone($("#newsUploadDropZone"), $("#newsUploadFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  const room = MAX_NEWS_SLIDES - newsSlides.length - newsUploadSelectedImages.length;
  if (files.length > room) {
    showNewsUploadStatus(`소식지 사진은 최대 ${MAX_NEWS_SLIDES}장까지 보관할 수 있습니다. 지금 ${Math.max(room, 0)}장까지만 추가할 수 있어요.`, "error");
  }
  for (const file of files.slice(0, Math.max(room, 0))) {
    try { newsUploadSelectedImages.push(await resizeImageFile(file, 1280, 0.82)); }
    catch (e) { showNewsUploadStatus("사진을 처리하는 중 오류가 발생했습니다.", "error"); }
  }
  reRenderNewsUploadPreview();
});

$("#newsUploadBtn").addEventListener("click", () => {
  newsUploadSelectedImages = []; reRenderNewsUploadPreview(); showNewsUploadStatus("", "");
  $("#newsUploadForm").reset();
  $("#newsUploadModalDesc").textContent = `새로 올린 사진이 맨 앞에 표시됩니다. (현재 ${newsSlides.length}장 · 최대 ${MAX_NEWS_SLIDES}장까지 보관 가능)`;
  openModal("newsUploadModal");
});

$("#newsUploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#newsUploadCodeInput").value.trim();
  if (!newsUploadSelectedImages.length) { showNewsUploadStatus("사진을 최소 1장 첨부해주세요.", "error"); return; }
  if (!code) { showNewsUploadStatus("인증코드를 입력해주세요.", "error"); return; }

  const submitBtn = $("#newsUploadSubmitBtn");
  submitBtn.disabled = true; submitBtn.textContent = "추가하는 중...";
  try {
    const result = await apiPost("/news-slides", { images: newsUploadSelectedImages.slice(), code });
    showNewsUploadStatus(result.message || "사진이 추가되었습니다!", result.skipped > 0 ? "error" : "success");
    newsSlideIndex = 0;
    await loadNewsSlides();
    renderNewsSlider();
    if (!result.skipped) setTimeout(() => closeModal("newsUploadModal"), 700);
  } catch (err) {
    showNewsUploadStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "추가하기";
  }
});

/* ---------- 라이트박스 (버튼으로만 넘김) ---------- */
let lightboxGalleryImages = null;
let lightboxGalleryIndex = 0;
let lightboxOnIndexChange = null;
let lightboxIsBusy = false;

function isLightboxOpen() {
  const el = $("#lightbox");
  return !!el && el.classList.contains("open");
}

function openLightbox(src) {
  lightboxGalleryImages = null;
  lightboxOnIndexChange = null;
  lightboxIsBusy = false;
  setLightboxImage(src);
  $("#lightbox").classList.remove("gallery-mode");
  openModal("lightbox");
}

function openLightboxGallery(images, startIndex, onIndexChange) {
  hardStopNewsDrag();
  lightboxGalleryImages = images;
  lightboxGalleryIndex = Math.max(0, Math.min(startIndex || 0, images.length - 1));
  lightboxOnIndexChange = onIndexChange || null;
  lightboxIsBusy = false;
  renderLightboxGalleryFrame();
  $("#lightbox").classList.add("gallery-mode");
  openModal("lightbox");
}

function setLightboxImage(src) {
  const imgEl = $("#lightboxImg");
  if (!imgEl) return;
  if (imgEl.getAttribute("src") === src) return;
  imgEl.setAttribute("src", src);
}

function renderLightboxGalleryFrame() {
  setLightboxImage(lightboxGalleryImages[lightboxGalleryIndex]);
  $("#lightboxCounter").textContent = `${lightboxGalleryIndex + 1} / ${lightboxGalleryImages.length}`;
}

function lightboxGalleryStep(delta) {
  if (!lightboxGalleryImages || lightboxIsBusy) return;
  lightboxIsBusy = true;
  lightboxGalleryIndex = (lightboxGalleryIndex + delta + lightboxGalleryImages.length) % lightboxGalleryImages.length;
  renderLightboxGalleryFrame();
  const slide = newsSlides[lightboxGalleryIndex];
  if (slide) trackSectionView("news", slide.id);
  setTimeout(() => { lightboxIsBusy = false; }, 200);
}

function closeLightbox() {
  if (lightboxOnIndexChange && lightboxGalleryImages) lightboxOnIndexChange(lightboxGalleryIndex);
  lightboxGalleryImages = null;
  lightboxOnIndexChange = null;
  lightboxIsBusy = false;

  const img = $("#lightboxImg");
  if (img) { img.style.transition = ""; img.style.transform = ""; img.removeAttribute("src"); }

  closeModal("lightbox");
  hardStopNewsDrag();
  requestAnimationFrame(() => { updateNewsTrackPosition(false); updateNewsSlideWindow(); });
}

$("#lightboxClose").addEventListener("click", closeLightbox);
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
$("#lightboxPrev").addEventListener("click", (e) => { e.stopPropagation(); lightboxGalleryStep(-1); });
$("#lightboxNext").addEventListener("click", (e) => { e.stopPropagation(); lightboxGalleryStep(1); });
document.addEventListener("keydown", (e) => {
  if (!isLightboxOpen()) return;
  if (e.key === "ArrowLeft") lightboxGalleryStep(-1);
  else if (e.key === "ArrowRight") lightboxGalleryStep(1);
  else if (e.key === "Escape") closeLightbox();
});

(function setupLightboxImageGuard() {
  const lb = $("#lightbox");
  const img = $("#lightboxImg");
  if (!lb || !img) return;
  img.setAttribute("draggable", "false");
  img.addEventListener("dragstart", (e) => e.preventDefault());
  lb.addEventListener("dragstart", (e) => e.preventDefault());
})();

/* ---------- 알림 배너 ---------- */
function renderServerErrorBanner(err) {
  $("#noticeBanner").innerHTML = `
    <div class="notice-banner error">
      <span>⚠️</span>
      <span>
        <b>서버와 통신하는 중 문제가 발생했습니다.</b> 인터넷 연결을 확인하고 새로고침 해보세요.<br>
        ${err && err.message ? `<span style="opacity:.8;">(오류 메시지: ${escapeHtml(err.message)})</span>` : ""}
      </span>
    </div>`;
}

function renderMigrationBanner(migration) {
  if (!migration || !migration.counts) return;
  const total = Object.values(migration.counts).reduce((a, b) => a + b, 0);
  if (total === 0) return;
  const ageMs = Date.now() - new Date(migration.migratedAt).getTime();
  if (ageMs > 10000) return;

  $("#noticeBanner").innerHTML = `
    <div class="notice-banner">
      <span>✅</span>
      <span><b>기존 사진 ${total}장을 새 저장 방식으로 자동 이전했습니다.</b></span>
      <button class="close-notice" id="closeNoticeBtn">×</button>
    </div>`;
  const btn = $("#closeNoticeBtn");
  if (btn) btn.addEventListener("click", () => { $("#noticeBanner").innerHTML = ""; });
}

/* ---------- 사이트 꾸미기 ---------- */
let pendingAvatarData = null;
let currentBgPreviewData = null;
let currentBgImageId = null;
let currentBgAdjust = { ...BG_DEFAULT_ADJUST };

function applySitePrefsToPage(prefs) {
  const brandMark = $("#brandMark");
  if (prefs && prefs.avatar && prefs.avatar.imageId) {
    brandMark.innerHTML = `<img src="${imageUrl(prefs.avatar.imageId)}" alt="프로필 사진" decoding="async">`;
  } else {
    brandMark.innerHTML = "R&D";
  }

  const topbarEl = $("#topbarEl");
  const topbarImg = $("#topbarBgImg");
  if (prefs && prefs.background && prefs.background.imageId) {
    const { imageId, posX, posY, zoom } = prefs.background;
    topbarImg.src = imageUrl(imageId);
    topbarImg.style.objectPosition = `${posX}% ${posY}%`;
    topbarImg.style.transform = `scale(${zoom / 100})`;
    topbarEl.classList.add("has-bg-photo");
  } else {
    topbarImg.removeAttribute("src");
    topbarImg.style.transform = "";
    topbarEl.classList.remove("has-bg-photo");
  }
}

async function refreshSitePrefs() {
  try { const prefs = await apiGet("/site-prefs"); applySitePrefsToPage(prefs); return prefs; }
  catch (err) { return null; }
}

function renderBgPreview() {
  const previewBox = $("#bgPreview");
  const previewImg = $("#bgPreviewImg");
  if (currentBgPreviewData) {
    previewImg.src = currentBgPreviewData;
    previewImg.style.objectPosition = `${currentBgAdjust.posX}% ${currentBgAdjust.posY}%`;
    previewImg.style.transform = `scale(${currentBgAdjust.zoom / 100})`;
    previewBox.classList.add("has-photo");
  } else {
    previewImg.removeAttribute("src");
    previewBox.classList.remove("has-photo");
  }
}

function setBgSliderValues(adjust) {
  $("#bgPosXInput").value = adjust.posX;
  $("#bgPosYInput").value = adjust.posY;
  $("#bgZoomInput").value = adjust.zoom;
  $("#bgPosXVal").textContent = adjust.posX + "%";
  $("#bgPosYVal").textContent = adjust.posY + "%";
  $("#bgZoomVal").textContent = adjust.zoom + "%";
}

["bgPosXInput", "bgPosYInput", "bgZoomInput"].forEach((id) => {
  $("#" + id).addEventListener("input", (e) => {
    const key = id === "bgPosXInput" ? "posX" : id === "bgPosYInput" ? "posY" : "zoom";
    currentBgAdjust[key] = Number(e.target.value);
    setBgSliderValues(currentBgAdjust);
    renderBgPreview();
  });
});

async function refreshAppearanceSettingsPreview() {
  let prefs;
  try { prefs = await apiGet("/site-prefs"); } catch (err) { prefs = { avatar: null, background: null }; }

  const avatarPreview = $("#avatarPreview");
  avatarPreview.innerHTML = (prefs.avatar && prefs.avatar.imageId)
    ? `<img src="${imageUrl(prefs.avatar.imageId)}" alt="프로필 사진">` : "R&D";
  pendingAvatarData = null;

  if (prefs.background && prefs.background.imageId) {
    currentBgImageId = prefs.background.imageId;
    currentBgPreviewData = imageUrl(prefs.background.imageId);
    currentBgAdjust = {
      posX: prefs.background.posX ?? BG_DEFAULT_ADJUST.posX,
      posY: prefs.background.posY ?? BG_DEFAULT_ADJUST.posY,
      zoom: prefs.background.zoom ?? BG_DEFAULT_ADJUST.zoom,
    };
  } else {
    currentBgImageId = null; currentBgPreviewData = null;
    currentBgAdjust = { ...BG_DEFAULT_ADJUST };
  }
  setBgSliderValues(currentBgAdjust);
  renderBgPreview();
  $("#avatarStatus").innerHTML = "";
  $("#bgStatus").innerHTML = "";
}

setupDropZone($("#avatarDropZone"), $("#avatarFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  try {
    pendingAvatarData = await resizeImageFile(files[0], 400, 0.85);
    $("#avatarPreview").innerHTML = `<img src="${pendingAvatarData}" alt="프로필 사진 미리보기">`;
    $("#avatarStatus").innerHTML = `<div class="status-msg success">미리보기가 적용되었습니다. 아래 "프로필 사진 저장" 버튼을 눌러 확정하세요.</div>`;
  } catch (e) {
    $("#avatarStatus").innerHTML = `<div class="status-msg error">사진을 처리하는 중 오류가 발생했습니다.</div>`;
  }
});

$("#saveAvatarBtn").addEventListener("click", async () => {
  if (!pendingAvatarData) { $("#avatarStatus").innerHTML = `<div class="status-msg error">먼저 새 사진을 선택해주세요.</div>`; return; }
  const code = await verifyPasscodeAndGet("프로필 사진 저장", "프로필 사진을 변경하려면 인증코드를 입력해주세요.");
  if (!code) return;
  const saveBtn = $("#saveAvatarBtn");
  saveBtn.disabled = true; saveBtn.textContent = "저장 중...";
  try {
    await apiPut("/site-prefs", { type: "avatar", data: pendingAvatarData, code });
    await refreshSitePrefs();
    $("#avatarStatus").innerHTML = `<div class="status-msg success">프로필 사진이 저장되었습니다.</div>`;
    pendingAvatarData = null;
  } catch (err) {
    $("#avatarStatus").innerHTML = `<div class="status-msg error">저장에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "프로필 사진 저장";
  }
});

$("#resetAvatarBtn").addEventListener("click", async () => {
  const code = await verifyPasscodeAndGet("프로필 사진 초기화", "기본값(R&D 텍스트)으로 되돌리려면 인증코드를 입력해주세요.");
  if (!code) return;
  const resetBtn = $("#resetAvatarBtn");
  resetBtn.disabled = true; resetBtn.textContent = "처리 중...";
  try {
    await apiDelete(`/site-prefs?type=avatar&code=${encodeURIComponent(code)}`);
    await refreshSitePrefs();
    await refreshAppearanceSettingsPreview();
    $("#avatarStatus").innerHTML = `<div class="status-msg success">기본값으로 되돌렸습니다.</div>`;
  } catch (err) {
    $("#avatarStatus").innerHTML = `<div class="status-msg error">초기화에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    resetBtn.disabled = false; resetBtn.textContent = "기본값으로";
  }
});

setupDropZone($("#bgDropZone"), $("#bgFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  try {
    currentBgPreviewData = await resizeImageFile(files[0], 1920, 0.85);
    currentBgImageId = null;
    currentBgAdjust = { ...BG_DEFAULT_ADJUST };
    setBgSliderValues(currentBgAdjust);
    renderBgPreview();
    $("#bgStatus").innerHTML = `<div class="status-msg success">미리보기가 적용되었습니다. 슬라이더로 위치/확대를 조정한 뒤 "배경 사진 저장" 버튼을 눌러 확정하세요.</div>`;
  } catch (e) {
    $("#bgStatus").innerHTML = `<div class="status-msg error">사진을 처리하는 중 오류가 발생했습니다.</div>`;
  }
});

$("#saveBgBtn").addEventListener("click", async () => {
  if (!currentBgPreviewData) { $("#bgStatus").innerHTML = `<div class="status-msg error">먼저 사진을 선택해주세요.</div>`; return; }
  const code = await verifyPasscodeAndGet("배경 사진 저장", "배경 사진을 변경하려면 인증코드를 입력해주세요.");
  if (!code) return;
  const saveBtn = $("#saveBgBtn");
  saveBtn.disabled = true; saveBtn.textContent = "저장 중...";
  try {
    const payloadData = currentBgImageId ? currentBgImageId : currentBgPreviewData;
    await apiPut("/site-prefs", {
      type: "background", data: payloadData,
      posX: currentBgAdjust.posX, posY: currentBgAdjust.posY, zoom: currentBgAdjust.zoom, code,
    });
    await refreshSitePrefs();
    await refreshAppearanceSettingsPreview();
    $("#bgStatus").innerHTML = `<div class="status-msg success">배경 사진이 저장되었습니다.</div>`;
  } catch (err) {
    $("#bgStatus").innerHTML = `<div class="status-msg error">저장에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "배경 사진 저장";
  }
});

$("#resetBgBtn").addEventListener("click", async () => {
  const code = await verifyPasscodeAndGet("배경 사진 초기화", "기본 그라데이션으로 되돌리려면 인증코드를 입력해주세요.");
  if (!code) return;
  const resetBtn = $("#resetBgBtn");
  resetBtn.disabled = true; resetBtn.textContent = "처리 중...";
  try {
    await apiDelete(`/site-prefs?type=background&code=${encodeURIComponent(code)}`);
    await refreshSitePrefs();
    await refreshAppearanceSettingsPreview();
    $("#bgStatus").innerHTML = `<div class="status-msg success">기본값으로 되돌렸습니다.</div>`;
  } catch (err) {
    $("#bgStatus").innerHTML = `<div class="status-msg error">초기화에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    resetBtn.disabled = false; resetBtn.textContent = "기본값으로";
  }
});

/* ---------- 섹션 제목 ---------- */
function applySectionTitlesToPage(titles) {
  titles = titles || {};
  $("#saladTitle").textContent = titles.salad || SECTION_TITLE_DEFAULTS.salad;
  $("#newsletterTitle").textContent = titles.news || SECTION_TITLE_DEFAULTS.news;
  $("#mealplanTitle").textContent = titles.mealplan || SECTION_TITLE_DEFAULTS.mealplan;
  $("#mealboxTitle").textContent = titles.mealbox || SECTION_TITLE_DEFAULTS.mealbox;
}

async function refreshSectionTitlesPreview() {
  let titles;
  try { titles = await apiGet("/section-titles"); } catch (err) { titles = {}; }
  $("#titleSaladInput").value = titles.salad || "";
  $("#titleNewsInput").value = titles.news || "";
  $("#titleMealplanInput").value = titles.mealplan || "";
  $("#titleMealboxInput").value = titles.mealbox || "";
  $("#settingsTitlesStatus").innerHTML = "";
}

$("#saveTitlesBtn").addEventListener("click", async () => {
  const code = await verifyPasscodeAndGet("섹션 제목 저장", "섹션 제목을 변경하려면 인증코드를 입력해주세요.");
  if (!code) return;
  const saveBtn = $("#saveTitlesBtn");
  saveBtn.disabled = true; saveBtn.textContent = "저장 중...";
  try {
    const titles = {
      salad: $("#titleSaladInput").value.trim(),
      news: $("#titleNewsInput").value.trim(),
      mealplan: $("#titleMealplanInput").value.trim(),
      mealbox: $("#titleMealboxInput").value.trim(),
    };
    const saved = await apiPut("/section-titles", { titles, code });
    applySectionTitlesToPage(saved);
    $("#settingsTitlesStatus").innerHTML = `<div class="status-msg success">제목이 저장되었습니다.</div>`;
  } catch (err) {
    $("#settingsTitlesStatus").innerHTML = `<div class="status-msg error">저장에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "제목 저장";
  }
});

/* ---------- 조회수 화면 ---------- */
function sectionLabel(key) {
  const titles = (bootData && bootData.titles) || {};
  return titles[key] || SECTION_TITLE_DEFAULTS[key];
}

/* 지금 선택된 기간 (day = 일자별, week = 주별, month = 월별) */
let statsPeriod = "day";

async function refreshStatsPane() {
  const box = $("#statsContent");
  box.innerHTML = `<div class="empty-mini">불러오는 중...</div>`;

  let s;
  try { s = await apiGet(`/stats?period=${statsPeriod}`); }
  catch (err) {
    box.innerHTML = `<div class="status-msg error">조회수를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const periodLabel = s.periodLabel || "오늘";
  const trend = s.site.trend || [];

  /* 기간 선택 버튼 (일자별 / 주별 / 월별) */
  const periodTabs = [
    ["day", "일자별"],
    ["week", "주별"],
    ["month", "월별"],
  ].map(([key, label]) => `
    <button type="button" class="stats-period-btn ${statsPeriod === key ? "active" : ""}" data-period="${key}">${label}</button>
  `).join("");

  /* 막대그래프: 가장 큰 값을 100%로 환산해 표시 */
  const maxCount = Math.max(1, ...trend.map((d) => d.count));
  const chart = trend.map((d) => {
    const h = Math.round((d.count / maxCount) * 100);
    return `
      <div class="stats-bar-col" title="${d.key}: ${d.count}회">
        <div class="stats-bar-value">${d.count}</div>
        <div class="stats-bar-wrap"><div class="stats-bar" style="height:${Math.max(h, 3)}%"></div></div>
        <div class="stats-bar-label">${escapeHtml(d.label)}</div>
      </div>`;
  }).join("");

  const chartTitle = statsPeriod === "day" ? "최근 7일 방문 추이"
    : statsPeriod === "week" ? "최근 8주 방문 추이"
    : "최근 6개월 방문 추이";

  const sectionRows = ["news", "salad", "mealplan", "mealbox"].map((k) => `
    <div class="stats-row">
      <span class="stats-row-name">${escapeHtml(sectionLabel(k))}</span>
      <span class="stats-row-today">${periodLabel} ${s.sections[k].current}</span>
      <span class="stats-row-total">${s.sections[k].total}회</span>
    </div>`).join("");

  const slideRows = s.slides.length
    ? s.slides.map((sl) => `
        <div class="stats-row">
          <img class="stats-thumb" src="${imageUrl(sl.imageId)}" alt="${sl.order}번 사진" loading="lazy" decoding="async">
          <span class="stats-row-name">${sl.order}번째 사진</span>
          <span class="stats-row-today">${periodLabel} ${sl.current}</span>
          <span class="stats-row-total">${sl.total}회</span>
        </div>`).join("")
    : `<div class="empty-mini">등록된 소식지 사진이 없습니다.</div>`;

  box.innerHTML = `
    <div class="stats-period-tabs">${periodTabs}</div>

    <div class="stats-cards">
      <div class="stats-card primary">
        <div class="stats-card-label">전체 방문</div>
        <div class="stats-card-num">${s.site.total.toLocaleString()}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-label">${periodLabel} 방문</div>
        <div class="stats-card-num">${s.site.current.toLocaleString()}</div>
      </div>
    </div>

    <h4 class="stats-h">${chartTitle}</h4>
    <div class="stats-chart">${chart}</div>

    <h4 class="stats-h">섹션별 조회수</h4>
    <div class="stats-list">${sectionRows}</div>

    <h4 class="stats-h">소식지 사진별 조회수</h4>
    <div class="stats-list">${slideRows}</div>

    <p class="stats-note">
      오른쪽 굵은 숫자는 <b>누적 전체</b>, 왼쪽 회색 표시는 <b>${periodLabel}</b> 수치입니다.<br>
      같은 사람이 반복해서 봐도 과도하게 집계되지 않도록, 방문은 하루 1회·사진 조회는 30분에 1회까지만 세어집니다.
    </p>

    <div class="btn-row" style="justify-content:flex-start;">
      <button type="button" class="btn btn-ghost btn-sm" id="statsRefreshBtn">🔄 새로고침</button>
      <button type="button" class="btn btn-danger btn-sm" id="statsResetBtn">조회수 초기화</button>
    </div>
    <div id="statsActionStatus"></div>`;

  /* 기간 버튼을 누르면 해당 기간으로 다시 불러옵니다. */
  $all(".stats-period-btn", box).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (statsPeriod === btn.dataset.period) return;
      statsPeriod = btn.dataset.period;
      refreshStatsPane();
    });
  });

  $("#statsRefreshBtn").addEventListener("click", refreshStatsPane);
  $("#statsResetBtn").addEventListener("click", handleResetStats);
}

async function handleResetStats() {
  if (!confirm("지금까지 기록된 조회수를 모두 0으로 되돌립니다. 계속할까요?")) return;
  const code = await verifyPasscodeAndGet("조회수 초기화", "조회수를 초기화하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiPost("/stats/reset", { code });
    await refreshStatsPane();
    const el = $("#statsActionStatus");
    if (el) el.innerHTML = `<div class="status-msg success">조회수가 초기화되었습니다.</div>`;
  } catch (err) {
    const el = $("#statsActionStatus");
    if (el) el.innerHTML = `<div class="status-msg error">초기화에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

/* ---------- 설정 모달 ---------- */
$("#settingsBtn").addEventListener("click", () => {
  refreshAppearanceSettingsPreview();
  refreshSectionTitlesPreview();
  $("#currentCodeInput").value = "";
  $("#newCodeInput").value = "";
  $("#newCodeConfirmInput").value = "";
  $("#settingsCodeStatus").innerHTML = "";
  openModal("settingsModal");
});

$all(".settings-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $all(".settings-tabs button").forEach((b) => b.classList.remove("active"));
    $all(".settings-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#pane-" + btn.dataset.pane).classList.add("active");
    if (btn.dataset.pane === "stats") refreshStatsPane();
  });
});

$("#changeCodeBtn").addEventListener("click", async () => {
  const currentCode = $("#currentCodeInput").value.trim();
  const newCode = $("#newCodeInput").value.trim();
  const confirmCode = $("#newCodeConfirmInput").value.trim();

  if (!currentCode) { $("#settingsCodeStatus").innerHTML = `<div class="status-msg error">현재 인증코드를 입력해주세요.</div>`; return; }
  if (!newCode) { $("#settingsCodeStatus").innerHTML = `<div class="status-msg error">새 인증코드를 입력해주세요.</div>`; return; }
  if (newCode !== confirmCode) { $("#settingsCodeStatus").innerHTML = `<div class="status-msg error">확인 코드가 일치하지 않습니다.</div>`; return; }

  const btn = $("#changeCodeBtn");
  btn.disabled = true; btn.textContent = "변경 중...";
  try {
    await apiPost("/auth/change", { currentCode, newCode });
    $("#settingsCodeStatus").innerHTML = `<div class="status-msg success">인증코드가 변경되었습니다.</div>`;
    $("#currentCodeInput").value = ""; $("#newCodeInput").value = ""; $("#newCodeConfirmInput").value = "";
  } catch (err) {
    $("#settingsCodeStatus").innerHTML = `<div class="status-msg error">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "변경하기";
  }
});

/* ---------- 초기화 ---------- */
(async function init() {
  try {
    bootData = await apiGet("/bootstrap");

    applySectionTitlesToPage(bootData.titles);
    applySitePrefsToPage(bootData.prefs);
    renderGalleryFromRecord("mealplan", bootData.gallery && bootData.gallery.mealplan);
    renderGalleryFromRecord("mealbox", bootData.gallery && bootData.gallery.mealbox);

    saladList = bootData.salad || [];
    renderSaladFeed();

    newsSlides = bootData.newsSlides || [];
    newsSlideIndex = 0;
    renderNewsSlider();

    renderMigrationBanner(bootData.migration);
    trackSiteVisit();
  } catch (err) {
    console.error("초기 로딩 오류:", err);
    renderServerErrorBanner(err);
  }
})();
