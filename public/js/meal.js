  /* ============================================================
     ⑤ 외부인 식사 신청  (v6 · 식사일자 추가 · 관리자 삭제 · 메일 기능 없음)
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
    const css = document.createElement("style");
    css.textContent = `
      table.gm-table { min-width: 640px; }
      table.gm-table td.date, table.gm-admin-table td.date { font-weight: 700; color: var(--primary-dark); white-space: nowrap; }
      table.gm-admin-table { min-width: 980px; }
      table.gm-admin-table .chk { width: 34px; text-align: center; }
      table.gm-admin-table input[type=checkbox] { width: 17px; height: 17px; }
      .gm-date-filter { display: flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--text-muted); flex-wrap: wrap; }
      .gm-date-filter input[type=date] { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; background: #fff; }
      #guestMealModal .up-field input[type=date] { min-height: 48px; }`;
    document.head.appendChild(css);
    const th = $("#gmListBody") && $("#gmListBody").closest("table").querySelector("thead tr");
    if (th && !th.querySelector(".gm-th-date")) th.insertAdjacentHTML("afterbegin", `<th class="gm-th-date">식사일자</th>`);
    const countField = $("#gmCountInput") && $("#gmCountInput").closest(".up-field");
    if (countField && !$("#gmMealDate")) {
      countField.insertAdjacentHTML("afterend", `
        <div class="up-field"><label for="gmMealDate">식사일자</label><input type="date" id="gmMealDate" required></div>`);
    }
  })();
  const todayStr = () => (window.__MOCK ? window.__MOCK.kstDate() : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));

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
      document.dispatchEvent(new CustomEvent("guestmeal:mail", { detail: { record: r.record || v, adminUrl: guestAdminUrl(), mail: "skipped" } }));
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
  setInterval(() => { if (document.visibilityState === "visible" && $("#mb-guest").classList.contains("active")) loadGuestList(); }, 60 * 1000);
