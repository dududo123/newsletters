/* ============================================================
   R&D본부 소식지 — 서버 연동 버전 (Netlify Functions + Blobs)
   모든 데이터는 /api/* 서버 API를 통해 저장/조회되므로, 누가 수정하든
   다른 방문자가 새로고침하면 즉시 동일한 내용을 보게 됩니다.
   ============================================================ */

const API_BASE = "/api";
const MAX_NEWS_SLIDES = 20;
const SECTION_TITLE_DEFAULTS = {
  salad: "중식 샐러드 신청공간",
  news: "소식지",
  mealplan: "식단표",
  mealbox: "밀박스",
};
const GALLERY_LABELS = { mealplan: "식단표", mealbox: "밀박스" };
const BG_DEFAULT_ADJUST = { posX: 50, posY: 50, zoom: 100 };

/* ============================================================
   0. 유틸리티
   ============================================================ */
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

/* 이미지 리사이즈(용량 절감): 파일 -> 압축된 JPEG dataURL */
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

/* 서버 요청 도우미: 타임아웃(15초)과 에러 메시지 처리를 공용으로 관리 */
async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 응답 본문이 없을 수도 있음 */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `서버 오류 (${res.status})`);
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("서버 응답이 15초 안에 오지 않았습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    throw err;
  }
}
const apiGet = (path) => apiFetch(path, { method: "GET" });
const apiPost = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body) });
const apiPut = (path, body) => apiFetch(path, { method: "PUT", body: JSON.stringify(body) });
const apiDelete = (path) => apiFetch(path, { method: "DELETE" });

/* ============================================================
   1. 모달 공용 제어
   ============================================================ */
function openModal(id) { $("#" + id).classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }

$all("[data-close]").forEach((el) => {
  el.addEventListener("click", () => closeModal(el.dataset.close));
});
$all(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
});

/* ============================================================
   2. 인증코드 확인 모달 (삭제 등 단순 확인용)
   서버가 실제 정답을 갖고 있으므로, /api/auth/verify 로 서버에 물어봅니다.
   ============================================================ */
function askPasscode(title, desc) {
  return new Promise((resolve) => {
    const input = $("#passModalInput");
    const confirmBtn = $("#passModalConfirm");
    const cancelBtn = $("#passModalCancel");

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
      resolve(val);
    };
    confirmBtn.onclick = () => cleanup(input.value.trim());
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => { if (e.key === "Enter") cleanup(input.value.trim()); };
  });
}

/* code가 맞으면 그 code 문자열을 그대로 반환하고, 취소/틀림이면 null을 반환합니다.
   (기존 클라이언트 저장 방식과 달리, 실제 검증은 각 API 호출 시 서버에서 다시 한번
   이루어지므로 여기서는 "미리 확인"의 의미가 큽니다) */
async function verifyPasscodeAndGet(title, desc) {
  const val = await askPasscode(title, desc);
  if (val === null) return null;
  try {
    const result = await apiPost("/auth/verify", { code: val });
    if (!result.ok) {
      alert("인증코드가 올바르지 않습니다.");
      return null;
    }
    return val;
  } catch (err) {
    alert("인증 확인 중 오류가 발생했습니다: " + err.message);
    return null;
  }
}

/* ============================================================
   3. 공용 헬퍼: 드롭존 / 미리보기
   ============================================================ */
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
  $all(".remove", gridEl).forEach((btn) => {
    btn.addEventListener("click", () => onRemove(Number(btn.dataset.idx)));
  });
}

/* ============================================================
   4. 이미지 갤러리 (식단표 / 밀박스 — 사진 1장만 유지, 서버에 저장)
   ============================================================ */
