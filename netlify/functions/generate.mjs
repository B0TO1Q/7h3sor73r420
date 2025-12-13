// netlify/functions/generate.mjs
// Grok (xAI) enterprise-safe generation

const RATE = new Map();
const WINDOW = 60_000;
const LIMIT = 10;

function rate(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { ts: now, n: 0 };
  if (now - r.ts > WINDOW) { r.ts = now; r.n = 0; }
  r.n++;
  RATE.set(ip, r);
  return r.n <= LIMIT;
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

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const origin = event.headers.origin || "";
  const allowed = process.env.APP_ALLOWED_ORIGIN;
  if (allowed && origin !== allowed) return json(403, { error: "Forbidden" });

  const appKey = event.headers["x-app-key"];
  if (appKey !== process.env.APP_PUBLIC_KEY) {
    return json(403, { error: "Unauthorized client" });
  }

  const ip = event.headers["x-nf-client-connection-ip"] || "unknown";
  if (!rate(ip)) return json(429, { error: "Rate limited" });

  const key = process.env.XAI_API_KEY;
  if (!key) return json(500, { error: "AI not configured" });

  const body = JSON.parse(event.body || "{}");
  const text = String(body.text || "").slice(0, 50_000);
  if (!text.trim()) return json(400, { error: "Missing text" });

  const prompt =
`Rewrite the following X post for ${body.target || "Reddit"}.

Tone: ${body.variant || "safe"}
CTA: ${body.cta || "none"}

POST:
${text}`;

  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "grok-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        stream: false
      })
    });

    const j = await r.json();
    if (!r.ok) return json(502, { error: "AI request failed" });

    return json(200, {
      output: String(j.choices?.[0]?.message?.content || "")
    });
  } catch {
    return json(500, { error: "AI exception" });
  }
}
