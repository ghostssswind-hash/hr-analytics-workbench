// 「2026 人力行政部 · 数据分析工作台」— 各模块可见性配置接口
//
// 用途：让管理员在「权限设置」页勾选后立即生效，不需要重新部署。
// 存储：EdgeOne Makers Blob（首次调用自动创建命名空间，无需控制台配置）
//
// 接口：
//   GET  /api/acl   读取当前配置（中间件内部也会调用它来判定权限）
//   POST /api/acl   保存配置（仅管理员；由 middleware.js 注入并覆盖 x-hr-role 头来鉴权）
//
// 配置结构：
//   { version, updated, staff: { <模块key>: true|false } }
//   staff 表示「员工密码能看到哪些模块」；管理员始终能看全部。

import { getStore } from "@edgeone/pages-blob";

const STORE_NAME = "hr-workbench-acl";
const KEY = "acl.json";

// 可对员工开关的模块（其余模块不在此表内 → 员工一律不可见）
const TOGGLE_KEYS = [
  "overview",
  "recruit",
  "perf",
  "quality",
];

// 读取失败 / 首次使用时的默认值：敏感模块一律关闭（fail-safe）
const DEFAULTS = {
  version: 1,
  updated: null,
  staff: {
    overview: true,
    recruit: true,
    perf: true,
    quality: true,
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // 角色由 middleware.js 注入（外部的伪造值会被中间件覆盖）
  const role = request.headers.get("x-hr-role") || "none";

  let store;
  try {
    store = getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (e) {
    return json({ ok: true, config: DEFAULTS, source: "default", warning: "store_unavailable" });
  }

  if (request.method === "GET") {
    let cfg = null;
    try {
      cfg = await store.get(KEY, { type: "json" });
    } catch (e) {
      cfg = null;
    }
    return json({ ok: true, source: cfg ? "cloud" : "default", config: cfg || DEFAULTS });
  }

  // ---- POST：保存（仅管理员）----
  if (role !== "admin") {
    return json({ ok: false, error: "forbidden", role: role }, 403);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const incoming = (body && body.staff) || {};

  const staff = Object.assign({}, DEFAULTS.staff);
  TOGGLE_KEYS.forEach(function (k) {
    if (typeof incoming[k] === "boolean") staff[k] = incoming[k];
  });

  const cfg = { version: 1, updated: new Date().toISOString(), staff: staff };
  try {
    await store.setJSON(KEY, cfg);
  } catch (e) {
    return json({ ok: false, error: "write_failed", detail: String(e) }, 500);
  }
  return json({ ok: true, config: cfg });
}
