// Category config drives three things per category:
//  - which body region the customer's photo needs to show (surfaced in the widget UI)
//  - the angle set offered (jewelry/handbag don't need a 6-view spin, footwear does)
//  - the anchor instruction telling the model exactly where to place the product
export const CATEGORY_CONFIG = {
  outfit: {
    label: "Outfit",
    photoHint: "Head to at least the waist visible, arms not crossed over the body.",
    photoBad: "Cropped shoulders only, heavy filters, sitting/angled poses.",
    angles: ["front", "side", "back", "three_quarter_left", "three_quarter_right", "back_side"],
    defaultAngles: ["front", "side", "back"],
    anchorLine: (angle) => ({
      front: "Generate a front-facing try-on result. The person should face the camera.",
      side: "Generate a full side-profile try-on result.",
      back: "Generate a back-facing try-on result, showing the back print and collar.",
      three_quarter_left: "Generate a three-quarter view turned slightly to the left.",
      three_quarter_right: "Generate a three-quarter view turned slightly to the right.",
      back_side: "Generate a rear three-quarter view.",
    }[angle] || "Generate a front-facing try-on result."),
    placement:
      "Replace only the garment being worn. Keep the original background, pose, and lighting where possible.",
  },
  footwear: {
    label: "Footwear",
    photoHint: "Both feet visible, standing, floor/ground in frame, good light.",
    photoBad: "Feet cropped out, shoes already partly hidden, seated close-ups.",
    angles: ["front", "side", "three_quarter_left", "three_quarter_right"],
    defaultAngles: ["front", "side"],
    anchorLine: (angle) => ({
      front: "Generate a front-facing view of the feet wearing the shoes.",
      side: "Generate a side-profile view of the feet wearing the shoes.",
      three_quarter_left: "Generate a three-quarter view of the feet turned slightly left.",
      three_quarter_right: "Generate a three-quarter view of the feet turned slightly right.",
    }[angle] || "Generate a front-facing view of the feet wearing the shoes."),
    placement:
      "Replace only the footwear on both feet with the exact shoe shown in the product image — preserve its color, material, sole, and laces/straps. Keep the person's legs, pose, and the floor/background unchanged.",
  },
  handbag: {
    label: "Handbag",
    photoHint: "Upper body or full body visible, at least one hand/arm visible.",
    photoBad: "Hands out of frame, extreme close-ups.",
    angles: ["front", "side"],
    defaultAngles: ["front", "side"],
    anchorLine: (angle) =>
      angle === "side"
        ? "Generate a side view showing the bag carried naturally (hand or shoulder)."
        : "Generate a front-facing view showing the bag carried naturally (hand or shoulder).",
    placement:
      "Place the exact bag from the product image in the person's hand or on their shoulder, whichever looks more natural for the bag's strap style. Preserve the person's outfit, pose, and background — do not alter their clothing.",
  },
  jewelry_necklace: {
    label: "Necklace",
    photoHint: "Face, neck, and upper chest clearly visible, hair pulled back if possible.",
    photoBad: "Neckline out of frame, scarves/collars covering the neck.",
    angles: ["front", "side"],
    defaultAngles: ["front"],
    anchorLine: () => "Generate a close, front-facing view centered on the neckline.",
    placement:
      "Place the exact necklace from the product image around the person's neck, resting naturally against their skin/clothing at the correct length. Preserve the person's face, skin tone, hair, and outfit exactly. Do not alter anything except adding the necklace.",
  },
  jewelry_ear: {
    label: "Earrings",
    photoHint: "Face and ears clearly visible, hair tucked behind the ears if possible.",
    photoBad: "Ears covered by hair, side of face turned away, sunglasses/hats.",
    angles: ["front", "side"],
    defaultAngles: ["front"],
    anchorLine: () => "Generate a close-up view of the face centered on the ear(s).",
    placement:
      "Place the exact earrings from the product image on the person's ear(s), matching natural scale and hang. Preserve the person's face, skin tone, and hair exactly. Do not alter anything except adding the earrings.",
  },
  jewelry_hand: {
    label: "Ring / Bracelet",
    photoHint: "One hand clearly visible, fingers or wrist unobstructed, good light.",
    photoBad: "Hand out of frame, fist clenched, gloves.",
    angles: ["front"],
    defaultAngles: ["front"],
    anchorLine: () => "Generate a close-up view of the hand.",
    placement:
      "Place the exact ring or bracelet from the product image on the person's hand/wrist, matching natural scale and position. Preserve the person's skin tone and hand pose exactly. Do not alter anything except adding the item.",
  },
};

export function getCategoryConfig(category) {
  return CATEGORY_CONFIG[category] || CATEGORY_CONFIG.outfit;
}

// Builds the Gemini prompt for a single-item generation.
export function buildTryOnPrompt({ category, angle, productTitle }) {
  const config = getCategoryConfig(category);
  return `Create a realistic fashion try-on image for the product "${productTitle}".

Use image 1 as the customer/person reference.
Use image 2 as the product reference.

${config.placement}
${config.anchorLine(angle)}
Do not add unrelated text or logos. Do not make the person nude or sexualized.
Return one vertical try-on image.`;
}

// Builds the prompt for a "full outfit" generation combining several garments
// (e.g. top + bottom, or outfit + handbag) in a single pass. `items` is an
// array of { title, category } in the order their reference images are sent.
export function buildFullOutfitPrompt({ items, angle }) {
  const itemLines = items
    .map((item, i) => {
      const config = getCategoryConfig(item.category);
      return `Image ${i + 2} — "${item.title}" (${config.label}): ${config.placement}`;
    })
    .join("\n");

  const angleLine = getCategoryConfig("outfit").anchorLine(angle);

  return `Create a realistic fashion try-on image combining multiple products on the same person.

Use image 1 as the customer/person reference.
${itemLines}

Apply all items together on the same person in a single, coherent look. Preserve the person's face, skin tone, body shape, hair, and pose. Keep the original background and lighting where possible.
${angleLine}
Do not add unrelated text or logos. Do not make the person nude or sexualized.
Return one vertical image showing the full combined look.`;
}
