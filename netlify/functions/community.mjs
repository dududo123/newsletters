/* ============================================================
   R&D본부 소식지 — 공지 배너 · 이벤트 신청/설문 · 좋아요 서버 (community.mjs v1)
   ------------------------------------------------------------
   · 위치: netlify/functions/community.mjs  (api.mjs 와 같은 폴더)
   · 주소: /cm-api/*  (기존 /api/* 와 완전히 분리 → 기존 api.mjs 는 수정하지 않음)
   · 저장: Netlify Blobs 의 "community" 저장소 (기존 사진/글 저장소와 분리)
   · 인증: 관리자 기능은 기존 인증코드를 그대로 사용 (/api/auth/verify 로 확인)
   · 참여자 구분: 서버가 발급하는 쿠키(cmuid)로 1인 1회 신청/투표/좋아요를 구분
   ============================================================ */
import { getStore } from "@netlify/blobs";

export const config = { path: ["/cm-api", "/cm-api/*"] };

const STORE_NAME = "community";
const MAX_NOTICES = 30;
const MAX_RESPONSES = 1000;
const MAX_POLL_OPTIONS = 10;

/* ---------------- 공통 도우미 ---------------- */
function store() { return getStore({ name: STORE_NAME, consistency: "strong" }); }
async function readJSON(key, fallback) {
  try {
    const v = await store().get(key, { type: "json" });
    return v == null ? fallback : v;
  } catch (e) {
    console.error("[community] read 실패:", key, e);
    return fallback;
  }
}
async function writeJSON(key, value) { await store().setJSON(key, value); }
async function removeKey(key) { try { await store().delete(key); } catch (e) {} }
function str(v, max) { return String(v == null ? "" : v).trim().slice(0, max); }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : ""; }
function todayKST() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function safeKeyPart(v) { return String(v).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100); }
function isActive(n, today) {
  if (n.start && today < n.start) return false;
  if (n.end && today > n.end) return false;
  return true;
}
function getUid(req) {
  const m = /(?:^|;\s*)cmuid=([a-zA-Z0-9-]{10,64})/.exec(req.headers.get("cookie") || "");
  return m ? { uid: m[1], isNew: false } : { uid: crypto.randomUUID(), isNew: true };
}
function json(data, status, uidInfo) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (uidInfo && uidInfo.isNew) {
    headers["Set-Cookie"] = `cmuid=${uidInfo.uid}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`;
  }
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}
const fail = (msg, status, uidInfo) => json({ error: msg }, status || 400, uidInfo);

