// netlify/functions/api.mjs
// R&D본부 소식지 - 통합 백엔드 API (Netlify Functions v2 + Netlify Blobs)
//
// 이 파일 하나가 /api/* 로 들어오는 모든 요청을 처리합니다.
// 데이터는 Netlify Blobs(서버 저장소, 모든 방문자가 공유)에 저장되므로
// 한 사람이 수정하면 다른 사람도 새로고침 시 바로 반영됩니다.
//
// 저장 키 구조 (모두 하나의 store "rnd-newsletter" 안에 있음):
//   salad-posts      : [{ id, title, author, content, images[], date }]
//   news-slides      : [{ id, image, date }]                (최대 20장)
//   comments         : [{ id, feedKey, itemId, author, text, date }]
//   gallery-mealplan : { data, date } | null                (사진 1장만 유지)
//   gallery-mealbox  : { data, date } | null
//   site-prefs       : { avatar: {data,date}|null, background: {data,posX,posY,zoom,date}|null }
//   section-titles   : { salad, news, mealplan, mealbox }   (비어있으면 기본값 사용)
//   auth             : { code }                              (기본값 "1234")

import { getStore } from "@netlify/blobs";

const MAX_NEWS_SLIDES = 20;
const DEFAULT_CODE = "1234";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getMainStore() {
  return getStore({ name: "rnd-newsletter", consistency: "strong" });
}

async function readJSON(store, key, fallback) {
  const val = await store.get(key, { type: "json" });
  return val === null || val === undefined ? fallback : val;
}

async function getAuthCode(store) {
  const auth = await readJSON(store, "auth", null);
  return auth && auth.code ? auth.code : DEFAULT_CODE;
}

async function verifyCode(store, code) {
  const real = await getAuthCode(store);
  return typeof code === "string" && code === real;
}

/* ============================================================
   개별 리소스 핸들러
   ============================================================ */

