/* ============================================================
   R&D본부 소식지 — 관리자 모드 (admin.js v2)
   ------------------------------------------------------------
   · 일반 화면 : 설정(⚙) 버튼을 숨기고, 하단에 "🔐 관리자" 접속 링크 표시
   · 관리자 화면 : 사이트주소/?admin (또는 /admin) → 인증코드 입력 → 관리자 모드
       - 상단 관리자 메뉴에서 설정의 모든 기능 사용
       - 삭제·순서 변경·업로드·일괄 삭제 등에서 인증코드를 다시 묻지 않음
   · 인증코드는 화면 메모리에만 보관 (브라우저 저장소 사용 안 함)
   · 반드시 index.html 맨 마지막 script 로 불러옵니다.
   ============================================================ */
(function () {
  "use strict";
  if (window.__adminInstalled) return;
  window.__adminInstalled = true;

  const q = (s, r) => (r || document).querySelector(s);
  const path = location.pathname.replace(/\/+$/, "").toLowerCase();
  const isAdminUrl = path === "/admin" || path === "/admin.html" || /(^|[?&])admin(=|&|$)/.test(location.search.slice(1));

  const style = document.createElement("style");
  style.textContent = `
    body:not(.is-admin) #settingsBtn { display:none !important; }
    body.admin-locked #app, body.admin-locked .modal-overlay:not(#passModal) { visibility:hidden; }
    #adminLogin { position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center;
      background:linear-gradient(135deg,#9C1E22 0%,#5e1114 100%); padding:20px; }
    #adminLogin .box { background:#fff; border-radius:18px; padding:28px 26px 24px; width:100%; max-width:360px;
      box-shadow:0 18px 50px rgba(0,0,0,.3); text-align:center; }
    #adminLogin h2 { margin:0 0 6px; font-size:19px; color:#7A1519; }
    #adminLogin p { margin:0 0 18px; font-size:13px; color:#756B67; line-height:1.6; }
    #adminLogin input { width:100%; padding:12px; font-size:18px; letter-spacing:6px; text-align:center;
      border:1.5px solid #E6DFDA; border-radius:10px; font-family:inherit; outline:none; box-sizing:border-box; }
    #adminLogin input:focus { border-color:#9C1E22; }
    #adminLogin button { width:100%; margin-top:12px; padding:12px; border:none; border-radius:10px; cursor:pointer;
      background:#9C1E22; color:#fff; font-size:15px; font-weight:700; font-family:inherit; }
    #adminLogin button:disabled { opacity:.6; cursor:wait; }
    #adminLogin .err { color:#B3261E; font-size:12.5px; min-height:18px; margin-top:10px; }
    #adminLogin a { display:inline-block; margin-top:14px; font-size:12.5px; color:#756B67; }
    #adminBar { position:sticky; top:0; z-index:900; display:flex; align-items:center; gap:6px; flex-wrap:wrap;
      padding:8px 14px; background:#2B2422; color:#fff; font-size:13px; }
    #adminBar .who { font-weight:800; margin-right:6px; white-space:nowrap; }
    #adminBar button, #adminBar a { border:none; background:rgba(255,255,255,.12); color:#fff; cursor:pointer;
      padding:7px 11px; border-radius:8px; font-size:12.5px; font-weight:700; font-family:inherit; text-decoration:none; white-space:nowrap; }
    #adminBar button:hover, #adminBar a:hover { background:rgba(255,255,255,.24); }
    #adminBar .spacer { flex:1; }
    #adminBar .logout { background:#9C1E22; }
    .admin-entry-link { color:inherit; opacity:.7; text-decoration:none; }
    .admin-entry-link:hover { opacity:1; text-decoration:underline; }
    body.is-admin .field.admin-hidden { display:none; }
    @media (max-width:640px) { #adminBar { padding:8px 10px; } #adminBar .spacer { display:none; } }
  `;
  document.head.appendChild(style);

  if (!isAdminUrl) {
    // 일반 화면: 하단에 작은 관리자 접속 링크
    const footer = q(".app-footer") || q("footer");
    const link = document.createElement("a");
    link.href = "/?admin";
    link.className = "admin-entry-link";
    link.textContent = "🔐 관리자";
    if (footer) { footer.appendChild(document.createTextNode(" · ")); footer.appendChild(link); }
    else { link.style.cssText = "position:fixed;right:10px;bottom:8px;font-size:12px;"; document.body.appendChild(link); }
    return;
  }

  /* ---------------- 관리자 로그인 ---------------- */
  let adminCode = null;
  document.body.classList.add("admin-locked");

  const login = document.createElement("div");
  login.id = "adminLogin";
  login.innerHTML = `
    <form class="box" autocomplete="off">
      <h2>🔐 관리자 로그인</h2>
      <p>R&amp;D본부 소식지 관리자 페이지입니다.<br>인증코드를 입력해주세요.</p>
      <input type="password" id="adminCodeInput" placeholder="인증코드" autocomplete="off">
      <button type="submit" id="adminLoginBtn">로그인</button>
      <div class="err" id="adminLoginErr"></div>
      <a href="/">← 일반 화면으로</a>
    </form>`;
  document.body.appendChild(login);
  const codeInput = q("#adminCodeInput", login);
  setTimeout(() => codeInput.focus(), 50);

  async function checkCode(code) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }), signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      return !!(res.ok && data && data.ok);
    } finally { clearTimeout(timer); }
  }

  q("form", login).addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeInput.value.trim();
    const err = q("#adminLoginErr", login);
    const btn = q("#adminLoginBtn", login);
    if (!code) { err.textContent = "인증코드를 입력해주세요."; return; }
    btn.disabled = true; btn.textContent = "확인 중..."; err.textContent = "";
    try {
      if (await checkCode(code)) { enterAdmin(code); return; }
      err.textContent = "인증코드가 올바르지 않습니다.";
      codeInput.select();
    } catch (ex) {
      err.textContent = "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.";
    }
    btn.disabled = false; btn.textContent = "로그인";
  });

  /* ---------------- 관리자 모드 시작 ---------------- */
  function enterAdmin(code) {
    adminCode = code;
    window.__adminCode = code;
    login.remove();
    document.body.classList.remove("admin-locked");
    document.body.classList.add("is-admin");
    document.title = "[관리자] " + document.title;

    const autoCode = async () => adminCode;
    try { verifyPasscodeAndGet = autoCode; } catch (e) {}
    try { askPasscode = autoCode; } catch (e) {}
    window.verifyPasscodeAndGet = autoCode;

    const CODE_INPUTS = ["#uploadCodeInput", "#newsUploadCodeInput", "#saladCodeInput"];
    CODE_INPUTS.forEach((sel) => {
      const input = q(sel);
      if (!input) return;
      input.removeAttribute("required");
      const field = input.closest(".field");
      if (field) field.classList.add("admin-hidden");
    });
    document.addEventListener("submit", (e) => {
      CODE_INPUTS.forEach((sel) => { const input = q(sel, e.target); if (input) input.value = adminCode; });
    }, true);

    let pendingNewCode = null;
    const changeBtn = q("#changeCodeBtn");
    if (changeBtn) changeBtn.addEventListener("click", () => {
      const v = q("#newCodeInput");
      pendingNewCode = v && v.value ? v.value.trim() : null;
    }, true);
    const codeStatus = q("#settingsCodeStatus");
    if (codeStatus) new MutationObserver(() => {
      if (pendingNewCode && q(".status-msg.success", codeStatus)) {
        adminCode = pendingNewCode; window.__adminCode = pendingNewCode; pendingNewCode = null;
      }
    }).observe(codeStatus, { childList: true, subtree: true });

    const bar = document.createElement("div");
    bar.id = "adminBar";
    bar.innerHTML = `
      <span class="who">🔐 관리자 모드</span>
      <button type="button" data-pane="appearance">🎨 사이트 꾸미기</button>
      <button type="button" data-pane="titles">✏️ 섹션 제목</button>
      <button type="button" data-pane="community">📢 공지·설문</button>
      <button type="button" data-pane="stats">📊 조회수</button>
      <button type="button" data-pane="code">🔑 인증코드 변경</button>
      <span class="spacer"></span>
      <a href="/" target="_blank" rel="noopener">👀 일반 화면 보기</a>
      <button type="button" class="logout" id="adminLogoutBtn">로그아웃</button>`;
    document.body.prepend(bar);

    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pane]");
      if (b) openSettingsPane(b.dataset.pane);
    });
    q("#adminLogoutBtn", bar).addEventListener("click", () => {
      adminCode = null; window.__adminCode = null;
      location.replace("/");
    });
  }

  function openSettingsPane(pane) {
    const settingsBtn = q("#settingsBtn");
    if (settingsBtn) settingsBtn.click();
    else { const m = q("#settingsModal"); if (m) m.classList.add("open"); }
    const tab = q(`#settingsModal .settings-tabs button[data-pane="${pane}"]`);
    if (tab) tab.click();
  }
})();
