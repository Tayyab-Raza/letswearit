import { Buffer } from "node:buffer";

// Veo 3.1 is exposed through the same Gemini API as the image generation
// and classification calls elsewhere in this app — no separate vendor
// account needed, just the one GEMINI_API_KEY. It's a paid-preview,
// long-running (async) endpoint though, unlike the synchronous image
// endpoint: you submit a job, then poll it until it's done.
//
// Cost note: as of mid-2026 Veo 3.1 Fast runs roughly $0.15/sec and
// Standard roughly $0.40-0.75/sec — confirm current pricing before launch.
// Fast is the sensible default for a 3-4s try-on clip.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const VEO_MODEL = process.env.VEO_MODEL || "veo-3.1-fast-generate-preview";

// Long-running job: poll every 5s, give up after ~90s so a single HTTP
// request doesn't hang indefinitely. If your hosting has a longer request
// timeout budget, raise MAX_POLL_MS — or move this to a queue + webhook /
// client-side polling pattern for production (see note in api.tryon.video.jsx).
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 90000;

export class VideoProviderNotConfiguredError extends Error {
  constructor() {
    super("Video try-on isn't configured — set GEMINI_API_KEY on the server.");
    this.name = "VideoProviderNotConfiguredError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateTryOnVideo({ stillImageBase64, mimeType, productTitle }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new VideoProviderNotConfiguredError();
  }

  const prompt = `Subtle, natural turn: the person slowly rotates a quarter turn left then back to center, showing the "${productTitle}" from a couple of angles. Keep the motion slow and realistic, no camera movement, no background change, no new objects or people.`;

  const startRes = await fetch(`${GEMINI_BASE}/models/${VEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      instances: [
        {
          prompt,
          image: { bytesBase64Encoded: stillImageBase64, mimeType },
        },
      ],
      parameters: { aspectRatio: "9:16" },
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Video request failed (${startRes.status}).`);
  }

  const { name: operationName } = await startRes.json();
  if (!operationName) throw new Error("Video provider returned no operation.");

  const deadline = Date.now() + MAX_POLL_MS;
  let statusPayload;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(`${GEMINI_BASE}/${operationName}`, {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    });
    if (!statusRes.ok) continue;
    statusPayload = await statusRes.json();
    if (statusPayload.done) break;
  }

  if (!statusPayload?.done) {
    throw new Error("Video is taking longer than expected — please try again in a moment.");
  }
  if (statusPayload.error) {
    throw new Error(statusPayload.error.message || "Video generation failed.");
  }

  const videoUri =
    statusPayload?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Video provider returned no video.");

  // The URI needs the API key to fetch and isn't meant to be exposed to the
  // browser directly, so we download it server-side and hand the customer a
  // self-contained data URL instead — mirrors how the image endpoint works.
  // For real production traffic, swap this for an upload to blob storage
  // (S3/Cloud Storage) and return that public URL instead, since embedding
  // video as base64 in the DB doesn't scale as well as images do.
  const videoRes = await fetch(videoUri, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
  });
  if (!videoRes.ok) throw new Error("Could not download the generated video.");
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const outMimeType = (videoRes.headers.get("content-type") || "video/mp4").split(";")[0];

  return { videoUrl: `data:${outMimeType};base64,${buffer.toString("base64")}` };
}
