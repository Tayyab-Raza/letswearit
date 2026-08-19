import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import {
  requireFeature,
  FeatureNotAvailableError,
} from "../services/plan.server";
import {
  generateTryOnVideo,
  VideoProviderNotConfiguredError,
} from "../services/video.server";
import { saveGeneration } from "../services/generation.server";
import {
  checkAndReserveGeneration,
  recordGeneration,
  UsageLimitError,
} from "../services/usage.server";

export async function loader() {
  return new Response(null, { status: 405 });
}

export async function action({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  if (request.method !== "POST")
    return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });

  const { shop, loggedInCustomerId } = await authenticateProxy(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const {
    productId,
    category = "outfit",
    stillImageDataUrl, // the try-on result the customer already generated
    productTitle,
    anonymousId,
  } = body;

  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  if (!anonymousId)
    return json({ error: "MISSING_ANONYMOUS_ID" }, { status: 400 });
  if (!stillImageDataUrl)
    return json({ error: "MISSING_STILL_IMAGE" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  try {
    await requireFeature(store, "video_tryon");
  } catch (err) {
    if (err instanceof FeatureNotAvailableError) {
      return json(
        {
          error: "UPGRADE_REQUIRED",
          feature: err.feature,
          message: err.message,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  // Video try-ons run on Veo, which is billed per second and meaningfully
  // more expensive than an image generation — this must count against the
  // store's plan the same way image try-ons do.
  try {
    await checkAndReserveGeneration(shop);
  } catch (err) {
    if (err instanceof UsageLimitError) {
      return json(
        { error: "LIMIT_REACHED", message: err.message },
        { status: 402 },
      );
    }
    return json(
      { error: "USAGE_CHECK_FAILED", message: err.message },
      { status: 500 },
    );
  }

  const match = stillImageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return json({ error: "INVALID_STILL_IMAGE" }, { status: 400 });
  const [, mimeType, base64] = match;

  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const { videoUrl } = await generateTryOnVideo({
      stillImageBase64: base64,
      mimeType,
      productTitle: productTitle || "this product",
    });

    // Only counts against the plan, and only gets saved to history, on a
    // confirmed success — mirrors the image generation route.
    await recordGeneration(shop, { productId: gid, angle: "video" });
    await saveGeneration({
      store,
      productId: gid,
      category,
      angle: "video",
      mediaType: "video",
      imageUrl: videoUrl,
      shopifyCustomerId: loggedInCustomerId,
      anonymousId,
    });

    return json({ videoUrl });
  } catch (error) {
    if (error instanceof VideoProviderNotConfiguredError) {
      return json(
        { error: "VIDEO_NOT_CONFIGURED", message: error.message },
        { status: 501 },
      );
    }
    return json(
      {
        error: "VIDEO_GENERATION_FAILED",
        message: error.message || "Could not generate the video.",
      },
      { status: 500 },
    );
  }
}
