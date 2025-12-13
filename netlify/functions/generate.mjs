// netlify/functions/generate.mjs
// Grok / xAI text generation (OpenAI-compatible)

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only" });
  }

  const key = process.env.XAI_API_KEY;
  if (!key) return json(500, { error: "AI not configured" });

  const body = JSON.parse(event.body || "{}");
  const text = String(body.text || "").slice(0, 50000);
  if (!text) return json(400, { error: "Missing text" });

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
    if (!r.ok) {
      return json(502, { error: j.error?.message || "AI failed" });
    }

    return json(200, {
      output: j.choices?.[0]?.message?.content || ""
    });
  } catch {
    return json(500, { error: "AI exception" });
  }
}