async function renderGallery(catKey) {
  const bodyEl = $("#galleryBody-" + catKey);
  const label = GALLERY_LABELS[catKey];

  let record;
  try {
    record = await apiGet(`/gallery?category=${catKey}`);
  } catch (err) {
    console.error(`[${catKey}] 목록을 불러오지 못했습니다:`, err);
    bodyEl.innerHTML = `<div class="gallery-empty"><div class="icon">⚠️</div>목록을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.</div>`;
    return;
  }

  if (!record || !record.data) {
    bodyEl.innerHTML = `
      <div class="gallery-empty">
        <div class="icon">🖼️</div>
        아직 업로드된 사진이 없습니다.
      </div>`;
    return;
  }

  bodyEl.innerHTML = `
    <div class="gallery-single">
      <div class="gallery-single-frame">
        <img src="${record.data}" alt="${label}">
        <button type="button" class="del-btn" title="삭제">✕</button>
      </div>
      <div class="gallery-single-meta">${formatDate(record.date)} 업로드</div>
    </div>`;

  const frame = $(".gallery-single-frame", bodyEl);
  frame.querySelector("img").addEventListener("click", () => openLightbox(record.data));
  frame.querySelector(".del-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteGalleryImage(catKey);
  });
}

async function handleDeleteGalleryImage(catKey) {
  if (!confirm("이 사진을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 사진을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiDelete(`/gallery?category=${catKey}&code=${encodeURIComponent(code)}`);
    await renderGallery(catKey);
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
  }
}

async function renderAllGalleries() {
  await renderGallery("mealplan");
  await renderGallery("mealbox");
}

/* ---- 업로드 모달 (식단표/밀박스 공용) ---- */
let uploadTargetCategory = null;
let uploadSelectedImage = null;

function reRenderUploadPreview() {
  renderPreviewGrid($("#uploadPreviewGrid"), uploadSelectedImage ? [uploadSelectedImage] : [], () => {
    uploadSelectedImage = null;
    reRenderUploadPreview();
  });
}

setupDropZone($("#uploadDropZone"), $("#uploadFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  if (files.length > 1) showUploadStatus("이 항목은 사진을 1장만 업로드할 수 있어 첫 번째 사진만 선택되었습니다.", "error");
  try {
    uploadSelectedImage = await resizeImageFile(files[0], 1600, 0.8);
  } catch (e) {
    console.error(e);
    showUploadStatus("사진을 처리하는 중 오류가 발생했습니다.", "error");
  }
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
    await renderGallery(uploadTargetCategory);
    setTimeout(() => closeModal("uploadModal"), 700);
  } catch (err) {
    console.error(`[${uploadTargetCategory}] 업로드 실패:`, err);
    showUploadStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "업로드";
  }
});

/* ============================================================
   5. 중식 샐러드 신청공간 (피드형: 목록·검색·상세보기·댓글, 서버 저장)
   ============================================================ */
let saladSearchKeyword = "";
let saladShowCount = 2;
const PAGE_STEP = 3;

