import prisma from "../db.server";

const TRIAL_DAYS = 5;
const TRIAL_GENERATION_LIMIT = 20;

export async function onStoreInstalled(session, admin) {
  const existing = await prisma.store.findUnique({
    where: { shop: session.shop },
  });
  if (existing) {
    // Reinstall: clear the uninstalled flag, don't reset their trial/plan history.
    await prisma.store.update({
      where: { shop: session.shop },
      data: { uninstalledAt: null },
    });
    return;
  }

  let ownerEmail = null;
  try {
    const res = await admin.graphql(`#graphql
      query ShopEmail {
        shop { email contactEmail }
      }`);
    const { data } = await res.json();
    ownerEmail = data?.shop?.email || data?.shop?.contactEmail || null;
  } catch {
    // Leave null — merchant will be prompted to enter it manually in Settings.
  }

  const now = new Date();
  const trialEndsAt = new Date(
    now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.store.create({
    data: {
      shop: session.shop,
      ownerEmail,
      planKey: "trial",
      subscriptionStatus: "trial",
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      generationsUsed: 0,
      generationLimit: TRIAL_GENERATION_LIMIT,
    },
  });
}

export async function markUninstalled(shop) {
  await prisma.store.updateMany({
    where: { shop },
    data: { uninstalledAt: new Date() },
  });
}
