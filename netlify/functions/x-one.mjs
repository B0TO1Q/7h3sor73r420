// netlify/functions/x-one.mjs
// Enterprise-safe X feed (single account, media enabled)

const RATE = new Map(); // ip -> { ts, count }
const RATE_LIMIT = 30; // req/min
const WINDOW = 60_000;
let CACHE = { ts: 0, data: null };
const TTL = 120_000;

function rateLimit(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { ts: now, count: 0 };
  if (now - r.ts > WINDOW) { r.ts = now; r.count = 0; }
  r.count++;
  RATE.set(ip, r);
  return r.count <= RATE_LIMIT;
}

function json(code, body) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

async function fetchJSON(url, token) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, data: t ? JSON.parse(t) : null };
}

export async function handler(event) {
  const ip = event.headers["x-nf-client-connection-ip"] || "unknown";
  if (!rateLimit(ip)) return json(429, { error: "Rate limited" });

  const token = process.env.X_BEARER_TOKEN;
  const handle = process.env.X_ALLOWED_HANDLE;
  if (!token || !handle) return json(500, { error: "X not configured" });

  const now = Date.now();
  if (CACHE.data && now - CACHE.ts < TTL) {
    return json(200, { ...CACHE.data, cached: true });
  }

  const user = await fetchJSON(
    `https://api.x.com/2/users/by/username/${handle}?user.fields=profile_image_url`,
    token
  );
  if (!user.ok) return json(502, { error: "User lookup failed" });

  const id = user.data.data.id;

  const feed = await fetchJSON(
    `https://api.x.com/2/users/${id}/tweets` +
    `?max_results=6` +
    `&exclude=retweets,replies` +
    `&tweet.fields=created_at,public_metrics,attachments` +
    `&expansions=attachments.media_keys` +
    `&media.fields=url,preview_image_url,type,alt_text`,
    token
  );
  if (!feed.ok) return json(502, { error: "Timeline failed" });

  const mediaMap = new Map(
    (feed.data.includes?.media || []).map(m => [m.media_key, m])
  );

  const payload = {
    user: {
      name: user.data.data.name,
      username: user.data.data.username,
      pfp: user.data.data.profile_image_url
    },
    tweets: (feed.data.data || []).map(t => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
      metrics: t.public_metrics || {},
      media: (t.attachments?.media_keys || [])
        .map(k => mediaMap.get(k))
        .filter(Boolean)
        .map(m => ({
          type: m.type,
          url: m.url || m.preview_image_url,
          alt: m.alt_text || ""
        }))
    }))
  };

  CACHE = { ts: now, data: payload };
  return json(200, payload);
}
