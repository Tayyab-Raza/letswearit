// Shared Gemini "Interactions API" client + response helpers.
// category.server.js needs the text/classification helpers; api.tryon.jsx
// needs the image-generation helpers. Both live here so there's one place
// that talks to Gemini and one set of model names to keep in sync.

export const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

export const GEMINI_TEXT_MODEL = "gemini-3.1-flash";

// Image-capable model for the actual try-on render. Override with an env var
// if your account uses a different preview name — verify the current model
// id in the Gemini API docs before launch, the same way VEO_MODEL is handled
// in video.server.js.
export const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export class GeminiRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status || 502;
  }
}

// Calls the Interactions API and returns the parsed JSON payload.
// `input` is the array of {type:"text"|"image", ...} parts.
// `responseFormat` is optional — pass it for image-generation calls
// (api.tryon.jsx), omit it for plain text/classification calls.
export async function callGeminiInteraction({ model, input, responseFormat }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new GeminiRequestError(
      "GEMINI_API_KEY is not set on the server.",
      500,
    );
  }

  const body = { model: model || GEMINI_TEXT_MODEL, input };
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiRequestError(err.message || "Could not reach Gemini.", 502);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GeminiRequestError(
      err?.error?.message || `Gemini request failed (${res.status}).`,
      res.status,
    );
  }

  return res.json();
}

// The Interactions API's raw REST response has no `output_text` field — that's
// an SDK convenience property, not part of the wire format. The real shape is
// a `steps` timeline; the model's answer lives in the last `model_output`
// step's text content.
export function extractInteractionText(payload) {
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

// Same idea as extractInteractionText, but for the generated-image case:
// pulls the base64 image data out of the last model_output step's image
// content part. Also checks the convenience top-level field, in case the
// wire format ever adds one, mirroring extractInteractionText's fallback.
export function extractInteractionImageBase64(payload) {
  if (typeof payload?.output_image_base64 === "string") {
    return payload.output_image_base64;
  }
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.type !== "model_output") continue;
    const imagePart = (step.content || []).find(
      (c) => c?.type === "image" && (c.data || c.image_base64),
    );
    if (imagePart) return imagePart.data || imagePart.image_base64;
  }
  return "";
}

// Pulls the first {...} block out of a model's text reply and JSON.parses it.
export function parseJsonFromModelText(text, errorMessage) {
  if (!text) throw new Error(errorMessage || "Model returned no output.");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(errorMessage || "Could not parse model output.");
  return JSON.parse(match[0]);
}
