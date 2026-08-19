import prisma from "../db.server";
import { requireFeature, FeatureNotAvailableError } from "../services/plan.server";
import { generateTryOnVideo, VideoProviderNotConfiguredError } from "../services/video.server";
import { saveGeneration } from "../services/generation.server";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function loader({ request }) {
  return new Response(null, { headers: corsHeaders(request) });
}

export async function action({ request }) {
  const cors = corsHeaders(request);
  const json = (data, init = {}) =>
    Response.json(data, { ...init, headers: { ...cors, ...(init.headers || {}) } });

  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const {
    shop,
    productId,
    category = "outfit",
    stillImageDataUrl, // the try-on result the customer already generated
    productTitle,
    shopifyCustomerId,
    anonymousId,
  } = body;

  if (!shop) return json({ error: "MISSING_SHOP" }, { status: 400 });
  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  if (!anonymousId) return json({ error: "MISSING_ANONYMOUS_ID" }, { status: 400 });
  if (!stillImageDataUrl) return json({ error: "MISSING_STILL_IMAGE" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  try {
    await requireFeature(store, "video_tryon");
  } catch (err) {
    if (err instanceof FeatureNotAvailableError) {
      return json({ error: "UPGRADE_REQUIRED", feature: err.feature, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const match = stillImageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return json({ error: "INVALID_STILL_IMAGE" }, { status: 400 });
  const [, mimeType, base64] = match;

  const gid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;

  try {
    const { videoUrl } = await generateTryOnVideo({
      stillImageBase64: base64,
      mimeType,
      productTitle: productTitle || "this product",
    });

    await saveGeneration({
      store,
      productId: gid,
      category,
      angle: "video",
      mediaType: "video",
      imageUrl: videoUrl,
      shopifyCustomerId,
      anonymousId,
    });

    return json({ videoUrl });
  } catch (error) {
    if (error instanceof VideoProviderNotConfiguredError) {
      return json({ error: "VIDEO_NOT_CONFIGURED", message: error.message }, { status: 501 });
    }
    return json(
      { error: "VIDEO_GENERATION_FAILED", message: error.message || "Could not generate the video." },
      { status: 500 },
    );
  }
}
