// netlify/functions/x-one.mjs
// Locked single-account X feed with media support

let CACHE = { ts: 0, data: null };
const TTL = 120_000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

async function fetchJSON(url, bearer) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json"
    }
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, data: t ? JSON.parse(t) : null };
}

export async function handler() {
  const bearer = process.env.X_BEARER_TOKEN;
  const handle = process.env.X_ALLOWED_HANDLE;

  if (!bearer || !handle) {
    return json(500, { error: "X not configured" });
  }

  const now = Date.now();
  if (CACHE.data && now - CACHE.ts < TTL) {
    return json(200, { ...CACHE.data, cached: true });
  }

  // Resolve user
  const u = await fetchJSON(
    `https://api.x.com/2/users/by/username/${handle}?user.fields=profile_image_url`,
    bearer
  );
  if (!u.ok) return json(502, { error: "User lookup failed" });

  const userId = u.data.data.id;

  // Fetch tweets + media
  const t = await fetchJSON(
    `https://api.x.com/2/users/${userId}/tweets` +
      `?max_results=8` +
      `&exclude=retweets,replies` +
      `&tweet.fields=created_at,public_metrics,attachments` +
      `&expansions=attachments.media_keys` +
      `&media.fields=type,url,preview_image_url,alt_text`,
    bearer
  );
  if (!t.ok) return json(502, { error: "Timeline failed" });

  const mediaMap = new Map(
    (t.data.includes?.media || []).map(m => [m.media_key, m])
  );

  const payload = {
    user: {
      name: u.data.data.name,
      username: u.data.data.username,
      pfp: u.data.data.profile_image_url
    },
    tweets: (t.data.data || []).map(x => ({
      id: x.id,
      text: x.text,
      created_at: x.created_at,
      metrics: x.public_metrics || {},
      media: (x.attachments?.media_keys || [])
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
