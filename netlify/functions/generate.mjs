// netlify/functions/generate.mjs
// 7H3SOR73R — Grok (xAI) text generation via Netlify Functions (server-side, secure).
// Env vars required:
//   XAI_API_KEY (SECRET, Functions scope)
// Optional env vars:
//   GROK_MODEL (e.g. grok-4-0709)
//   APP_ALLOWED_ORIGIN (e.g. https://your-site.netlify.app)

function pickOrigin(requestOrigin, allowedOrigin) {
  if (!allowedOrigin) return requestOrigin || "";
  if (!requestOrigin) return allowedOrigin;
  return requestOrigin === allowedOrigin ? requestOrigin : "";
}

function json(statusCode, origin, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders
  };
  return { statusCode, headers, body: JSON.stringify(body) };
}

function safeParseJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

function clampStr(v, maxLen) {
  return String(v ?? "").slice(0, maxLen);
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
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, origin || allowedOrigin || "*", { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return json(500, origin || allowedOrigin || "*", { error: "AI not configured" });
  }

  // Basic body size guard (Netlify has its own limits too; this is defense-in-depth)
  if ((event.body || "").length > 120_000) {
    return json(413, origin || allowedOrigin || "*", { error: "Payload too large" });
  }

  const body = safeParseJson(event.body || "");
  if (!body) {
    return json(400, origin || allowedOrigin || "*", { error: "Invalid JSON" });
  }

  // Validate + clamp inputs
  const source = clampStr(body.source, 40);
  const target = clampStr(body.target, 40);
  const variant = clampStr(body.variant, 20);
  const text = clampStr(body.text, 50_000);
  const hook = clampStr(body.hook, 200);
  const cta = clampStr(body.cta, 200);

  if (!text.trim()) {
    return json(400, origin || allowedOrigin || "*", { error: "Missing text" });
  }

  const systemPrompt =
    "You are 7H3SOR73R, an enterprise-safe writing assistant. " +
    "Transform the source text into a high-quality post for the target platform. " +
    "Do not include disallowed content. Keep it concise, readable, and copy-ready.";

  const userPrompt =
    `Source platform: ${source}\n` +
    `Target platform: ${target}\n` +
    `Variation: ${variant}\n` +
    (cta ? `Goal/CTA: ${cta}\n` : "") +
    (hook ? `Hook: ${hook}\n` : "") +
    "\n---\n" +
    "SOURCE TEXT:\n" +
    text;

  const model = process.env.GROK_MODEL || "grok-4-0709";

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature:
          variant === "spicy" ? 0.9 :
          variant === "minimal" ? 0.3 : 0.6,
        max_tokens: 900,
        stream: false
      })
    });

    const raw = await res.text();
    const data = safeParseJson(raw);

    if (!res.ok) {
      const detail =
        data?.error?.message ||
        data?.message ||
        `HTTP ${res.status}`;
      return json(502, origin || allowedOrigin || "*", {
        error: "AI request failed",
        detail
      });
    }

    const output = data?.choices?.[0]?.message?.content?.trim?.() || "";
    return json(200, origin || allowedOrigin || "*", { output });
  } catch (e) {
    return json(500, origin || allowedOrigin || "*", { error: "AI generation error" });
  }
}
