import prisma from "../db.server";

export async function saveGeneration({
  store,
  productId,
  companionProductIds = [],
  category,
  angle,
  mediaType = "image",
  imageUrl,
  shopifyCustomerId,
  anonymousId,
}) {
  return prisma.generation.create({
    data: {
      storeId: store.id,
      productId,
      companionProductIds,
      category,
      angle,
      mediaType,
      imageUrl,
      shopifyCustomerId: shopifyCustomerId || null,
      anonymousId,
      planKeyAtGeneration: store.planKey,
    },
  });
}

// Past generations for this shopper on this product — used to populate the
// widget's "you tried this on before" state and the regenerate shortcut.
export async function getGenerationsForShopperOnProduct({
  store,
  productId,
  shopifyCustomerId,
  anonymousId,
  limit = 12,
}) {
  return prisma.generation.findMany({
    where: {
      storeId: store.id,
      productId,
      OR: [
        shopifyCustomerId ? { shopifyCustomerId } : undefined,
        { anonymousId },
      ].filter(Boolean),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// Full closet across every product this shopper has tried on in this store —
// used for the "save & compare" drawer.
export async function getClosetForShopper({
  store,
  shopifyCustomerId,
  anonymousId,
  limit = 40,
}) {
  return prisma.generation.findMany({
    where: {
      storeId: store.id,
      OR: [
        shopifyCustomerId ? { shopifyCustomerId } : undefined,
        { anonymousId },
      ].filter(Boolean),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
