import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resetUsageForNewPeriod } from "../services/usage.server";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  const subscription = payload.app_subscription;

  if (subscription.status === "ACTIVE") {
    const plan = await prisma.plan.findFirst({
      where: { shopifyPlanHandle: subscription.name },
    });
    if (plan) {
      await resetUsageForNewPeriod(shop, {
        planKey: plan.key,
        generationLimit: plan.generationLimit,
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }
  } else if (["CANCELLED", "EXPIRED", "FROZEN"].includes(subscription.status)) {
    await prisma.store.update({
      where: { shop },
      data: { subscriptionStatus: "cancelled" },
    });
  }

  return new Response();
};
