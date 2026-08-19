import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import { hasFeature } from "../services/plan.server";
import {
  getGenerationsForShopperOnProduct,
  getClosetForShopper,
} from "../services/generation.server";

export async function loader({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  // Previously trusted a client-supplied `shopifyCustomerId` query param —
  // anyone could pass any customer's id and read back that customer's saved
  // try-on images. loggedInCustomerId below comes from Shopify's own signed
  // proxy params, so it can only ever be the real logged-in shopper (or
  // null, if they're not logged in — falls back to anonymousId scoping).
  const { shop, loggedInCustomerId } = await authenticateProxy(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const anonymousId = url.searchParams.get("anonymousId");
  const scope = url.searchParams.get("scope") || "product"; // "product" | "closet"

  if (!anonymousId)
    return json({ error: "MISSING_ANONYMOUS_ID" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  if (scope === "closet") {
    if (!(await hasFeature(store, "closet"))) {
      return json({ generations: [], featureAvailable: false });
    }
    const generations = await getClosetForShopper({
      store,
      shopifyCustomerId: loggedInCustomerId,
      anonymousId,
    });
    return json({ generations, featureAvailable: true });
  }

  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });
  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;
  const generations = await getGenerationsForShopperOnProduct({
    store,
    productId: gid,
    shopifyCustomerId: loggedInCustomerId,
    anonymousId,
  });
  return json({ generations, featureAvailable: true });
}
