import prisma from "../db.server";
import { hasFeature } from "../services/plan.server";
import {
  getGenerationsForShopperOnProduct,
  getClosetForShopper,
} from "../services/generation.server";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function loader({ request }) {
  const cors = corsHeaders(request);
  const json = (data, init = {}) =>
    Response.json(data, { ...init, headers: { ...cors, ...(init.headers || {}) } });

  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");
  const shopifyCustomerId = url.searchParams.get("shopifyCustomerId") || undefined;
  const anonymousId = url.searchParams.get("anonymousId");
  const scope = url.searchParams.get("scope") || "product"; // "product" | "closet"

  if (!shop) return json({ error: "MISSING_SHOP" }, { status: 400 });
  if (!anonymousId) return json({ error: "MISSING_ANONYMOUS_ID" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  if (scope === "closet") {
    if (!(await hasFeature(store, "closet"))) {
      return json({ generations: [], featureAvailable: false });
    }
    const generations = await getClosetForShopper({ store, shopifyCustomerId, anonymousId });
    return json({ generations, featureAvailable: true });
  }

  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  const gid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  const generations = await getGenerationsForShopperOnProduct({
    store,
    productId: gid,
    shopifyCustomerId,
    anonymousId,
  });
  return json({ generations, featureAvailable: true });
}
