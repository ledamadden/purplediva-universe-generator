exports.handler = async (event) => {
  // ── CORS headers — required for browser requests ──────────────────────────
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle preflight (browser sends this before the real POST)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing OPENAI_API_KEY on the server." })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      prompt,
      negative_prompt,
      reference_image,
      settings = {}
    } = body;

    if (!prompt || typeof prompt !== "string") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing prompt." })
      };
    }

    if (!reference_image || typeof reference_image !== "string") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing reference_image data URL." })
      };
    }

    const model = settings.imageModel || "gpt-image-1";
    const size = settings.imageSize || "1024x1024";
    const quality = settings.imageQuality || "medium";

    const fullPrompt = buildFullPrompt({
      prompt,
      negativePrompt: negative_prompt,
      settings
    });

    const imageBlob = dataUrlToBlob(reference_image);

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", fullPrompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("image", imageBlob, "purple-diva-reference.png");

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: text
      };
    }

    const data = JSON.parse(text);
    const item = data?.data?.[0];

    if (!item) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "No image returned from OpenAI." })
      };
    }

    if (item.b64_json) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          b64_json: item.b64_json,
          mime_type: "image/png"
        })
      };
    }

    if (item.url) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          image_url: item.url
        })
      };
    }

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No usable image payload found." })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown server error"
      })
    };
  }
};

function buildFullPrompt({ prompt, negativePrompt, settings }) {
  const sceneBits = [
    settings.scene,
    settings.mood,
    settings.wardrobe,
    settings.camera,
    settings.outputType
  ].filter(Boolean);

  const identityBits = [
    settings.identityStrength,
    settings.faceMatchStrength,
    settings.preserveSkinTone ? "preserve exact skin tone" : null,
    settings.preserveHairstyle ? "preserve hairstyle" : null,
    settings.noBeautify ? "do not beautify or reinterpret the face" : null
  ].filter(Boolean);

  let merged = prompt.trim();

  if (sceneBits.length) {
    merged += `, scene settings: ${sceneBits.join(", ")}`;
  }

  if (identityBits.length) {
    merged += `, identity requirements: ${identityBits.join(", ")}`;
  }

  if (negativePrompt && String(negativePrompt).trim()) {
    merged += `, avoid: ${String(negativePrompt).trim()}`;
  }

  return merged;
}

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid reference_image data URL.");
  }

  const mimeType = match[1] || "image/png";
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  return new Blob([buffer], { type: mimeType });
}
