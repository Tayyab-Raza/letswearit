import { Buffer } from "node:buffer";
import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import {
  requireFeature,
  FeatureNotAvailableError,
} from "../services/plan.server";
import { classifyProduct } from "../services/category.server";
import { estimateSizeFit } from "../services/sizefit.server";

async function remoteImageToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "image/jpeg").split(
    ";",
  )[0];
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function loader() {
  return new Response(null, { status: 405 });
}

export async function action({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  if (request.method !== "POST")
    return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });

  const { shop, admin } = await authenticateProxy(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { productId, imageDataUrl, sampleImageUrl } = body;
  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  // Widget sends whichever one the shopper actually used — sample photos
  // arrive as a URL, uploads arrive as a data URL. Previously only
  // imageDataUrl was accepted here, so "Use sample photo" -> "Get a size
  // suggestion" always failed with MISSING_IMAGE.
  if (!imageDataUrl && !sampleImageUrl) {
    return json({ error: "MISSING_IMAGE" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  try {
    await requireFeature(store, "size_fit");
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

  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const response = await admin.graphql(
      `#graphql
      query SizeFitProduct($id: ID!) {
        product(id: $id) {
          title
          productType
          tags
          featuredImage { url }
          sizeChart: metafield(namespace: "tryon", key: "size_chart") { value }
        }
      }`,
      { variables: { id: gid } },
    );
    const { data } = await response.json();
    const product = data?.product;

    const profile = await classifyProduct(store, {
      productGid: gid,
      productType: product?.productType,
      tags: product?.tags,
      title: product?.title,
      imageUrl: product?.featuredImage?.url,
    });

    const resolvedImageDataUrl =
      imageDataUrl || (await remoteImageToDataUrl(sampleImageUrl));

    const result = await estimateSizeFit({
      personImage: { dataUrl: resolvedImageDataUrl },
      category: profile.category,
      sizeChartJson: product?.sizeChart?.value || null,
      productTitle: product?.title,
    });

    return json(result);
  } catch (error) {
    return json(
      {
        error: "SIZE_FIT_FAILED",
        message: error.message || "Could not estimate size.",
      },
      { status: 500 },
    );
  }
}
