// netlify/functions/x-one.mjs
// 7H3SOR73R — X (v2) single-account fetch with cache + strict CORS + media support.
// Env vars:
//   X_BEARER_TOKEN (SECRET, Functions scope)
//   X_ALLOWED_HANDLE (e.g. elder_plinius)
//   APP_ALLOWED_ORIGIN (e.g. https://aesthetic-taiyaki-6d206a.netlify.app)

"use strict";

let CACHE = { ts: 0, data: null };
const TTL_MS = 120_000; // 2 minutes

function pickOrigin(requestOrigin, allowedOrigin) {
  if (!allowedOrigin) return requestOrigin || "*";
  if (!requestOrigin) return allowedOrigin;
  return requestOrigin === allowedOrigin ? requestOrigin : "";
}

function json(statusCode, origin, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders
  };
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function fetchJson(url, bearer) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${bearer}`,
      "Accept": "application/json"
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

export async function handler(event) {
  const requestOrigin = event.headers?.origin || "";
  const allowedOrigin = process.env.APP_ALLOWED_ORIGIN || "";
  const origin = pickOrigin(requestOrigin, allowedOrigin);

  // Block other origins from using your function as a proxy.
  if (allowedOrigin && requestOrigin && !origin) {
    return { statusCode: 403, body: "Forbidden" };
  }

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || allowedOrigin || "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, origin || allowedOrigin || "*", { error: "Method not allowed" });
  }

  const bearer = process.env.X_BEARER_TOKEN;
  const handle = process.env.X_ALLOWED_HANDLE;

  if (!bearer || !handle) {
    return json(500, origin || allowedOrigin || "*", { error: "Server misconfigured" });
  }

  // Cache hit
  const now = Date.now();
  if (CACHE.data && (now - CACHE.ts) < TTL_MS) {
    return json(200, origin || allowedOrigin || "*", { ...CACHE.data, cached: true }, { "X-Cache": "HIT" });
  }

  const username = String(handle).trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    return json(400, origin || allowedOrigin || "*", { error: "Invalid configured handle" });
  }

  try {
    // 1) Resolve username -> user
    const userUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=profile_image_url`;
    const userRes = await fetchJson(userUrl, bearer);

    if (!userRes.ok) {
      return json(userRes.status, origin || allowedOrigin || "*", { error: "X user lookup failed", status: userRes.status });
    }

    const userId = userRes.data?.data?.id;
    if (!userId) {
      return json(502, origin || allowedOrigin || "*", { error: "Missing user id from X" });
    }

    // 2) Fetch tweets + media expansions
    const tweetsUrl =
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets` +
      `?max_results=10` +
      `&tweet.fields=created_at,public_metrics,referenced_tweets,attachments` +
      `&expansions=attachments.media_keys` +
      `&media.fields=type,url,preview_image_url,alt_text`;

    const tweetsRes = await fetchJson(tweetsUrl, bearer);

    if (!tweetsRes.ok) {
      return json(tweetsRes.status, origin || allowedOrigin || "*", { error: "X timeline failed", status: tweetsRes.status });
    }

    const mediaArr = tweetsRes.data?.includes?.media || [];
    const mediaByKey = new Map(mediaArr.map(m => [m.media_key, m]));

    const payload = {
      handle: username,
      user: {
        name: userRes.data?.data?.name || null,
        username: userRes.data?.data?.username || username,
        pfp: userRes.data?.data?.profile_image_url || null
      },
      tweets: (tweetsRes.data?.data || []).map(t => {
        const keys = t.attachments?.media_keys || [];
        const media = keys
          .map(k => mediaByKey.get(k))
          .filter(Boolean)
          .map(m => ({
            type: m.type,
            url: m.url || null,
            preview: m.preview_image_url || null,
            alt: m.alt_text || ""
          }));

        return {
          id: t.id,
          text: t.text,
          created_at: t.created_at,
          metrics: t.public_metrics || {},
          media
        };
      }),
      cached: false
    };

    CACHE = { ts: now, data: payload };

    return json(200, origin || allowedOrigin || "*", payload, { "X-Cache": "MISS" });
  } catch {
    return json(500, origin || allowedOrigin || "*", { error: "Server error" });
  }
}