// ---- 중식 샐러드 신청공간 (피드형: 목록/작성/삭제 + 댓글) ----
async function handleSalad(req, url, store) {
  if (req.method === "GET") {
    const posts = await readJSON(store, "salad-posts", []);
    return json(posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!body.title || !body.title.trim()) return err("제목을 입력해주세요.", 400);

    const posts = await readJSON(store, "salad-posts", []);
    const newPost = {
      id: uid(),
      title: body.title.trim(),
      author: (body.author || "").trim() || "R&D인사팀",
      content: body.content || "",
      images: Array.isArray(body.images) ? body.images : [],
      date: new Date().toISOString(),
    };
    posts.push(newPost);
    await store.setJSON("salad-posts", posts);
    return json(newPost, 201);
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!id) return err("id가 필요합니다.", 400);

    const posts = await readJSON(store, "salad-posts", []);
    const filtered = posts.filter((p) => p.id !== id);
    await store.setJSON("salad-posts", filtered);

    // 이 글에 달린 댓글도 함께 정리 (고아 데이터 방지)
    const comments = await readJSON(store, "comments", []);
    const remainingComments = comments.filter((c) => !(c.feedKey === "salad" && c.itemId === id));
    await store.setJSON("comments", remainingComments);

    return json({ ok: true });
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 소식지 이미지 슬라이더 (여러 장, 최대 20장, 넘겨가며 보기) ----
async function handleNewsSlides(req, url, store) {
  if (req.method === "GET") {
    const slides = await readJSON(store, "news-slides", []);
    return json(slides.slice().sort((a, b) => new Date(a.date) - new Date(b.date)));
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return err("사진을 최소 1장 첨부해주세요.", 400);

    const slides = await readJSON(store, "news-slides", []);
    const room = MAX_NEWS_SLIDES - slides.length;
    const toAdd = images.slice(0, Math.max(room, 0));
    const now = new Date();
    toAdd.forEach((data, idx) => {
      slides.push({ id: uid(), image: data, date: new Date(now.getTime() + idx).toISOString() });
    });
    await store.setJSON("news-slides", slides);

    const skipped = images.length - toAdd.length;
    return json({
      added: toAdd.length,
      skipped,
      message: skipped > 0
        ? `사진은 최대 ${MAX_NEWS_SLIDES}장까지 보관할 수 있어 ${toAdd.length}장만 추가되고 ${skipped}장은 제외되었습니다.`
        : "사진이 추가되었습니다!",
    }, 201);
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!id) return err("id가 필요합니다.", 400);

    const slides = await readJSON(store, "news-slides", []);
    const filtered = slides.filter((s) => s.id !== id);
    await store.setJSON("news-slides", filtered);
    return json({ ok: true });
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 댓글 (소식지/샐러드 등 어떤 feedKey에도 붙을 수 있음, 누구나 작성 가능) ----
async function handleComments(req, url, store) {
  if (req.method === "GET") {
    const feedKey = url.searchParams.get("feedKey");
    const itemId = url.searchParams.get("itemId");
    const all = await readJSON(store, "comments", []);
    const filtered = all.filter((c) => c.feedKey === feedKey && c.itemId === itemId);
    return json(filtered.sort((a, b) => new Date(a.date) - new Date(b.date)));
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!body.feedKey || !body.itemId) return err("feedKey와 itemId가 필요합니다.", 400);
    if (!body.text || !body.text.trim()) return err("댓글 내용을 입력해주세요.", 400);

    const all = await readJSON(store, "comments", []);
    const newComment = {
      id: uid(),
      feedKey: body.feedKey,
      itemId: body.itemId,
      author: (body.author || "").trim() || "익명",
      text: body.text.trim(),
      date: new Date().toISOString(),
    };
    all.push(newComment);
    await store.setJSON("comments", all);
    return json(newComment, 201);
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!id) return err("id가 필요합니다.", 400);

    const all = await readJSON(store, "comments", []);
    const filtered = all.filter((c) => c.id !== id);
    await store.setJSON("comments", filtered);
    return json({ ok: true });
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 식단표 / 밀박스 (사진 1장만 유지, 새로 업로드하면 자동 교체) ----
async function handleGallery(req, url, store) {
  const category = url.searchParams.get("category");
  if (category !== "mealplan" && category !== "mealbox") {
    return err("category는 mealplan 또는 mealbox 여야 합니다.", 400);
  }
  const key = "gallery-" + category;

  if (req.method === "GET") {
    const record = await readJSON(store, key, null);
    return json(record);
  }

  if (req.method === "PUT") {
    const body = await req.json();
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!body.image) return err("사진 데이터가 필요합니다.", 400);

    const record = { data: body.image, date: new Date().toISOString() };
    await store.setJSON(key, record);
    return json(record);
  }

  if (req.method === "DELETE") {
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    await store.setJSON(key, null);
    return json({ ok: true });
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 사이트 꾸미기: 프로필 사진 / 배경 사진 (위치·확대 조정 포함) ----
async function handleSitePrefs(req, url, store) {
  if (req.method === "GET") {
    const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
    return json(prefs);
  }

  if (req.method === "PUT") {
    const body = await req.json();
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (body.type !== "avatar" && body.type !== "background") return err("type은 avatar 또는 background 여야 합니다.", 400);
    if (!body.data) return err("사진 데이터가 필요합니다.", 400);

    const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
    if (body.type === "avatar") {
      prefs.avatar = { data: body.data, date: new Date().toISOString() };
    } else {
      prefs.background = {
        data: body.data,
        posX: typeof body.posX === "number" ? body.posX : 50,
        posY: typeof body.posY === "number" ? body.posY : 50,
        zoom: typeof body.zoom === "number" ? body.zoom : 100,
        date: new Date().toISOString(),
      };
    }
    await store.setJSON("site-prefs", prefs);
    return json(prefs);
  }

  if (req.method === "DELETE") {
    const type = url.searchParams.get("type");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (type !== "avatar" && type !== "background") return err("type은 avatar 또는 background 여야 합니다.", 400);

    const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
    prefs[type] = null;
    await store.setJSON("site-prefs", prefs);
    return json(prefs);
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 섹션 제목 커스터마이즈 ----
async function handleSectionTitles(req, url, store) {
  if (req.method === "GET") {
    const titles = await readJSON(store, "section-titles", {});
    return json(titles);
  }

  if (req.method === "PUT") {
    const body = await req.json();
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);

    const current = await readJSON(store, "section-titles", {});
    const allowedKeys = ["salad", "news", "mealplan", "mealbox"];
    allowedKeys.forEach((key) => {
      if (typeof body.titles?.[key] === "string") {
        const trimmed = body.titles[key].trim();
        if (trimmed) current[key] = trimmed;
        else delete current[key]; // 빈 값이면 기본값으로 되돌림
      }
    });
    await store.setJSON("section-titles", current);
    return json(current);
  }

  return err("지원하지 않는 요청입니다.", 405);
}

// ---- 인증코드 확인 / 변경 ----
async function handleAuth(req, url, store, subpath) {
  if (subpath === "verify" && req.method === "POST") {
    const body = await req.json();
    const ok = await verifyCode(store, body.code);
    return json({ ok });
  }

  if (subpath === "change" && req.method === "POST") {
    const body = await req.json();
    const { currentCode, newCode } = body;
    if (!currentCode) return err("현재 인증코드를 입력해주세요.", 400);
    if (!(await verifyCode(store, currentCode))) return err("현재 인증코드가 올바르지 않습니다.", 401);
    if (!newCode || !newCode.trim()) return err("새 인증코드를 입력해주세요.", 400);

    await store.setJSON("auth", { code: newCode.trim() });
    return json({ ok: true });
  }

  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   라우팅
   ============================================================ */
export default async (req, context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const resource = parts[0];
  const subpath = parts[1];

  // 브라우저에서의 프리플라이트(OPTIONS) 요청 처리
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const store = getMainStore();

  try {
    switch (resource) {
      case "salad":
        return await handleSalad(req, url, store);
      case "news-slides":
        return await handleNewsSlides(req, url, store);
      case "comments":
        return await handleComments(req, url, store);
      case "gallery":
        return await handleGallery(req, url, store);
      case "site-prefs":
        return await handleSitePrefs(req, url, store);
      case "section-titles":
        return await handleSectionTitles(req, url, store);
      case "auth":
        return await handleAuth(req, url, store, subpath);
      default:
        return err("알 수 없는 API 경로입니다: " + resource, 404);
    }
  } catch (e) {
    console.error("[API 오류]", resource, e);
    return err("서버 오류가 발생했습니다: " + e.message, 500);
  }
};

export const config = { path: "/api/*" };
