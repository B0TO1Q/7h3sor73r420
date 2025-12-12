// netlify/functions/generate.mjs
// 7H3SOR73R — Real AI generator (OpenAI)
// Secure, server-only, Netlify-compatible

const MAX_INPUT_CHARS = 50000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(500, { error: "AI not configured" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const source = String(payload.source || "").slice(0, 40);
  const target = String(payload.target || "").slice(0, 40);
  const variant = String(payload.variant || "").slice(0, 20);
  const hook = String(payload.hook || "").slice(0, 200);
  const cta = String(payload.cta || "").slice(0, 200);
  const text = String(payload.text || "").slice(0, MAX_INPUT_CHARS);

  if (!text.trim()) {
    return json(400, { error: "Empty input" });
  }

  const systemPrompt = `
You are a professional social media editor.
Your task is to rewrite content cleanly, safely, and clearly.
Never include disallowed, explicit, or harmful content.
Output must be platform-appropriate and concise.
`;

  const userPrompt = `
SOURCE PLATFORM: ${source}
TARGET PLATFORM: ${target}
STYLE VARIANT: ${variant}
HOOK: ${hook || "(auto)"}
CALL TO ACTION: ${cta || "(none)"}

SOURCE POST:
"""
${text}
"""

INSTRUCTIONS:
- Rewrite for the TARGET PLATFORM
- Preserve the core message
- Improve clarity and engagement
- Do NOT add emojis unless natural to the platform
- Output plain text only
- If Reddit: include "Title:" on the first line
`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: variant === "spicy" ? 0.9 : variant === "minimal" ? 0.3 : 0.6,
        max_tokens: 800,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!res.ok) {
      return json(502, { error: "AI request failed" });
    }

    const data = await res.json();
    const output =
      data?.choices?.[0]?.message?.content?.trim() || "";

    return json(200, { output });
  } catch {
    return json(500, { error: "AI generation error" });
  }
}
