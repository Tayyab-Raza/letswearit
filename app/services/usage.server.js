import prisma from "../db.server";
import { sendUsageWarningEmail, sendLimitReachedEmail } from "./email.server";

export class UsageLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageLimitError";
  }
}

export async function checkAndReserveGeneration(shop) {
  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) throw new UsageLimitError("Store not found.");

  if (
    store.subscriptionStatus === "trial" &&
    store.trialEndsAt &&
    store.trialEndsAt < new Date()
  ) {
    throw new UsageLimitError(
      "Your free trial has ended. Choose a plan to keep generating try-ons.",
    );
  }
  if (
    store.subscriptionStatus === "cancelled" ||
    store.subscriptionStatus === "expired"
  ) {
    throw new UsageLimitError(
      "Your subscription is inactive. Choose a plan to keep generating try-ons.",
    );
  }
  if (store.generationsUsed >= store.generationLimit) {
    throw new UsageLimitError(
      "You've reached your plan's generation limit for this period.",
    );
  }

  return store;
}

export async function recordGeneration(shop, { productId, angle }) {
  const store = await prisma.store.update({
    where: { shop },
    data: {
      generationsUsed: { increment: 1 },
      usageLogs: { create: { productId, angle } },
    },
  });

  const usageRatio = store.generationsUsed / store.generationLimit;

  if (usageRatio >= 1 && !store.limitEmailSentAt) {
    await sendLimitReachedEmail(store);
    await prisma.store.update({
      where: { shop },
      data: { limitEmailSentAt: new Date() },
    });
  } else if (usageRatio >= 0.8 && !store.warningEmailSentAt) {
    await sendUsageWarningEmail(store);
    await prisma.store.update({
      where: { shop },
      data: { warningEmailSentAt: new Date() },
    });
  }

  return store;
}

// Called from the app_subscriptions/update webhook on renewal.
export async function resetUsageForNewPeriod(
  shop,
  { planKey, generationLimit, periodEnd },
) {
  await prisma.store.update({
    where: { shop },
    data: {
      planKey,
      generationLimit,
      generationsUsed: 0,
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      warningEmailSentAt: null,
      limitEmailSentAt: null,
      subscriptionStatus: "active",
    },
  });
}
