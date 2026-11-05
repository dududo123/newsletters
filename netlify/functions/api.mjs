// netlify/functions/api.mjs
// R&D본부 소식지 - 백엔드 API (Netlify Functions v2 + Netlify Blobs)
//
// 저장 구조:
//   [메타데이터 store "rnd-newsletter"]
//     salad-posts / news-slides / comments / gallery-* / site-prefs
//     section-titles / auth / migration-status / stats
//     ★ meal-photos      : 식단표·밀박스 사진 1번/2번 [{slot,imageId,date}]
//     ★ untag-records    : 사원증 미태그 식사등록 [{id,empNo,name,date,at}]  (3개월 지나면 자동 삭제)
//     ★ guest-meals      : 외부인 식사신청 [{id,empNo,name,dept,company,count,reason,status,createdAt,approvedAt}]
//   [이미지 store "rnd-images"]  <imgId> : 바이너리 이미지
//
// ★ 조회수(stats) ★
//   { site:{total,daily}, sections:{news,salad,mealplan,mealbox},
//     slides:{<id>:{total,daily}}, posts:{...}, updatedAt }
//   일별 기록(daily)을 쌓아두고, 조회 시 일/주/월 단위로 묶어서 제공합니다.
//
// ★ 외부인 식사신청 알림 메일 (선택) ★
//   Netlify 사이트 설정 > Environment variables 에 아래 값을 넣으면 서버가 직접 메일을 보냅니다.
//     RESEND_API_KEY   : Resend(resend.com) API 키
//     GUEST_MAIL_TO    : 받는 사람 (기본값 20220412@lottechem.com)
//     GUEST_MAIL_FROM  : 보내는 사람 (기본값 onboarding@resend.dev)
//   값이 없으면 메일은 화면 쪽(Netlify Forms 알림)으로 보냅니다.

import { getStore } from "@netlify/blobs";

const MAX_NEWS_SLIDES = 50;
const DEFAULT_CODE = "1234";
const STATS_DAILY_KEEP_DAYS = 400;   // 월별 1년치를 보려면 넉넉히 보관
const VALID_SECTIONS = new Set(["news", "salad", "mealplan", "mealbox"]);
const UNTAG_KEEP_MONTHS = 3;
const GUEST_MAIL_TO_DEFAULT = "20220412@lottechem.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
function err(message, status = 400) { return json({ error: message }, status); }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }

function getMainStore() { return getStore({ name: "rnd-newsletter", consistency: "strong" }); }
function getImageStore() { return getStore({ name: "rnd-images", consistency: "strong" }); }

async function readJSON(store, key, fallback) {
  const val = await store.get(key, { type: "json" });
  return val === null || val === undefined ? fallback : val;
}
async function readBody(req) { try { return await req.json(); } catch (e) { return {}; } }

async function getAuthCode(store) {
  const auth = await readJSON(store, "auth", null);
  return auth && auth.code ? auth.code : DEFAULT_CODE;
}
async function verifyCode(store, code) {
  const real = await getAuthCode(store);
  return typeof code === "string" && code === real;
}

/* 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function envGet(name) {
  try { if (typeof Netlify !== "undefined" && Netlify.env && Netlify.env.get(name)) return Netlify.env.get(name); } catch (e) {}
  return (typeof process !== "undefined" && process.env && process.env[name]) || "";
}
function maskName(n) { n = String(n || ""); return n.length <= 1 ? n : n.length === 2 ? n[0] + "*" : n[0] + "*".repeat(n.length - 2) + n[n.length - 1]; }
function maskEmp(e) { e = String(e || ""); return e.length <= 4 ? e[0] + "*".repeat(Math.max(e.length - 1, 0)) : e.slice(0, 2) + "*".repeat(e.length - 4) + e.slice(-2); }
function cleanText(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max); }

/* ============================================================
   이미지
   ============================================================ */
