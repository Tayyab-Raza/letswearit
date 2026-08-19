import { Buffer } from "node:buffer";
import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import {
  checkAndReserveGeneration,
  recordGeneration,
  UsageLimitError,
} from "../services/usage.server";
import {
  requireFeature,
  FeatureNotAvailableError,
} from "../services/plan.server";
import { classifyProduct } from "../services/category.server";
import {
  buildTryOnPrompt,
  buildFullOutfitPrompt,
  getCategoryConfig,
} from "../services/tryon-prompts.server";
import { saveGeneration } from "../services/generation.server";
import {
  GEMINI_IMAGE_MODEL,
  callGeminiInteraction,
  extractInteractionImageBase64,
  GeminiRequestError,
} from "../services/gemini.server";

const ANGLE_METAFIELD_KEY = {
  front: "front_image",
  back: "back_image",
  side: "side_image",
};

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL.");
  return { mimeType: match[1], base64: match[2] };
}

async function remoteImageToInline(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "image/jpeg").split(
    ";",
  )[0];
  return { mimeType: contentType, base64: buffer.toString("base64") };
}

// Fetches the product's title/type/tags (for category classification) plus a
// reference image. Apparel keeps using the merchant-uploaded per-angle
// metafields; every other category uses the product's featured image, since
// a single reference photo is enough for the model to anchor a shoe, bag, or
// jewelry piece regardless of which angle we're asking it to render.
async function fetchProductForTryOn(admin, productGid, category, angleKey) {
  const response = await admin.graphql(
    `#graphql
    query TryOnProduct($id: ID!) {
      product(id: $id) {
        title
        productType
        tags
        featuredImage { url }
        angleImage: metafield(namespace: "tryon", key: "${angleKey}") {
          reference { ... on MediaImage { image { url } } }
        }
      }
    }`,
    { variables: { id: productGid } },
  );

  const { data } = await response.json();
  const product = data?.product;
  const angleImageUrl = product?.angleImage?.reference?.image?.url;
  const imageUrl =
    category === "outfit" && angleImageUrl
      ? angleImageUrl
      : product?.featuredImage?.url || angleImageUrl;

  return {
    title: product?.title,
    productType: product?.productType,
    tags: product?.tags,
    imageUrl,
  };
}

export async function loader() {
  return new Response(null, { status: 405 });
}

