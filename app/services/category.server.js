import { Buffer } from "node:buffer";
import prisma from "../db.server";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_TEXT_MODEL = "gemini-3.1-flash";

export const CATEGORIES = [
  "outfit",
  "footwear",
  "handbag",
  "jewelry_necklace",
  "jewelry_ear",
  "jewelry_hand", // rings / bracelets
];

// Cheap, deterministic first pass using the merchant's own product_type/tags.
// Most Shopify catalogs already have usable values here, so this resolves
// the large majority of products without ever calling a model.
const KEYWORD_RULES = [
  { category: "footwear", words: ["shoe", "shoes", "sneaker", "boot", "boots", "sandal", "heel", "heels", "footwear", "loafer", "trainer"] },
  { category: "handbag", words: ["bag", "handbag", "purse", "tote", "clutch", "backpack", "sling"] },
  { category: "jewelry_necklace", words: ["necklace", "pendant", "chain", "choker"] },
  { category: "jewelry_ear", words: ["earring", "earrings", "stud", "hoops"] },
  { category: "jewelry_hand", words: ["ring", "bracelet", "bangle", "cuff"] },
  { category: "outfit", words: ["shirt", "tshirt", "t-shirt", "top", "dress", "jeans", "pant", "trouser", "jacket", "coat", "kurta", "saree", "hoodie", "sweater", "skirt", "outfit", "apparel", "clothing"] },
];

const SUBCATEGORY_WORDS = {
  womens: ["women", "woman", "womens", "women's", "ladies", "female", "girls"],
  mens: ["men", "man", "mens", "men's", "male", "boys"],
};

function heuristicClassify({ productType, tags, title }) {
  const haystack = [productType, ...(tags || []), title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => haystack.includes(w))) {
      const subcategory = SUBCATEGORY_WORDS.womens.some((w) => haystack.includes(w))
        ? "womens"
        : SUBCATEGORY_WORDS.mens.some((w) => haystack.includes(w))
          ? "mens"
          : "unisex";
      return { category: rule.category, subcategory, source: "heuristic" };
    }
  }
  return null;
}

async function visionClassify(imageUrl, title) {
  if (!process.env.GEMINI_API_KEY) return null;

  const prompt = `You classify a fashion e-commerce product photo into exactly one category for a virtual try-on app.
Product title: "${title || "unknown"}"
Respond with ONLY a JSON object, no other text, in this exact shape:
{"category":"outfit|footwear|handbag|jewelry_necklace|jewelry_ear|jewelry_hand","subcategory":"womens|mens|unisex"}`;

  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const mimeType = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0];

    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: GEMINI_TEXT_MODEL,
        input: [
          { type: "text", text: prompt },
          { type: "image", mime_type: mimeType, data: buffer.toString("base64") },
        ],
      }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const text =
      payload?.output_text ||
      payload?.content?.[0]?.text ||
      JSON.stringify(payload);
    const match = text.match(/\{[^}]+\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!CATEGORIES.includes(parsed.category)) return null;
    return {
      category: parsed.category,
      subcategory: ["womens", "mens", "unisex"].includes(parsed.subcategory)
        ? parsed.subcategory
        : "unisex",
      source: "ai_vision",
    };
  } catch {
    return null;
  }
}

// Resolves + caches a product's try-on category. Pass the product's Shopify
// fields you already have on hand (productType/tags/title) plus a reference
// image URL to use as the AI-vision fallback when those fields are blank or
// don't match any keyword rule.
export async function classifyProduct(store, { productGid, productType, tags, title, imageUrl }) {
  const cached = await prisma.productProfile.findUnique({
    where: { storeId_productId: { storeId: store.id, productId: productGid } },
  });
  if (cached) return cached;

  let result = heuristicClassify({ productType, tags, title });
  if (!result && imageUrl) {
    result = await visionClassify(imageUrl, title);
  }
  if (!result) {
    // Safe default — apparel is the most common case and the current
    // torso-anchored prompt is a reasonable fallback if we truly can't tell.
    result = { category: "outfit", subcategory: "unisex", source: "heuristic" };
  }

  return prisma.productProfile.create({
    data: {
      storeId: store.id,
      productId: productGid,
      category: result.category,
      subcategory: result.subcategory,
      source: result.source,
    },
  });
}
