import prisma from "../db.server";

// During the trial we show everything so merchants can evaluate the higher-tier
// add-ons before choosing a plan. Once the trial ends, checkAndReserveGeneration
// (usage.server.js) already blocks generation entirely, so this only matters
// for the trial window itself.
const TRIAL_FEATURES = [
  "tryon",
  "size_fit",
  "multi_angle_spin",
  "full_outfit",
  "closet",
  "video_tryon",
];

export class FeatureNotAvailableError extends Error {
  constructor(feature) {
    super(`This feature requires a higher plan.`);
    this.name = "FeatureNotAvailableError";
    this.feature = feature;
  }
}

// Returns the feature list to check against for a given store.
export async function getStoreFeatures(store) {
  if (!store) return [];

  // Treat an unexpired trial as a trial even if a webhook or an older record
  // has temporarily stored a different subscriptionStatus. The storefront
  // and generation APIs must use the same source of truth.
  const trialIsActive =
    store.trialEndsAt &&
    new Date(store.trialEndsAt).getTime() > Date.now() &&
    (store.planKey === "trial" || store.subscriptionStatus === "trial");

  if (
    trialIsActive ||
    (store.subscriptionStatus === "trial" &&
      (!store.trialEndsAt ||
        new Date(store.trialEndsAt).getTime() > Date.now()))
  ) {
    return TRIAL_FEATURES;
  }

  const plan = await prisma.plan.findUnique({ where: { key: store.planKey } });
  return plan?.features || [];
}

export async function hasFeature(store, feature) {
  const features = await getStoreFeatures(store);
  return features.includes(feature);
}

// Throws FeatureNotAvailableError if the store's plan doesn't include `feature`.
export async function requireFeature(store, feature) {
  if (!(await hasFeature(store, feature))) {
    throw new FeatureNotAvailableError(feature);
  }
}