export async function action({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  // Verifies this request was actually proxied by Shopify for a real,
  // installed shop — see app-proxy.server.js for why we don't trust a
  // client-supplied `shop` here.
  const { shop, admin, loggedInCustomerId } = await authenticateProxy(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const {
    productId,
    companionProductIds = [], // set for a "full outfit" generation
    angle = "front",
    imageDataUrl,
    sampleImageUrl,
    anonymousId,
  } = body;

  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  if (!anonymousId)
    return json({ error: "MISSING_ANONYMOUS_ID" }, { status: 400 });
  if (!imageDataUrl && !sampleImageUrl) {
    return json(
      { error: "MISSING_IMAGE", message: "Upload a clear photo." },
      { status: 400 },
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    return json(
      {
        error: "MISSING_GEMINI_API_KEY",
        message: "GEMINI_API_KEY is not set on the server.",
      },
      { status: 500 },
    );
  }

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

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

  const isFullOutfit = companionProductIds.length > 0;
  if (isFullOutfit) {
    try {
      await requireFeature(store, "full_outfit");
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
  }

  const gid = (id) =>
    id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  const mainGid = gid(productId);

  try {
    // Classify the main product's category first — every downstream step
    // (which reference image to use, which prompt, whether the angle needs
    // a paid feature) depends on it.
    const previewProduct = await fetchProductForTryOn(
      admin,
      mainGid,
      "outfit",
      ANGLE_METAFIELD_KEY.front,
    );
    const profile = await classifyProduct(store, {
      productGid: mainGid,
      productType: previewProduct.productType,
      tags: previewProduct.tags,
      title: previewProduct.title,
      imageUrl: previewProduct.imageUrl,
    });
    const category = profile.category;
    const config = getCategoryConfig(category);

    // Gate the angle: anything beyond the category's default (free-tier)
    // angle set requires the multi-angle spin feature.
    if (!config.defaultAngles.includes(angle)) {
      try {
        await requireFeature(store, "multi_angle_spin");
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
    }
    if (!config.angles.includes(angle)) {
      return json({ error: "INVALID_ANGLE" }, { status: 400 });
    }

    const angleKey = ANGLE_METAFIELD_KEY[angle] || ANGLE_METAFIELD_KEY.front;
    const { title, imageUrl: productImageUrl } = await fetchProductForTryOn(
      admin,
      mainGid,
      category,
      angleKey,
    );
    if (!productImageUrl) {
      return json({ error: "NO_PRODUCT_IMAGE" }, { status: 422 });
    }

    const personImagePromise = imageDataUrl
      ? Promise.resolve(parseDataUrl(imageDataUrl))
      : remoteImageToInline(sampleImageUrl);

    let prompt;
    let referenceImages;

    if (isFullOutfit) {
      const companions = await Promise.all(
        companionProductIds.map(async (id) => {
          const companionGid = gid(id);
          const companionPreview = await fetchProductForTryOn(
            admin,
            companionGid,
            "outfit",
            ANGLE_METAFIELD_KEY.front,
          );
          const companionProfile = await classifyProduct(store, {
            productGid: companionGid,
            productType: companionPreview.productType,
            tags: companionPreview.tags,
            title: companionPreview.title,
            imageUrl: companionPreview.imageUrl,
          });
          const companionAngleKey =
            ANGLE_METAFIELD_KEY[angle] || ANGLE_METAFIELD_KEY.front;
          const companionData = await fetchProductForTryOn(
            admin,
            companionGid,
            companionProfile.category,
            companionAngleKey,
          );
          return {
            title: companionData.title,
            category: companionProfile.category,
            imageUrl: companionData.imageUrl,
          };
        }),
      );
      const validCompanions = companions.filter((c) => c.imageUrl);

      const items = [{ title, category }, ...validCompanions];
      prompt = buildFullOutfitPrompt({ items, angle });

      const [personImage, ...itemImages] = await Promise.all([
        personImagePromise,
        remoteImageToInline(productImageUrl),
        ...validCompanions.map((c) => remoteImageToInline(c.imageUrl)),
      ]);
      referenceImages = [personImage, ...itemImages];
    } else {
      prompt = buildTryOnPrompt({ category, angle, productTitle: title });
      const [personImage, productImage] = await Promise.all([
        personImagePromise,
        remoteImageToInline(productImageUrl),
      ]);
      referenceImages = [personImage, productImage];
    }

    let payload;
    try {
      payload = await callGeminiInteraction({
        model: GEMINI_IMAGE_MODEL,
        input: [
          { type: "text", text: prompt },
          ...referenceImages.map((img) => ({
            type: "image",
            mime_type: img.mimeType,
            data: img.base64,
          })),
        ],
        responseFormat: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: "3:4",
          image_size: "512",
        },
      });
    } catch (err) {
      const status = err instanceof GeminiRequestError ? err.status : 502;
      return json(
        { error: "GEMINI_REQUEST_FAILED", message: err.message },
        { status },
      );
    }

    const imageBase64 = extractInteractionImageBase64(payload);
    if (!imageBase64) {
      return json({ error: "NO_IMAGE_RETURNED" }, { status: 502 });
    }

    const resultImageUrl = `data:image/jpeg;base64,${imageBase64}`;

    // Only counts against the plan, and only gets saved to history, on a
    // confirmed success. We store the OUTPUT only — never the customer's
    // uploaded source photo.
    await recordGeneration(shop, { productId: mainGid, angle });
    await saveGeneration({
      store,
      productId: mainGid,
      companionProductIds: isFullOutfit ? companionProductIds.map(gid) : [],
      category,
      angle,
      imageUrl: resultImageUrl,
      shopifyCustomerId: loggedInCustomerId,
      anonymousId,
    });

    return json({ angle, category, imageUrl: resultImageUrl });
  } catch (error) {
    return json(
      {
        error: "GENERATION_FAILED",
        message: error.message || "Could not generate this try-on.",
      },
      { status: 500 },
    );
  }
}