/* 기존 인증코드 확인 (api.mjs 의 /api/auth/verify 를 그대로 사용) */
async function verifyCode(req, code) {
  if (!code) return false;
  try {
    const res = await fetch(new URL("/api/auth/verify", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: String(code) }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return !!(data && data.ok);
  } catch (e) {
    console.error("[community] 인증 확인 실패:", e);
    return false;
  }
}

/* ---------------- 공지 + 응답 ---------------- */
async function loadNotices() {
  const list = await readJSON("notices", []);
  return Array.isArray(list) ? list : [];
}
async function loadResponses(id) {
  const list = await readJSON("resp-" + safeKeyPart(id), []);
  return Array.isArray(list) ? list : [];
}
function summarize(n, responses, uid, forAdmin) {
  const out = {
    id: n.id, title: n.title, detail: n.detail, link: n.link, level: n.level,
    start: n.start, end: n.end, kind: n.kind, createdAt: n.createdAt,
    count: responses.length,
  };
  if (n.kind === "signup") out.signup = { capacity: n.signup.capacity, askDept: n.signup.askDept, askMemo: n.signup.askMemo };
  if (n.kind === "poll") out.poll = { question: n.poll.question, options: n.poll.options, multiple: n.poll.multiple, showResult: n.poll.showResult };
  const mine = uid ? responses.find((r) => r.uid === uid) : null;
  if (mine) out.my = { name: mine.name || "", dept: mine.dept || "", memo: mine.memo || "", choices: mine.choices || [] };
  if (n.kind === "poll" && (forAdmin || (n.poll.showResult && mine))) {
    const tally = n.poll.options.map(() => 0);
    responses.forEach((r) => (r.choices || []).forEach((c) => { if (tally[c] != null) tally[c]++; }));
    out.tally = tally;
  }
  return out;
}
function cleanNotice(input, existing) {
  const kind = ["none", "signup", "poll"].includes(input.kind) ? input.kind : "none";
  const title = str(input.title, 120);
  if (!title) throw new Error("공지 문구를 입력해주세요.");
  let link = str(input.link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw new Error("링크는 http:// 또는 https:// 로 시작해야 합니다.");
  const start = validDate(input.start);
  const end = validDate(input.end);
  if (start && end && end < start) throw new Error("종료일이 시작일보다 빠릅니다.");
  const n = {
    id: existing ? existing.id : newId(),
    title, detail: str(input.detail, 2000), link,
    level: input.level === "important" ? "important" : "info",
    start, end, kind,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (kind === "signup") {
    const s = input.signup || {};
    const cap = Math.max(0, Math.min(10000, parseInt(s.capacity, 10) || 0));
    n.signup = { capacity: cap, askDept: !!s.askDept, askMemo: !!s.askMemo };
  }
  if (kind === "poll") {
    const p = input.poll || {};
    const options = (Array.isArray(p.options) ? p.options : [])
      .map((o) => str(o, 60)).filter(Boolean).slice(0, MAX_POLL_OPTIONS);
    if (options.length < 2) throw new Error("설문 선택지를 2개 이상 입력해주세요.");
    // 이미 응답이 있는 설문은 선택지 개수를 줄이면 기존 응답이 어긋나므로 막습니다.
    if (existing && existing.kind === "poll" && existing._hasResponses && options.length < existing.poll.options.length) {
      throw new Error("응답이 있는 설문은 선택지를 줄일 수 없습니다. (문구 수정·추가만 가능)");
    }
    n.poll = { question: str(p.question, 200) || title, options, multiple: !!p.multiple, showResult: !!p.showResult };
  }
  return n;
}

/* ---------------- 좋아요 ---------------- */
function validTarget(t) { return /^(news|salad):[a-zA-Z0-9_-]{1,80}$/.test(t || ""); }
function likeKey(t) { return "like-" + safeKeyPart(t); }
async function loadLike(t) {
  const v = await readJSON(likeKey(t), null);
  return v && Array.isArray(v.uids) ? v : { uids: [] };
}

/* ============================================================
   요청 처리
   ============================================================ */
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/cm-api\/?/, "").replace(/\/+$/, "");
  const method = req.method.toUpperCase();
  const uidInfo = getUid(req);
  const uid = uidInfo.uid;

  let body = {};
  if (method === "POST") {
    try { body = await req.json(); } catch (e) { return fail("요청 형식이 올바르지 않습니다.", 400, uidInfo); }
    if (!body || typeof body !== "object") body = {};
  }

  try {
    /* ---- 공개: 현재 게시 중인 공지 ---- */
    if (path === "notices" && method === "GET") {
      const today = todayKST();
      const active = (await loadNotices()).filter((n) => isActive(n, today));
      const out = await Promise.all(active.map(async (n) => {
        const responses = n.kind === "none" ? [] : await loadResponses(n.id);
        return summarize(n, responses, uid, false);
      }));
      return json({ notices: out }, 200, uidInfo);
    }

    /* ---- 공개: 신청 / 투표 / 취소 ---- */
    if (path === "respond" && method === "POST") {
      const notices = await loadNotices();
      const n = notices.find((x) => x.id === body.id);
      if (!n || n.kind === "none") return fail("대상을 찾을 수 없습니다.", 404, uidInfo);
      if (!isActive(n, todayKST())) return fail("신청/참여 기간이 아닙니다.", 400, uidInfo);
      const key = "resp-" + safeKeyPart(n.id);
      let responses = await loadResponses(n.id);
      const idx = responses.findIndex((r) => r.uid === uid);
      if (body.cancel) {
        if (idx >= 0) { responses.splice(idx, 1); await writeJSON(key, responses); }
        return json({ notice: summarize(n, responses, uid, false) }, 200, uidInfo);
      }
      const entry = { uid, at: new Date().toISOString() };
      if (n.kind === "signup") {
        entry.name = str(body.name, 20);
        if (!entry.name) return fail("이름을 입력해주세요.", 400, uidInfo);
        if (n.signup.askDept) entry.dept = str(body.dept, 40);
        if (n.signup.askMemo) entry.memo = str(body.memo, 300);
        const others = responses.length - (idx >= 0 ? 1 : 0);
        if (n.signup.capacity > 0 && idx < 0 && others >= n.signup.capacity) {
          return fail("신청 인원이 마감되었습니다.", 409, uidInfo);
        }
      } else {
        const raw = Array.isArray(body.choices) ? body.choices : [];
        const choices = [...new Set(raw.map((c) => parseInt(c, 10)))]
          .filter((c) => Number.isInteger(c) && c >= 0 && c < n.poll.options.length);
        if (!choices.length) return fail("선택지를 골라주세요.", 400, uidInfo);
        if (!n.poll.multiple && choices.length > 1) return fail("하나만 선택할 수 있습니다.", 400, uidInfo);
        entry.choices = choices;
        entry.name = str(body.name, 20);
      }
      if (idx >= 0) { entry.firstAt = responses[idx].firstAt || responses[idx].at; responses[idx] = entry; }
      else {
        if (responses.length >= MAX_RESPONSES) return fail("응답 가능 인원을 초과했습니다.", 409, uidInfo);
        entry.firstAt = entry.at;
        responses.push(entry);
      }
      await writeJSON(key, responses);
      return json({ notice: summarize(n, responses, uid, false) }, 200, uidInfo);
    }

    /* ---- 공개: 좋아요 개수 조회 ---- */
    if (path === "likes" && method === "GET") {
      const targets = [...new Set((url.searchParams.get("t") || "").split(",").filter(validTarget))].slice(0, 40);
      const result = {};
      await Promise.all(targets.map(async (t) => {
        const v = await loadLike(t);
        result[t] = { count: v.uids.length, liked: v.uids.includes(uid) };
      }));
      return json({ likes: result }, 200, uidInfo);
    }

    /* ---- 공개: 좋아요 누르기/취소 ---- */
    if (path === "like" && method === "POST") {
      const t = body.target;
      if (!validTarget(t)) return fail("대상이 올바르지 않습니다.", 400, uidInfo);
      const v = await loadLike(t);
      const i = v.uids.indexOf(uid);
      const want = typeof body.liked === "boolean" ? body.liked : i < 0;
      if (want && i < 0) v.uids.push(uid);
      if (!want && i >= 0) v.uids.splice(i, 1);
      if (v.uids.length) await writeJSON(likeKey(t), v); else await removeKey(likeKey(t));
      return json({ target: t, count: v.uids.length, liked: v.uids.includes(uid) }, 200, uidInfo);
    }

    /* ---- 관리자 ---- */
    if (path === "admin" && method === "POST") {
      if (!(await verifyCode(req, body.code))) return fail("인증코드가 올바르지 않습니다.", 403, uidInfo);
      const action = body.action;
      let notices = await loadNotices();

      if (action === "verify") return json({ ok: true }, 200, uidInfo);

      if (action === "list") {
        const today = todayKST();
        const out = await Promise.all(notices.map(async (n) => {
          const responses = n.kind === "none" ? [] : await loadResponses(n.id);
          const s = summarize(n, responses, null, true);
          s.status = n.start && today < n.start ? "scheduled" : n.end && today > n.end ? "ended" : "active";
          return s;
        }));
        return json({ notices: out, today }, 200, uidInfo);
      }

      if (action === "save") {
        const input = body.notice || {};
        const idx = input.id ? notices.findIndex((n) => n.id === input.id) : -1;
        if (input.id && idx < 0) return fail("수정할 공지를 찾을 수 없습니다.", 404, uidInfo);
        let existing = idx >= 0 ? notices[idx] : null;
        if (existing) {
          const responses = existing.kind === "none" ? [] : await loadResponses(existing.id);
          if (responses.length && input.kind !== existing.kind) {
            return fail("응답이 있는 공지는 종류(일반/신청/설문)를 바꿀 수 없습니다.", 400, uidInfo);
          }
          existing = { ...existing, _hasResponses: responses.length > 0 };
        } else if (notices.length >= MAX_NOTICES) {
          return fail(`공지는 최대 ${MAX_NOTICES}개까지 보관할 수 있습니다. 지난 공지를 삭제해주세요.`, 400, uidInfo);
        }
        let n;
        try { n = cleanNotice(input, existing); } catch (e) { return fail(e.message, 400, uidInfo); }
        if (idx >= 0) notices[idx] = n; else notices.unshift(n);
        await writeJSON("notices", notices);
        return json({ ok: true, id: n.id }, 200, uidInfo);
      }

      if (action === "delete") {
        const before = notices.length;
        notices = notices.filter((n) => n.id !== body.id);
        if (notices.length === before) return fail("삭제할 공지를 찾을 수 없습니다.", 404, uidInfo);
        await writeJSON("notices", notices);
        await removeKey("resp-" + safeKeyPart(body.id));
        return json({ ok: true }, 200, uidInfo);
      }

      if (action === "responses") {
        const n = notices.find((x) => x.id === body.id);
        if (!n) return fail("공지를 찾을 수 없습니다.", 404, uidInfo);
        const responses = await loadResponses(n.id);
        return json({
          notice: summarize(n, responses, null, true),
          responses: responses.map((r) => ({
            name: r.name || "", dept: r.dept || "", memo: r.memo || "",
            choices: r.choices || [], at: r.firstAt || r.at, updatedAt: r.at,
          })),
        }, 200, uidInfo);
      }

      return fail("알 수 없는 요청입니다.", 400, uidInfo);
    }

    return fail("API 경로를 찾을 수 없습니다.", 404, uidInfo);
  } catch (err) {
    console.error("[community] 처리 오류:", err);
    return fail("서버 처리 중 오류가 발생했습니다.", 500, uidInfo);
  }
};