async function saveDataUrlAsImage(imageStore, dataUrl) {
  if (typeof dataUrl !== "string") return null;
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const contentType = match[1] || "image/jpeg";
  const binary = Buffer.from(match[2], "base64");
  const imgId = uid();
  await imageStore.set(imgId, binary, { metadata: { contentType } });
  return imgId;
}
async function saveManyDataUrls(imageStore, dataUrls) {
  const ids = [];
  for (const d of dataUrls || []) {
    const id = await saveDataUrlAsImage(imageStore, d);
    if (id) ids.push(id);
  }
  return ids;
}
async function deleteImages(imageStore, ids) {
  for (const id of ids || []) {
    if (!id || typeof id !== "string" || id.startsWith("data:")) continue;
    try { await imageStore.delete(id); } catch (e) {}
  }
}
async function handleImage(req, url, imageStore, imgId) {
  if (req.method !== "GET") return err("지원하지 않는 요청입니다.", 405);
  if (!imgId) return err("이미지 id가 필요합니다.", 400);
  const result = await imageStore.getWithMetadata(imgId, { type: "arrayBuffer" });
  if (!result || !result.data) return new Response("Not found", { status: 404 });
  const contentType = (result.metadata && result.metadata.contentType) || "image/jpeg";
  return new Response(result.data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/* ============================================================
   조회수
   ============================================================ */
function emptyCounter() { return { total: 0, daily: {} }; }
function defaultStats() {
  return {
    site: emptyCounter(),
    sections: { news: emptyCounter(), salad: emptyCounter(), mealplan: emptyCounter(), mealbox: emptyCounter() },
    slides: {}, posts: {},
    updatedAt: new Date().toISOString(),
  };
}
async function readStats(store) {
  const raw = await readJSON(store, "stats", null);
  const base = defaultStats();
  if (!raw) return base;
  return {
    site: raw.site && typeof raw.site.total === "number" ? { total: raw.site.total, daily: raw.site.daily || {} } : base.site,
    sections: {
      news: raw.sections?.news || emptyCounter(),
      salad: raw.sections?.salad || emptyCounter(),
      mealplan: raw.sections?.mealplan || emptyCounter(),
      mealbox: raw.sections?.mealbox || emptyCounter(),
    },
    slides: raw.slides || {},
    posts: raw.posts || {},
    updatedAt: raw.updatedAt || base.updatedAt,
  };
}
function trimDaily(counter) {
  if (!counter || !counter.daily) return counter;
  const keys = Object.keys(counter.daily).sort();
  if (keys.length <= STATS_DAILY_KEEP_DAYS) return counter;
  keys.slice(0, keys.length - STATS_DAILY_KEEP_DAYS).forEach((k) => delete counter.daily[k]);
  return counter;
}
function bumpCounter(counter, day, by = 1) {
  if (!counter) counter = emptyCounter();
  counter.total = (counter.total || 0) + by;
  counter.daily = counter.daily || {};
  counter.daily[day] = (counter.daily[day] || 0) + by;
  return trimDaily(counter);
}
/* 날짜를 그 주의 시작일(월요일)로 변환 */
function weekStartOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}
/* 일별 기록을 일/주/월 단위로 묶어 최근 N구간 추이를 만듭니다. */
function buildTrend(daily, period, count) {
  daily = daily || {};
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const buckets = [];
  if (period === "month") {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      buckets.push({ key: d.toISOString().slice(0, 7), label: `${d.getUTCMonth() + 1}월`, count: 0 });
    }
    Object.keys(daily).forEach((day) => {
      const b = buckets.find((x) => x.key === day.slice(0, 7));
      if (b) b.count += daily[day];
    });
  } else if (period === "week") {
    const thisWeek = weekStartOf(now.toISOString().slice(0, 10));
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(thisWeek + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i * 7);
      buckets.push({ key: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}~`, count: 0 });
    }
    Object.keys(daily).forEach((day) => {
      const b = buckets.find((x) => x.key === weekStartOf(day));
      if (b) b.count += daily[day];
    });
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, count: daily[key] || 0 });
    }
  }
  return buckets;
}
/* 현재 구간(오늘/이번 주/이번 달)의 합계 */
function currentPeriodSum(daily, period, today) {
  daily = daily || {};
  if (period === "month") {
    const k = today.slice(0, 7);
    return Object.keys(daily).filter((d) => d.startsWith(k)).reduce((a, d) => a + daily[d], 0);
  }
  if (period === "week") {
    const ws = weekStartOf(today);
    return Object.keys(daily).filter((d) => weekStartOf(d) === ws).reduce((a, d) => a + daily[d], 0);
  }
  return daily[today] || 0;
}
async function handleStats(req, url, store, subpath) {
  if (req.method === "GET" && !subpath) {
    const period = ["day", "week", "month"].includes(url.searchParams.get("period"))
      ? url.searchParams.get("period") : "day";
    const defaultCount = period === "day" ? 7 : period === "week" ? 8 : 6;
    let count = parseInt(url.searchParams.get("count"), 10);
    if (!Number.isFinite(count) || count < 1 || count > 24) count = defaultCount;
    const stats = await readStats(store);
    const slides = await readJSON(store, "news-slides", []);
    const today = todayKST();
    const pick = (c) => ({
      total: c?.total || 0,
      current: currentPeriodSum(c?.daily, period, today),
    });
    return json({
      period,
      periodLabel: period === "day" ? "오늘" : period === "week" ? "이번 주" : "이번 달",
      site: { ...pick(stats.site), trend: buildTrend(stats.site.daily, period, count) },
      sections: {
        news: pick(stats.sections.news),
        salad: pick(stats.sections.salad),
        mealplan: pick(stats.sections.mealplan),
        mealbox: pick(stats.sections.mealbox),
      },
      slides: slides.map((s, idx) => ({
        id: s.id, order: idx + 1, imageId: s.imageId, ...pick(stats.slides[s.id]),
      })),
      updatedAt: stats.updatedAt,
    });
  }
  if (req.method === "POST" && subpath === "track") {
    const body = await readBody(req);
    const { type, section, id } = body;
    const day = todayKST();
    const stats = await readStats(store);
    if (type === "site") {
      stats.site = bumpCounter(stats.site, day);
    } else if (type === "section") {
      if (!VALID_SECTIONS.has(section)) return err("알 수 없는 섹션입니다.", 400);
      stats.sections[section] = bumpCounter(stats.sections[section], day);
      if (id) {
        if (section === "news") stats.slides[id] = bumpCounter(stats.slides[id], day);
        else if (section === "salad") stats.posts[id] = bumpCounter(stats.posts[id], day);
      }
    } else {
      return err("type은 site 또는 section 이어야 합니다.", 400);
    }
    stats.updatedAt = new Date().toISOString();
    await store.setJSON("stats", stats);
    return json({ ok: true });
  }
  if (req.method === "POST" && subpath === "reset") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    await store.setJSON("stats", defaultStats());
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   기존 base64 → 이미지 파일 자동 이전 (1회)
   ============================================================ */
async function runMigrationIfNeeded(store, imageStore) {
  const status = await readJSON(store, "migration-status", null);
  if (status && status.done) return status;
  const counts = { news: 0, salad: 0, gallery: 0, prefs: 0 };
  const slides = await readJSON(store, "news-slides", []);
  let slidesChanged = false;
  for (const s of slides) {
    if (s.image && typeof s.image === "string" && s.image.startsWith("data:")) {
      const imgId = await saveDataUrlAsImage(imageStore, s.image);
      if (imgId) { s.imageId = imgId; delete s.image; counts.news++; slidesChanged = true; }
    }
  }
  if (slidesChanged) await store.setJSON("news-slides", slides);
  const posts = await readJSON(store, "salad-posts", []);
  let postsChanged = false;
  for (const p of posts) {
    if (Array.isArray(p.images) && p.images.some((i) => typeof i === "string" && i.startsWith("data:"))) {
      const newIds = [];
      for (const img of p.images) {
        const id = await saveDataUrlAsImage(imageStore, img);
        if (id) newIds.push(id);
      }
      p.images = newIds; counts.salad += newIds.length; postsChanged = true;
    }
  }
  if (postsChanged) await store.setJSON("salad-posts", posts);
  for (const cat of ["mealplan", "mealbox"]) {
    const key = "gallery-" + cat;
    const rec = await readJSON(store, key, null);
    if (rec && rec.data && typeof rec.data === "string" && rec.data.startsWith("data:")) {
      const imgId = await saveDataUrlAsImage(imageStore, rec.data);
      if (imgId) { await store.setJSON(key, { imageId: imgId, date: rec.date || new Date().toISOString() }); counts.gallery++; }
    }
  }
  const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
  let prefsChanged = false;
  if (prefs.avatar && prefs.avatar.data && String(prefs.avatar.data).startsWith("data:")) {
    const imgId = await saveDataUrlAsImage(imageStore, prefs.avatar.data);
    if (imgId) { prefs.avatar = { imageId: imgId, date: prefs.avatar.date || new Date().toISOString() }; counts.prefs++; prefsChanged = true; }
  }
  if (prefs.background && prefs.background.data && String(prefs.background.data).startsWith("data:")) {
    const imgId = await saveDataUrlAsImage(imageStore, prefs.background.data);
    if (imgId) {
      prefs.background = {
        imageId: imgId,
        posX: prefs.background.posX ?? 50, posY: prefs.background.posY ?? 50,
        zoom: prefs.background.zoom ?? 100, date: prefs.background.date || new Date().toISOString(),
      };
      counts.prefs++; prefsChanged = true;
    }
  }
  if (prefsChanged) await store.setJSON("site-prefs", prefs);
  const result = { done: true, migratedAt: new Date().toISOString(), counts };
  await store.setJSON("migration-status", result);
  return result;
}

/* ============================================================
   샐러드
   ============================================================ */
async function handleSalad(req, url, store, imageStore) {
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    const posts = await readJSON(store, "salad-posts", []);
    if (id) {
      const post = posts.find((p) => p.id === id);
      if (!post) return err("게시글을 찾을 수 없습니다.", 404);
      return json(post);
    }
    const comments = await readJSON(store, "comments", []);
    const countMap = {};
    comments.forEach((c) => { if (c.feedKey === "salad") countMap[c.itemId] = (countMap[c.itemId] || 0) + 1; });
    return json(posts.slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((p) => ({
        id: p.id, title: p.title, author: p.author,
        content: (p.content || "").slice(0, 100),
        thumbId: (p.images && p.images[0]) || null,
        imageCount: (p.images || []).length,
        date: p.date, commentCount: countMap[p.id] || 0,
      })));
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!body.title || !body.title.trim()) return err("제목을 입력해주세요.", 400);
    const imageIds = await saveManyDataUrls(imageStore, body.images);
    const posts = await readJSON(store, "salad-posts", []);
    const newPost = {
      id: uid(), title: body.title.trim(),
      author: (body.author || "").trim() || "R&D인사팀",
      content: body.content || "", images: imageIds,
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
    const target = posts.find((p) => p.id === id);
    await store.setJSON("salad-posts", posts.filter((p) => p.id !== id));
    if (target) await deleteImages(imageStore, target.images);
    const comments = await readJSON(store, "comments", []);
    await store.setJSON("comments", comments.filter((c) => !(c.feedKey === "salad" && c.itemId === id)));
    const stats = await readStats(store);
    if (stats.posts[id]) { delete stats.posts[id]; await store.setJSON("stats", stats); }
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   소식지 슬라이더
   ============================================================ */
async function handleNewsSlides(req, url, store, imageStore, subpath) {
  if (req.method === "GET") {
    const slides = await readJSON(store, "news-slides", []);
    return json(slides.map((s) => ({ id: s.id, imageId: s.imageId, date: s.date })));
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return err("사진을 최소 1장 첨부해주세요.", 400);
    const slides = await readJSON(store, "news-slides", []);
    const room = MAX_NEWS_SLIDES - slides.length;
    const toAdd = images.slice(0, Math.max(room, 0));
    const now = new Date();
    const newItems = [];
    for (let i = 0; i < toAdd.length; i++) {
      const imgId = await saveDataUrlAsImage(imageStore, toAdd[i]);
      if (imgId) newItems.push({ id: uid(), imageId: imgId, date: new Date(now.getTime() + i).toISOString() });
    }
    await store.setJSON("news-slides", newItems.concat(slides));
    const skipped = images.length - toAdd.length;
    return json({
      added: newItems.length, skipped,
      message: skipped > 0
        ? `사진은 최대 ${MAX_NEWS_SLIDES}장까지 보관할 수 있어 ${newItems.length}장만 추가되고 ${skipped}장은 제외되었습니다.`
        : "사진이 추가되었습니다!",
    }, 201);
  }
  if (req.method === "PUT" && subpath === "reorder") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!Array.isArray(body.order) || !body.order.length) return err("order 배열이 필요합니다.", 400);
    const slides = await readJSON(store, "news-slides", []);
    const byId = new Map(slides.map((s) => [s.id, s]));
    const reordered = body.order.map((id) => byId.get(id)).filter(Boolean);
    const used = new Set(reordered.map((s) => s.id));
    slides.forEach((s) => { if (!used.has(s.id)) reordered.push(s); });
    await store.setJSON("news-slides", reordered);
    return json(reordered.map((s) => ({ id: s.id, imageId: s.imageId, date: s.date })));
  }
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!id) return err("id가 필요합니다.", 400);
    const slides = await readJSON(store, "news-slides", []);
    const target = slides.find((s) => s.id === id);
    await store.setJSON("news-slides", slides.filter((s) => s.id !== id));
    if (target && target.imageId) await deleteImages(imageStore, [target.imageId]);
    const stats = await readStats(store);
    if (stats.slides[id]) { delete stats.slides[id]; await store.setJSON("stats", stats); }
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   댓글 / 갤러리 / 사이트설정 / 섹션제목 / 인증
   ============================================================ */
async function handleComments(req, url, store) {
  if (req.method === "GET") {
    const feedKey = url.searchParams.get("feedKey");
    const itemId = url.searchParams.get("itemId");
    const all = await readJSON(store, "comments", []);
    return json(all.filter((c) => c.feedKey === feedKey && c.itemId === itemId)
      .sort((a, b) => new Date(a.date) - new Date(b.date)));
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body.feedKey || !body.itemId) return err("feedKey와 itemId가 필요합니다.", 400);
    if (!body.text || !body.text.trim()) return err("댓글 내용을 입력해주세요.", 400);
    const all = await readJSON(store, "comments", []);
    const newComment = {
      id: uid(), feedKey: body.feedKey, itemId: body.itemId,
      author: (body.author || "").trim() || "익명",
      text: body.text.trim(), date: new Date().toISOString(),
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
    await store.setJSON("comments", all.filter((c) => c.id !== id));
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}
async function handleGallery(req, url, store, imageStore) {
  const category = url.searchParams.get("category");
  if (category !== "mealplan" && category !== "mealbox") return err("category는 mealplan 또는 mealbox 여야 합니다.", 400);
  const key = "gallery-" + category;
  if (req.method === "GET") return json(await readJSON(store, key, null));
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (!body.image) return err("사진 데이터가 필요합니다.", 400);
    const old = await readJSON(store, key, null);
    const imgId = await saveDataUrlAsImage(imageStore, body.image);
    const record = { imageId: imgId, date: new Date().toISOString() };
    await store.setJSON(key, record);
    if (old && old.imageId && old.imageId !== imgId) await deleteImages(imageStore, [old.imageId]);
    return json(record);
  }
  if (req.method === "DELETE") {
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    const old = await readJSON(store, key, null);
    await store.setJSON(key, null);
    if (old && old.imageId) await deleteImages(imageStore, [old.imageId]);
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}
async function handleSitePrefs(req, url, store, imageStore) {
  if (req.method === "GET") return json(await readJSON(store, "site-prefs", { avatar: null, background: null }));
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (body.type !== "avatar" && body.type !== "background") return err("type은 avatar 또는 background 여야 합니다.", 400);
    if (!body.data) return err("사진 데이터가 필요합니다.", 400);
    const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
    const oldId = prefs[body.type] && prefs[body.type].imageId;
    const imgId = await saveDataUrlAsImage(imageStore, body.data);
    if (body.type === "avatar") prefs.avatar = { imageId: imgId, date: new Date().toISOString() };
    else prefs.background = {
      imageId: imgId,
      posX: typeof body.posX === "number" ? body.posX : 50,
      posY: typeof body.posY === "number" ? body.posY : 50,
      zoom: typeof body.zoom === "number" ? body.zoom : 100,
      date: new Date().toISOString(),
    };
    await store.setJSON("site-prefs", prefs);
    if (oldId && oldId !== imgId) await deleteImages(imageStore, [oldId]);
    return json(prefs);
  }
  if (req.method === "DELETE") {
    const type = url.searchParams.get("type");
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    if (type !== "avatar" && type !== "background") return err("type은 avatar 또는 background 여야 합니다.", 400);
    const prefs = await readJSON(store, "site-prefs", { avatar: null, background: null });
    const oldId = prefs[type] && prefs[type].imageId;
    prefs[type] = null;
    await store.setJSON("site-prefs", prefs);
    if (oldId) await deleteImages(imageStore, [oldId]);
    return json(prefs);
  }
  return err("지원하지 않는 요청입니다.", 405);
}
async function handleSectionTitles(req, url, store) {
  if (req.method === "GET") return json(await readJSON(store, "section-titles", {}));
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const current = await readJSON(store, "section-titles", {});
    ["salad", "news", "mealplan", "mealbox"].forEach((key) => {
      if (typeof body.titles?.[key] === "string") {
        const t = body.titles[key].trim();
        if (t) current[key] = t; else delete current[key];
      }
    });
    await store.setJSON("section-titles", current);
    return json(current);
  }
  return err("지원하지 않는 요청입니다.", 405);
}
async function handleAuth(req, url, store, subpath) {
  if (subpath === "verify" && req.method === "POST") {
    const body = await readBody(req);
    return json({ ok: await verifyCode(store, body.code) });
  }
  if (subpath === "change" && req.method === "POST") {
    const body = await readBody(req);
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
   ★ 식단표·밀박스 사진 (1번·2번) — 업로드하면 그 번호 사진이 자동 교체
   ============================================================ */
async function handleMealPhotos(req, url, store, imageStore) {
  if (req.method === "GET") return json(await readJSON(store, "meal-photos", []));
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const slot = Number(body.slot);
    if (slot !== 1 && slot !== 2) return err("사진 번호(1 또는 2)가 올바르지 않습니다.", 400);
    if (!body.image) return err("사진 데이터가 필요합니다.", 400);
    const list = await readJSON(store, "meal-photos", []);
    const old = list.find((p) => p.slot === slot);
    const imgId = await saveDataUrlAsImage(imageStore, body.image);
    if (!imgId) return err("사진을 저장하지 못했습니다.", 400);
    const rec = { slot, imageId: imgId, date: new Date().toISOString() };
    const next = list.filter((p) => p.slot !== slot).concat(rec).sort((a, b) => a.slot - b.slot);
    await store.setJSON("meal-photos", next);
    if (old && old.imageId && old.imageId !== imgId) await deleteImages(imageStore, [old.imageId]);
    return json({ ok: true, replaced: !!old, photo: rec });
  }
  if (req.method === "DELETE") {
    const code = url.searchParams.get("code");
    if (!(await verifyCode(store, code))) return err("인증코드가 올바르지 않습니다.", 401);
    const slot = Number(url.searchParams.get("slot"));
    const list = await readJSON(store, "meal-photos", []);
    const old = list.find((p) => p.slot === slot);
    await store.setJSON("meal-photos", list.filter((p) => p.slot !== slot));
    if (old && old.imageId) await deleteImages(imageStore, [old.imageId]);
    return json({ ok: true });
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   ★ 사원증 미태그 식사등록
   · 사원 화면(/untag/today)은 오늘(KST) 기록만, 사번·이름 일부를 가려서 제공 → 매일 0시에 새로 시작
   · 서버 기록은 그대로 보관, 3개월이 지난 기록만 자동 삭제
   ============================================================ */
function untagCutoff() {
  const [y, m, d] = todayKST().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - UNTAG_KEEP_MONTHS, d)).toISOString().slice(0, 10);
}
async function readUntag(store) {
  const list = await readJSON(store, "untag-records", []);
  const cutoff = untagCutoff();
  const kept = list.filter((r) => r.date >= cutoff);
  if (kept.length !== list.length) await store.setJSON("untag-records", kept);
  return kept;
}
async function handleUntag(req, url, store, subpath, sub2) {
  if (req.method === "GET" && subpath === "today") {
    const t = todayKST();
    const list = (await readUntag(store)).filter((r) => r.date === t).sort((a, b) => (a.at < b.at ? 1 : -1));
    return json({ date: t, count: list.length, items: list.map((r) => ({ id: r.id, empNo: maskEmp(r.empNo), name: maskName(r.name) })) });
  }
  if (req.method === "POST" && !subpath) {
    const body = await readBody(req);
    const empNo = cleanText(body.empNo, 20).replace(/\s/g, "");
    const name = cleanText(body.name, 20);
    if (!/^[A-Za-z0-9]{3,12}$/.test(empNo)) return err("사번은 영문/숫자 3~12자로 입력해주세요.", 400);
    if (!name) return err("이름을 입력해주세요.", 400);
    const t = todayKST();
    const list = await readUntag(store);
    if (list.some((r) => r.date === t && String(r.empNo).toUpperCase() === empNo.toUpperCase())) return err("오늘 이미 등록된 사번입니다.", 409);
    const rec = { id: uid(), empNo, name, date: t, at: new Date().toISOString() };
    list.push(rec);
    await store.setJSON("untag-records", list);
    return json({ ok: true, id: rec.id, date: rec.date }, 201);
  }
  if (req.method === "POST" && subpath === "admin") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const list = await readUntag(store);
    if (sub2 === "list") {
      const f = body.from || "", to = body.to || "", t = todayKST();
      const items = list.filter((r) => (!f || r.date >= f) && (!to || r.date <= to)).sort((a, b) => (a.at < b.at ? 1 : -1));
      return json({ total: list.length, today: list.filter((r) => r.date === t).length, purgeBefore: untagCutoff(), items });
    }
    if (sub2 === "delete") {
      let next;
      if (body.all === true) next = [];
      else { const ids = new Set(Array.isArray(body.ids) ? body.ids : []); next = list.filter((r) => !ids.has(r.id)); }
      await store.setJSON("untag-records", next);
      return json({ deleted: list.length - next.length });
    }
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* ============================================================
   ★ 외부인 식사신청
   ============================================================ */
async function sendGuestMail(rec, adminUrl) {
  const key = envGet("RESEND_API_KEY");
  if (!key) return "skipped";
  const to = envGet("GUEST_MAIL_TO") || GUEST_MAIL_TO_DEFAULT;
  const from = envGet("GUEST_MAIL_FROM") || "R&D본부 소식지 <onboarding@resend.dev>";
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const when = new Date(rec.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const row = (k, v) => `<tr><th style="text-align:left;padding:6px 10px;background:#F7E9E9;width:110px">${k}</th><td style="padding:6px 10px">${esc(v)}</td></tr>`;
  const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;color:#2B2422">
    <h2 style="color:#9C1E22;margin:0 0 12px">🍽 외부인 식사 신청이 접수되었습니다</h2>
    <table style="border-collapse:collapse;border:1px solid #E6DFDA">${row("신청 시간", when)}${row("사번", rec.empNo)}${row("이름", rec.name)}${row("부서", rec.dept)}${row("외부업체", rec.company)}${row("식사 인원", rec.count + "명")}${row("방문 사유", rec.reason)}</table>
    <p style="margin:18px 0"><a href="${esc(adminUrl)}" style="background:#9C1E22;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">관리자 페이지에서 승인하기</a></p>
    <p style="font-size:12px;color:#756B67">링크: ${esc(adminUrl)}</p></div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `[외부인 식사신청] ${rec.dept} ${rec.name} · ${rec.company} ${rec.count}명`, html }),
    });
    if (!res.ok) { console.error("[메일 발송 실패]", res.status, await res.text().catch(() => "")); return "failed"; }
    return "sent";
  } catch (e) { console.error("[메일 발송 오류]", e); return "failed"; }
}
async function handleGuestMeal(req, url, store, subpath, sub2) {
  if (req.method === "GET" && subpath === "list") {
    const list = await readJSON(store, "guest-meals", []);
    const items = list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 300)
      .map((r) => ({ id: r.id, empNo: maskEmp(r.empNo), name: maskName(r.name), dept: r.dept, company: r.company, count: r.count, reason: r.reason, status: r.status }));
    return json({ count: list.length, items });
  }
  if (req.method === "POST" && !subpath) {
    const body = await readBody(req);
    const rec = {
      id: uid(),
      empNo: cleanText(body.empNo, 20).replace(/\s/g, ""),
      name: cleanText(body.name, 20),
      dept: cleanText(body.dept, 40),
      company: cleanText(body.company, 60),
      count: parseInt(body.count, 10),
      reason: cleanText(body.reason, 300),
      status: "pending",
      createdAt: new Date().toISOString(),
      approvedAt: null,
    };
    if (!/^[A-Za-z0-9]{3,12}$/.test(rec.empNo)) return err("사번은 영문/숫자 3~12자로 입력해주세요.", 400);
    if (!rec.name) return err("이름을 입력해주세요.", 400);
    if (!rec.dept) return err("부서를 입력해주세요.", 400);
    if (!rec.company) return err("외부업체명을 입력해주세요.", 400);
    if (!Number.isFinite(rec.count) || rec.count < 1 || rec.count > 100) return err("식사 인원수는 1~100명으로 입력해주세요.", 400);
    if (!rec.reason) return err("방문 사유를 입력해주세요.", 400);
    const list = await readJSON(store, "guest-meals", []);
    list.push(rec);
    await store.setJSON("guest-meals", list);
    const adminUrl = /^https?:\/\//.test(body.adminUrl || "") ? body.adminUrl : `${url.origin}/?admin=guest`;
    const mail = await sendGuestMail(rec, adminUrl);
    return json({ ok: true, id: rec.id, mail, record: { ...rec } }, 201);
  }
  if (req.method === "POST" && subpath === "admin") {
    const body = await readBody(req);
    if (!(await verifyCode(store, body.code))) return err("인증코드가 올바르지 않습니다.", 401);
    const list = await readJSON(store, "guest-meals", []);
    if (sub2 === "list") return json({ items: list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
    if (sub2 === "approve") {
      const rec = list.find((r) => r.id === body.id);
      if (!rec) return err("신청 건을 찾을 수 없습니다.", 404);
      rec.status = body.approved === false ? "pending" : "approved";
      rec.approvedAt = rec.status === "approved" ? new Date().toISOString() : null;
      await store.setJSON("guest-meals", list);
      return json({ ok: true, record: rec });
    }
  }
  return err("지원하지 않는 요청입니다.", 405);
}

/* 첫 화면 데이터 한 번에 제공 */
async function handleBootstrap(req, store, imageStore) {
  if (req.method !== "GET") return err("지원하지 않는 요청입니다.", 405);
  let migration = null;
  try { migration = await runMigrationIfNeeded(store, imageStore); }
  catch (e) { console.error("[자동 이전 오류]", e); }
  const [titles, prefs, mealplan, mealbox, slides, posts, comments, mealPhotos] = await Promise.all([
    readJSON(store, "section-titles", {}),
    readJSON(store, "site-prefs", { avatar: null, background: null }),
    readJSON(store, "gallery-mealplan", null),
    readJSON(store, "gallery-mealbox", null),
    readJSON(store, "news-slides", []),
    readJSON(store, "salad-posts", []),
    readJSON(store, "comments", []),
    readJSON(store, "meal-photos", []),
  ]);
  const countMap = {};
  comments.forEach((c) => { if (c.feedKey === "salad") countMap[c.itemId] = (countMap[c.itemId] || 0) + 1; });
  return json({
    titles, prefs,
    gallery: { mealplan, mealbox },
    mealPhotos,
    newsSlides: slides.map((s) => ({ id: s.id, imageId: s.imageId, date: s.date })),
    salad: posts.slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((p) => ({
        id: p.id, title: p.title, author: p.author,
        content: (p.content || "").slice(0, 100),
        thumbId: (p.images && p.images[0]) || null,
        imageCount: (p.images || []).length,
        date: p.date, commentCount: countMap[p.id] || 0,
      })),
    migration,
  });
}

/* ============================================================
   라우팅
   ============================================================ */
export default async (req, context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const resource = parts[0];
  const subpath = parts[1];
  const sub2 = parts[2];
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
  const imageStore = getImageStore();
  try {
    switch (resource) {
      case "image":          return await handleImage(req, url, imageStore, subpath);
      case "bootstrap":      return await handleBootstrap(req, store, imageStore);
      case "stats":          return await handleStats(req, url, store, subpath);
      case "salad":          return await handleSalad(req, url, store, imageStore);
      case "news-slides":    return await handleNewsSlides(req, url, store, imageStore, subpath);
      case "comments":       return await handleComments(req, url, store);
      case "gallery":        return await handleGallery(req, url, store, imageStore);
      case "site-prefs":     return await handleSitePrefs(req, url, store, imageStore);
      case "section-titles": return await handleSectionTitles(req, url, store);
      case "auth":           return await handleAuth(req, url, store, subpath);
      case "meal-photos":    return await handleMealPhotos(req, url, store, imageStore);
      case "untag":          return await handleUntag(req, url, store, subpath, sub2);
      case "guest-meal":     return await handleGuestMeal(req, url, store, subpath, sub2);
      default:               return err("알 수 없는 API 경로입니다: " + resource, 404);
    }
  } catch (e) {
    console.error("[API 오류]", resource, e);
    return err("서버 오류가 발생했습니다: " + e.message, 500);
  }
};

export const config = { path: "/api/*" };
