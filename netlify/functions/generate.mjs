// netlify/functions/generate.mjs
// 7H3SOR73R — Grok (xAI) generation via Netlify Functions (secure).
// Env vars:
//   XAI_API_KEY (SECRET, Functions scope)
// Optional:
//   GROK_MODEL (default "grok-4")
//   APP_ALLOWED_ORIGIN

"use strict";

const MAX_BODY_CHARS = 140_000;
const MAX_TEXT_CHARS = 50_000;

function pickOrigin(requestOrigin, allowedOrigin) {
  if (!allowedOrigin) return requestOrigin || "*";
  if (!requestOrigin) return allowedOrigin;
  return requestOrigin === allowedOrigin ? requestOrigin : "";
}

function headers(origin) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
}

function json(statusCode, origin, body) {
  return { statusCode, headers: headers(origin), body: JSON.stringify(body) };
}

function safeParseJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

function clampStr(v, maxLen) {
  return String(v ?? "").slice(0, maxLen);
}

function decodeBody(event) {
  const raw = event.body || "";
  if (!raw) return "";
  if (event.isBase64Encoded) {
    try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; }
  }
  return raw;
}

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

export async function handler(event) {
  const requestOrigin = event.headers?.origin || "";
  const allowedOrigin = process.env.APP_ALLOWED_ORIGIN || "";
  const origin = pickOrigin(requestOrigin, allowedOrigin);

  if (allowedOrigin && requestOrigin && !origin) {
    return { statusCode: 403, headers: headers(allowedOrigin), body: "Forbidden" };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(origin || allowedOrigin || "*"), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, origin || allowedOrigin || "*", { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return json(500, origin || allowedOrigin || "*", { error: "AI not configured" });
  }

  const decoded = decodeBody(event);
  if (decoded.length > MAX_BODY_CHARS) {
    return json(413, origin || allowedOrigin || "*", { error: "Payload too large" });
  }

  const body = safeParseJson(decoded);
  if (!body || typeof body !== "object") {
    return json(400, origin || allowedOrigin || "*", { error: "Invalid JSON" });
  }

  const source = clampStr(body.source, 40);
  const target = clampStr(body.target, 40);
  const variant = clampStr(body.variant, 20);
  const text = clampStr(body.text, MAX_TEXT_CHARS);
  const hook = clampStr(body.hook, 200);
  const cta = clampStr(body.cta, 200);

  if (!text.trim()) {
    return json(400, origin || allowedOrigin || "*", { error: "Missing text" });
  }

  const systemPrompt =
    "You are 7H3SOR73R, an enterprise-safe writing assistant. " +
    "Rewrite the source text into a copy-ready post for the target platform. " +
    "Keep it concise and clear. Do not invent facts. Return only the final formatted output.";

  const userPrompt =
    `Source platform: ${source}\n` +
    `Target platform: ${target}\n` +
    `Variation: ${variant}\n` +
    (cta ? `Goal/CTA: ${cta}\n` : "") +
    (hook ? `Hook: ${hook}\n` : "") +
    "\n---\nSOURCE TEXT:\n" +
    text;

  const model = process.env.GROK_MODEL || "grok-4";
  const temperature = variant === "spicy" ? 0.9 : variant === "minimal" ? 0.3 : 0.6;

  const { signal, cancel } = timeoutSignal(20_000);

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal,
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
        temperature,
        max_tokens: 900,
        stream: false
      })
    });

    const raw = await res.text();
    const data = safeParseJson(raw);

    if (!res.ok) {
      const detail = data?.error?.message || data?.message || `HTTP ${res.status}`;
      return json(502, origin || allowedOrigin || "*", {
        error: "AI request failed",
        status: res.status,
        detail
      });
    }

    const output = data?.choices?.[0]?.message?.content?.trim?.() || "";
    return json(200, origin || allowedOrigin || "*", { output });
  } catch (e) {
    const isAbort = String(e?.name || "").toLowerCase().includes("abort");
    return json(500, origin || allowedOrigin || "*", { error: isAbort ? "AI request timed out" : "AI generation error" });
  } finally {
    cancel();
  }
}