async function renderSaladFeed() {
  const listEl = $("#saladList");
  const moreRowEl = $("#saladMoreRow");

  let posts;
  try {
    posts = await apiGet("/salad");
  } catch (err) {
    console.error("샐러드 목록을 불러오지 못했습니다:", err);
    listEl.innerHTML = `<div class="empty-mini">⚠️ 목록을 불러오지 못했습니다. 페이지를 새로고침해보세요.</div>`;
    moreRowEl.innerHTML = "";
    return;
  }

  let sorted = posts.slice(); // 서버가 이미 최신순 정렬해서 줌
  if (saladSearchKeyword.trim()) {
    const kw = saladSearchKeyword.trim().toLowerCase();
    sorted = sorted.filter((p) => (p.title || "").toLowerCase().includes(kw));
  }

  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="empty-mini">🥗 ${saladSearchKeyword.trim() ? "검색 결과가 없습니다." : "아직 등록된 글이 없습니다. '새 포스트'로 첫 글을 올려보세요!"}</div>`;
    moreRowEl.innerHTML = "";
    return;
  }

  let commentCountMap = {};
  try {
    const allForCounts = await Promise.all(sorted.slice(0, saladShowCount).map((p) => apiGet(`/comments?feedKey=salad&itemId=${p.id}`)));
    sorted.slice(0, saladShowCount).forEach((p, idx) => { commentCountMap[p.id] = allForCounts[idx].length; });
  } catch (err) {
    console.error("댓글 개수 집계 실패:", err);
  }

  const visible = sorted.slice(0, saladShowCount);
  listEl.innerHTML = visible.map((p) => {
    const titleText = p.title && p.title.trim() ? p.title : "중식 샐러드";
    const thumb = (p.images && p.images.length)
      ? `<img class="news-thumb" src="${p.images[0]}" alt="${escapeHtml(titleText)}">`
      : `<div class="news-thumb placeholder">🥗</div>`;
    const snippet = (p.content || "").slice(0, 60);
    const commentCount = commentCountMap[p.id] || 0;
    return `
      <button type="button" class="news-item" data-id="${p.id}">
        ${thumb}
        <div class="news-item-body">
          <div class="news-title">${escapeHtml(titleText)}</div>
          ${snippet ? `<div class="news-snippet">${escapeHtml(snippet)}</div>` : ""}
          <div class="news-meta"><span>👤</span><span>${escapeHtml(p.author || "R&D인사팀")}</span><span>·</span><span>${formatDate(p.date)}</span><span>·</span><span>💬 ${commentCount}</span></div>
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

$("#saladSearchToggle").addEventListener("click", () => {
  const row = $("#saladSearchRow");
  const isHidden = row.style.display === "none";
  row.style.display = isHidden ? "block" : "none";
  $("#saladSearchToggle").classList.toggle("active", isHidden);
  if (isHidden) setTimeout(() => $("#saladSearchInput").focus(), 50);
  else { $("#saladSearchInput").value = ""; saladSearchKeyword = ""; saladShowCount = 2; renderSaladFeed(); }
});
$("#saladSearchInput").addEventListener("input", (e) => {
  saladSearchKeyword = e.target.value;
  saladShowCount = 2;
  renderSaladFeed();
});

/* ---- 샐러드 상세보기 + 댓글 ---- */
let currentSaladId = null;

async function openSaladDetail(id) {
  currentSaladId = id;
  const body = $("#postDetailBody");
  let posts;
  try {
    posts = await apiGet("/salad");
  } catch (err) {
    body.innerHTML = `<div class="empty-mini">불러오는 중 오류가 발생했습니다.</div>`;
    openModal("postDetailModal");
    return;
  }
  const item = posts.find((p) => p.id === id);
  if (!item) {
    body.innerHTML = `<div class="empty-mini">게시글을 찾을 수 없습니다.</div>`;
    openModal("postDetailModal");
    return;
  }

  const titleText = item.title && item.title.trim() ? item.title : "중식 샐러드";
  const gallery = (item.images || []).map((src) => `<img src="${src}" data-full="${src}" alt="${escapeHtml(titleText)}">`).join("");

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

  openModal("postDetailModal");
}

async function handleDeleteSalad() {
  if (!confirm("정말 이 글을 삭제하시겠습니까? (댓글도 함께 삭제됩니다)")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 글을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiDelete(`/salad?id=${currentSaladId}&code=${encodeURIComponent(code)}`);
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
    return;
  }
  closeModal("postDetailModal");
  saladShowCount = Math.max(saladShowCount, 2);
  renderSaladFeed();
}

/* ---- 댓글 (인증코드 없이 누구나 작성 가능, 삭제는 인증 필요) ---- */
async function renderComments(feedKey, itemId) {
  const listEl = $("#commentList");
  const countLabelEl = $("#commentCountLabel");
  if (!listEl) return;

  let comments;
  try {
    comments = await apiGet(`/comments?feedKey=${feedKey}&itemId=${itemId}`);
  } catch (err) {
    listEl.innerHTML = `<div class="comment-empty">댓글을 불러오지 못했습니다.</div>`;
    return;
  }

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

  try {
    await apiPost("/comments", { feedKey: "salad", itemId: currentSaladId, author: authorInput.value.trim(), text });
  } catch (err) {
    console.error("댓글 저장 실패:", err);
    statusEl.innerHTML = `<div class="status-msg error">댓글 저장에 실패했습니다: ${escapeHtml(err.message)}</div>`;
    return;
  }

  textInput.value = "";
  statusEl.innerHTML = "";
  await renderComments("salad", currentSaladId);
  renderSaladFeed(); // 목록의 댓글 개수 갱신
}

async function handleDeleteComment(commentId, feedKey, itemId) {
  if (!confirm("이 댓글을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("댓글 삭제 확인", "댓글을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiDelete(`/comments?id=${commentId}&code=${encodeURIComponent(code)}`);
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
    return;
  }
  await renderComments(feedKey, itemId);
  renderSaladFeed();
}

/* ---- 샐러드 새 글 작성 ---- */
const MAX_SALAD_IMAGES = 8;
let saladSelectedImages = [];

function reRenderSaladPreview() {
  renderPreviewGrid($("#saladPreviewGrid"), saladSelectedImages, (idx) => {
    saladSelectedImages.splice(idx, 1);
    reRenderSaladPreview();
  });
}

setupDropZone($("#saladDropZone"), $("#saladFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  const room = MAX_SALAD_IMAGES - saladSelectedImages.length;
  if (files.length > room) showSaladStatus(`사진은 최대 ${MAX_SALAD_IMAGES}장까지 첨부할 수 있습니다.`, "error");
  for (const file of files.slice(0, Math.max(room, 0))) {
    try { saladSelectedImages.push(await resizeImageFile(file)); } catch (e) { console.error(e); showSaladStatus("사진을 처리하는 중 오류가 발생했습니다.", "error"); }
  }
  reRenderSaladPreview();
});

function showSaladStatus(msg, type) {
  $("#saladFormStatus").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
}

$("#newSaladBtn").addEventListener("click", () => {
  saladSelectedImages = [];
  reRenderSaladPreview();
  showSaladStatus("", "");
  $("#saladForm").reset();
  openModal("saladModal");
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
    await renderSaladFeed();
    setTimeout(() => { closeModal("saladModal"); openSaladDetail(newItem.id); }, 600);
  } catch (err) {
    console.error("중식 샐러드 저장 실패:", err);
    showSaladStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "발행하기";
  }
});

/* ============================================================
   6. 소식지 이미지 슬라이더 (최대 20장, 넘겨가며 보기, 서버 저장)
   ============================================================ */
let newsSlideIndex = 0;

async function renderNewsSlider() {
  const bodyEl = $("#newsSliderBody");
  let slides;
  try {
    slides = await apiGet("/news-slides");
  } catch (err) {
    console.error("소식지 슬라이더를 불러오지 못했습니다:", err);
    bodyEl.innerHTML = `<div class="news-slider-empty"><div class="icon">⚠️</div>목록을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.</div>`;
    return;
  }

  if (slides.length === 0) {
    bodyEl.innerHTML = `
      <div class="news-slider-empty">
        <div class="icon">📰</div>
        아직 등록된 소식지 사진이 없습니다.<br>"＋ 사진 추가"로 첫 소식지 사진을 올려보세요!
      </div>`;
    return;
  }

  if (newsSlideIndex >= slides.length) newsSlideIndex = slides.length - 1;
  if (newsSlideIndex < 0) newsSlideIndex = 0;
  const current = slides[newsSlideIndex];

  bodyEl.innerHTML = `
    <div class="news-slider">
      <div class="news-slider-frame">
        <img id="newsSlideImg" src="${current.image}" alt="소식지 사진 ${newsSlideIndex + 1}">
        ${slides.length > 1 ? `
          <button type="button" class="news-slider-nav-btn prev" id="newsSlidePrev">‹</button>
          <button type="button" class="news-slider-nav-btn next" id="newsSlideNext">›</button>
        ` : ""}
        <div class="news-slider-counter">${newsSlideIndex + 1} / ${slides.length}</div>
        <button type="button" class="news-slider-delbtn" id="newsSlideDelBtn" title="이 사진 삭제">✕</button>
      </div>
      ${slides.length > 1 ? `<div class="news-slider-thumbs" id="newsSlideThumbs"></div>` : ""}
    </div>`;

  const sliderImages = slides.map((s) => s.image);

  $("#newsSlideImg").addEventListener("click", () => {
    openLightboxGallery(sliderImages, newsSlideIndex, (idx) => { newsSlideIndex = idx; });
  });

  const prevBtn = $("#newsSlidePrev");
  const nextBtn = $("#newsSlideNext");
  if (prevBtn) prevBtn.addEventListener("click", () => { newsSlideIndex = (newsSlideIndex - 1 + slides.length) % slides.length; renderNewsSlider(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { newsSlideIndex = (newsSlideIndex + 1) % slides.length; renderNewsSlider(); });

  $("#newsSlideDelBtn").addEventListener("click", () => handleDeleteNewsSlide(current.id));

  const thumbsEl = $("#newsSlideThumbs");
  if (thumbsEl) {
    thumbsEl.innerHTML = slides.map((s, idx) => `<img src="${s.image}" data-idx="${idx}" class="${idx === newsSlideIndex ? "active" : ""}" alt="썸네일 ${idx + 1}">`).join("");
    $all("img", thumbsEl).forEach((img) => {
      img.addEventListener("click", () => { newsSlideIndex = Number(img.dataset.idx); renderNewsSlider(); });
    });
  }
}

async function handleDeleteNewsSlide(id) {
  if (!confirm("이 사진을 삭제하시겠습니까?")) return;
  const code = await verifyPasscodeAndGet("삭제 확인", "이 사진을 삭제하려면 인증코드를 입력해주세요.");
  if (!code) return;
  try {
    await apiDelete(`/news-slides?id=${id}&code=${encodeURIComponent(code)}`);
  } catch (err) {
    alert("삭제 중 오류가 발생했습니다: " + err.message);
    return;
  }
  renderNewsSlider();
}

/* ---- 소식지 사진 추가 모달 ---- */
let newsUploadSelectedImages = [];

function reRenderNewsUploadPreview() {
  renderPreviewGrid($("#newsUploadPreviewGrid"), newsUploadSelectedImages, (idx) => {
    newsUploadSelectedImages.splice(idx, 1);
    reRenderNewsUploadPreview();
  });
}

function showNewsUploadStatus(msg, type) {
  $("#newsUploadFormStatus").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
}

setupDropZone($("#newsUploadDropZone"), $("#newsUploadFileInput"), async (fileList) => {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  let existingCount = 0;
  try { existingCount = (await apiGet("/news-slides")).length; } catch (e) { /* 실패해도 계속 진행 */ }
  const room = MAX_NEWS_SLIDES - existingCount - newsUploadSelectedImages.length;
  if (files.length > room) {
    showNewsUploadStatus(`소식지 사진은 최대 ${MAX_NEWS_SLIDES}장까지 보관할 수 있습니다. 지금 ${Math.max(room, 0)}장까지만 추가할 수 있어요.`, "error");
  }
  for (const file of files.slice(0, Math.max(room, 0))) {
    try { newsUploadSelectedImages.push(await resizeImageFile(file, 1800, 0.8)); } catch (e) { console.error(e); showNewsUploadStatus("사진을 처리하는 중 오류가 발생했습니다.", "error"); }
  }
  reRenderNewsUploadPreview();
});

$("#newsUploadBtn").addEventListener("click", async () => {
  newsUploadSelectedImages = [];
  reRenderNewsUploadPreview();
  showNewsUploadStatus("", "");
  $("#newsUploadForm").reset();
  let existingCount = 0;
  try { existingCount = (await apiGet("/news-slides")).length; } catch (e) {}
  $("#newsUploadModalDesc").textContent = `사진을 여러 장 선택해서 슬라이더에 추가하세요. (현재 ${existingCount}장 · 최대 ${MAX_NEWS_SLIDES}장까지 보관 가능)`;
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
    const allSlides = await apiGet("/news-slides");
    newsSlideIndex = allSlides.length - 1;
    await renderNewsSlider();
    if (!result.skipped) setTimeout(() => closeModal("newsUploadModal"), 700);
  } catch (err) {
    console.error("소식지 사진 저장 실패:", err);
    showNewsUploadStatus("저장에 실패했습니다: " + err.message, "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "추가하기";
  }
});

/* ============================================================
   7. 라이트박스 (단일 이미지 모드 / 갤러리 모드)
   ============================================================ */
let lightboxGalleryImages = null;
let lightboxGalleryIndex = 0;
let lightboxOnIndexChange = null;

function openLightbox(src) {
  lightboxGalleryImages = null;
  lightboxOnIndexChange = null;
  $("#lightboxImg").src = src;
  $("#lightbox").classList.remove("gallery-mode");
  openModal("lightbox");
}

function openLightboxGallery(images, startIndex, onIndexChange) {
  lightboxGalleryImages = images;
  lightboxGalleryIndex = Math.max(0, Math.min(startIndex || 0, images.length - 1));
  lightboxOnIndexChange = onIndexChange || null;
  renderLightboxGalleryFrame();
  $("#lightbox").classList.add("gallery-mode");
  openModal("lightbox");
}

function renderLightboxGalleryFrame() {
  $("#lightboxImg").src = lightboxGalleryImages[lightboxGalleryIndex];
  $("#lightboxCounter").textContent = `${lightboxGalleryIndex + 1} / ${lightboxGalleryImages.length}`;
  if (lightboxOnIndexChange) lightboxOnIndexChange(lightboxGalleryIndex);
}

function lightboxGalleryStep(delta) {
  if (!lightboxGalleryImages) return;
  lightboxGalleryIndex = (lightboxGalleryIndex + delta + lightboxGalleryImages.length) % lightboxGalleryImages.length;
  renderLightboxGalleryFrame();
}

$("#lightboxClose").addEventListener("click", () => closeModal("lightbox"));
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeModal("lightbox"); });
$("#lightboxPrev").addEventListener("click", (e) => { e.stopPropagation(); lightboxGalleryStep(-1); });
$("#lightboxNext").addEventListener("click", (e) => { e.stopPropagation(); lightboxGalleryStep(1); });
document.addEventListener("keydown", (e) => {
  if (!$("#lightbox").classList.contains("open")) return;
  if (e.key === "ArrowLeft") lightboxGalleryStep(-1);
  else if (e.key === "ArrowRight") lightboxGalleryStep(1);
  else if (e.key === "Escape") closeModal("lightbox");
});

/* ============================================================
   8. 알림 배너
   ============================================================ */
function renderServerErrorBanner(err) {
  const box = $("#noticeBanner");
  box.innerHTML = `
    <div class="notice-banner error">
      <span>⚠️</span>
      <span>
        <b>서버와 통신하는 중 문제가 발생했습니다.</b> 인터넷 연결을 확인하고 새로고침 해보세요.<br>
        ${err && err.message ? `<span style="opacity:.8;">(오류 메시지: ${escapeHtml(err.message)})</span>` : ""}
      </span>
    </div>`;
}

/* ============================================================
   9. 사이트 꾸미기 (프로필 사진 / 배경 사진 — 서버 저장, 설정 화면에서만 변경)
   ============================================================ */
let pendingAvatarData = null;
let currentBgPreviewData = null;
let currentBgAdjust = { ...BG_DEFAULT_ADJUST };

/* 저장된 프로필/배경 사진을 실제 화면(topbar)에 반영합니다. */
async function applySitePrefsToPage() {
  let prefs;
  try {
    prefs = await apiGet("/site-prefs");
  } catch (err) {
    console.error("사이트 설정을 불러오지 못했습니다:", err);
    return;
  }

  const brandMark = $("#brandMark");
  if (prefs.avatar && prefs.avatar.data) {
    brandMark.innerHTML = `<img src="${prefs.avatar.data}" alt="프로필 사진">`;
  } else {
    brandMark.innerHTML = "R&D";
  }

  const topbarEl = $("#topbarEl");
  const topbarImg = $("#topbarBgImg");
  if (prefs.background && prefs.background.data) {
    const { data, posX, posY, zoom } = prefs.background;
    topbarImg.src = data;
    topbarImg.style.objectPosition = `${posX}% ${posY}%`;
    topbarImg.style.transform = `scale(${zoom / 100})`;
    topbarEl.classList.add("has-bg-photo");
  } else {
    topbarImg.removeAttribute("src");
    topbarImg.style.transform = "";
    topbarEl.classList.remove("has-bg-photo");
  }
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
  try {
    prefs = await apiGet("/site-prefs");
  } catch (err) {
    prefs = { avatar: null, background: null };
  }

  const avatarPreview = $("#avatarPreview");
  avatarPreview.innerHTML = (prefs.avatar && prefs.avatar.data) ? `<img src="${prefs.avatar.data}" alt="프로필 사진">` : "R&D";
  pendingAvatarData = null;

  if (prefs.background && prefs.background.data) {
    currentBgPreviewData = prefs.background.data;
    currentBgAdjust = {
      posX: prefs.background.posX ?? BG_DEFAULT_ADJUST.posX,
      posY: prefs.background.posY ?? BG_DEFAULT_ADJUST.posY,
      zoom: prefs.background.zoom ?? BG_DEFAULT_ADJUST.zoom,
    };
  } else {
    currentBgPreviewData = null;
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
    console.error(e);
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
    await applySitePrefsToPage();
    $("#avatarStatus").innerHTML = `<div class="status-msg success">프로필 사진이 저장되었습니다. (모든 방문자에게 즉시 반영됩니다)</div>`;
    pendingAvatarData = null;
  } catch (err) {
    console.error("프로필 사진 저장 실패:", err);
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
    await applySitePrefsToPage();
    await refreshAppearanceSettingsPreview();
    $("#avatarStatus").innerHTML = `<div class="status-msg success">기본값으로 되돌렸습니다.</div>`;
  } catch (err) {
    console.error("프로필 사진 초기화 실패:", err);
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
    currentBgAdjust = { ...BG_DEFAULT_ADJUST };
    setBgSliderValues(currentBgAdjust);
    renderBgPreview();
    $("#bgStatus").innerHTML = `<div class="status-msg success">미리보기가 적용되었습니다. 슬라이더로 위치/확대를 조정한 뒤 "배경 사진 저장" 버튼을 눌러 확정하세요.</div>`;
  } catch (e) {
    console.error(e);
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
    await apiPut("/site-prefs", {
      type: "background", data: currentBgPreviewData,
      posX: currentBgAdjust.posX, posY: currentBgAdjust.posY, zoom: currentBgAdjust.zoom, code,
    });
    await applySitePrefsToPage();
    $("#bgStatus").innerHTML = `<div class="status-msg success">배경 사진이 저장되었습니다. (모든 방문자에게 즉시 반영됩니다)</div>`;
  } catch (err) {
    console.error("배경 사진 저장 실패:", err);
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
    await applySitePrefsToPage();
    await refreshAppearanceSettingsPreview();
    $("#bgStatus").innerHTML = `<div class="status-msg success">기본값으로 되돌렸습니다.</div>`;
  } catch (err) {
    console.error("배경 사진 초기화 실패:", err);
    $("#bgStatus").innerHTML = `<div class="status-msg error">초기화에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    resetBtn.disabled = false; resetBtn.textContent = "기본값으로";
  }
});

/* ============================================================
   10. 섹션 제목 커스터마이즈 (서버 저장)
   ============================================================ */
async function applySectionTitlesToPage() {
  let titles;
  try {
    titles = await apiGet("/section-titles");
  } catch (err) {
    console.error("섹션 제목을 불러오지 못했습니다:", err);
    titles = {};
  }

  $("#saladTitle").textContent = titles.salad || SECTION_TITLE_DEFAULTS.salad;
  $("#newsletterTitle").textContent = titles.news || SECTION_TITLE_DEFAULTS.news;
  $("#mealplanTitle").textContent = titles.mealplan || SECTION_TITLE_DEFAULTS.mealplan;
  $("#mealboxTitle").textContent = titles.mealbox || SECTION_TITLE_DEFAULTS.mealbox;
}

async function refreshSectionTitlesPreview() {
  let titles;
  try {
    titles = await apiGet("/section-titles");
  } catch (err) {
    titles = {};
  }
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
    await apiPut("/section-titles", { titles, code });
    await applySectionTitlesToPage();
    $("#settingsTitlesStatus").innerHTML = `<div class="status-msg success">제목이 저장되었습니다. (모든 방문자에게 즉시 반영됩니다)</div>`;
  } catch (err) {
    console.error("섹션 제목 저장 실패:", err);
    $("#settingsTitlesStatus").innerHTML = `<div class="status-msg error">저장에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "제목 저장";
  }
});

/* ============================================================
   11. 설정 모달 열기/탭 전환 + 백업 안내(더 이상 SEED 방식 불필요)
   ============================================================ */
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
  });
});

/* ---- 인증코드 변경: 현재 코드 확인은 서버가 담당 ---- */
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

/* ============================================================
   12. 초기화
   ============================================================ */
(async function init() {
  try {
    await applySectionTitlesToPage();
    await applySitePrefsToPage();
    await renderAllGalleries();
    await renderSaladFeed();
    await renderNewsSlider();
  } catch (err) {
    console.error("초기 로딩 오류:", err);
    renderServerErrorBanner(err);
  }
})();
