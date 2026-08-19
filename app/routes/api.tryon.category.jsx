import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import { classifyProduct } from "../services/category.server";
import { getCategoryConfig } from "../services/tryon-prompts.server";

export async function loader({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  const { shop, admin } = await authenticateProxy(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return json({ error: "MISSING_PRODUCT" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const response = await admin.graphql(
      `#graphql
      query CategoryProduct($id: ID!) {
        product(id: $id) {
          title
          productType
          tags
          featuredImage { url }
        }
      }`,
      { variables: { id: gid } },
    );
    const { data } = await response.json();
    const p = data?.product;

    const profile = await classifyProduct(store, {
      productGid: gid,
      productType: p?.productType,
      tags: p?.tags,
      title: p?.title,
      imageUrl: p?.featuredImage?.url,
    });
    const config = getCategoryConfig(profile.category);

    return json({
      category: profile.category,
      subcategory: profile.subcategory,
      photoHint: config.photoHint,
      photoBad: config.photoBad,
      angles: config.angles,
      defaultAngles: config.defaultAngles,
    });
  } catch (error) {
    return json(
      { error: "CATEGORY_LOOKUP_FAILED", message: error.message },
      { status: 500 },
    );
  }
}
