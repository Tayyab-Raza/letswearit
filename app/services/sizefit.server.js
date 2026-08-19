import { Buffer } from "node:buffer";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_TEXT_MODEL = "gemini-3.1-flash";

// The Interactions API's raw REST response has no `output_text` field — that's
// an SDK convenience property, not part of the wire format. The real shape is
// a `steps` timeline; the model's answer lives in the last `model_output`
// step's text content. (Falling back to JSON.stringify(payload) here, like
// the old code did, silently "succeeds" at parsing the whole raw response as
// if it were our expected {suggestedSize,...} shape — every field comes back
// undefined and the caller can't tell a real answer from a parsing failure.)
function extractInteractionText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.type !== "model_output") continue;
    const textPart = (step.content || []).find(
      (c) => c?.type === "text" && c.text,
    );
    if (textPart) return textPart.text;
  }
  return "";
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL.");
  return { mimeType: match[1], base64: match[2] };
}

// Merchants can optionally set a `tryon.size_chart` metafield (JSON) shaped like:
// [{"size":"S","chest_in":36,"waist_in":28}, {"size":"M","chest_in":38,"waist_in":30}, ...]
// When present we ask the model to map its estimate onto the merchant's own
// labels. When absent we fall back to a generic band and say so plainly —
// this is advisory, not a measurement, and the UI must present it that way.
export async function estimateSizeFit({
  personImage,
  category,
  sizeChartJson,
  productTitle,
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set on the server.");
  }

  const image = personImage.dataUrl
    ? parseDataUrl(personImage.dataUrl)
    : personImage;

  const chartInstruction = sizeChartJson
    ? `The merchant's size chart for "${productTitle}" is: ${sizeChartJson}. Map your estimate onto one of these exact size labels.`
    : `No merchant size chart was provided for "${productTitle}". Give a generic size band instead (XS, S, M, L, XL, XXL) and say clearly that it's a general estimate, not based on this merchant's specific sizing.`;

  const categoryNote =
    category === "footwear"
      ? "This is a footwear product — base the estimate on visible foot/leg proportions if possible, otherwise say sizing from a photo alone is unreliable for shoes and recommend checking the shoe size chart."
      : category === "outfit"
        ? "This is a clothing item — estimate from visible body proportions (shoulders, torso, waist) relative to typical adult proportions."
        : "Photo-based sizing isn't meaningful for this product type — respond with needsSizeChart: true and no size guess.";

  const prompt = `You are a cautious fashion sizing assistant. Look at the reference photo of a person and suggest an approximate clothing size.
${categoryNote}
${chartInstruction}

Respond with ONLY a JSON object, no other text, in this exact shape:
{"suggestedSize":"<label or null>","confidence":"low|medium","note":"<one short sentence of caveats>","needsSizeChart":<true|false>}

Be conservative: this is directional only, never claim high confidence, and never state exact body measurements in inches/cm.`;

  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: GEMINI_TEXT_MODEL,
      input: [
        { type: "text", text: prompt },
        { type: "image", mime_type: image.mimeType, data: image.base64 },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "Size estimate request failed.");
  }

  const payload = await res.json();
  const text = extractInteractionText(payload);
  if (!text)
    throw new Error("Gemini returned no usable output for this size estimate.");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse size estimate.");

  const parsed = JSON.parse(match[0]);
  return {
    suggestedSize: parsed.suggestedSize ?? null,
    confidence: parsed.confidence === "medium" ? "medium" : "low",
    note:
      parsed.note ||
      "This is a general estimate — check the product's size chart to confirm.",
    needsSizeChart: !!parsed.needsSizeChart,
  };
}
