import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { requireFeature, FeatureNotAvailableError } from "../services/plan.server";
import { classifyProduct } from "../services/category.server";
import { estimateSizeFit } from "../services/sizefit.server";

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

  const { shop, productId, imageDataUrl } = body;
  if (!shop) return json({ error: "MISSING_SHOP" }, { status: 400 });
  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  if (!imageDataUrl) return json({ error: "MISSING_IMAGE" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  try {
    await requireFeature(store, "size_fit");
  } catch (err) {
    if (err instanceof FeatureNotAvailableError) {
      return json({ error: "UPGRADE_REQUIRED", feature: err.feature, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const gid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  const { admin } = await unauthenticated.admin(shop);

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

    const result = await estimateSizeFit({
      personImage: { dataUrl: imageDataUrl },
      category: profile.category,
      sizeChartJson: product?.sizeChart?.value || null,
      productTitle: product?.title,
    });

    return json(result);
  } catch (error) {
    return json(
      { error: "SIZE_FIT_FAILED", message: error.message || "Could not estimate size." },
      { status: 500 },
    );
  }
}
