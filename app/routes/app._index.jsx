import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStoreFeatures } from "../services/plan.server";

// Static copy for every feature — kept here (not imported from a .server
// file) since the component below reads it directly. Which plan unlocks
// each one is computed in the loader from the DB, not hardcoded, so this
// stays correct if plan contents change.
const FEATURES = [
  {
    key: "tryon",
    label: "AI try-on",
    description:
      "Customers upload a photo and see themselves wearing the product — front, side, and back — generated in a few seconds.",
  },
  {
    key: "size_fit",
    label: "Size & fit suggestions",
    description:
      'A "Get a size suggestion" button estimates their size from the same photo. Add a size chart per product for accurate results instead of a generic band.',
  },
  {
    key: "multi_angle_spin",
    label: "Multi-angle spin view",
    description:
      "Customers drag to spin through extra angles (three-quarter views, back) beyond the default front/side/back set.",
  },
  {
    key: "full_outfit",
    label: "Full outfit try-on",
    description:
      "Combine several products — a top with a bottom, or an outfit with a bag — into one generated look. Configure companion products per block in the Theme Editor.",
  },
  {
    key: "closet",
    label: "Closet & compare",
    description:
      "Shoppers can revisit past try-ons and compare two side by side from a drawer on the storefront.",
  },
  {
    key: "video_tryon",
    label: "Video try-on",
    description:
      "Turns a generated still into a short turning video, so customers see the product in motion.",
  },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [store, plans] = await Promise.all([
    prisma.store.findUnique({ where: { shop: session.shop } }),
    prisma.plan.findMany({ orderBy: { monthlyPrice: "asc" } }),
  ]);

  const storeFeatures = store ? await getStoreFeatures(store) : [];

  // For each feature, the cheapest plan (in ascending price order) that
  // includes it — this is what actually gates it going forward, once the
  // trial (which includes everything) ends.
  const planForFeature = {};
  for (const feature of FEATURES) {
    const plan = plans.find((p) => (p.features || []).includes(feature.key));
    planForFeature[feature.key] = plan
      ? { key: plan.key, name: plan.name }
      : null;
  }

  return { store, storeFeatures, planForFeature };
};

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

function StepCard({ number, title, children }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
        {number}
      </div>
      <div>
        <p className="font-semibold text-neutral-900">{title}</p>
        <p className="mt-1 text-sm text-neutral-500">{children}</p>
      </div>
    </div>
  );
}

function FeatureCard({ feature, active, plan }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-neutral-900">{feature.label}</p>
        {active ? (
          <span className="flex-none rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
            Active on your plan
          </span>
        ) : (
          <span className="flex-none rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
            {plan ? `Included in ${plan.name}` : "Higher plan"}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-neutral-500">{feature.description}</p>
    </div>
  );
}

export default function Index() {
  const { store, storeFeatures, planForFeature } = useLoaderData();

  const daysLeftInTrial = store?.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(store.trialEndsAt) - new Date()) / 86400000),
      )
    : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-400">LetsWearIt</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
            AI Try-On
          </h1>
        </div>
        {store?.subscriptionStatus === "trial" && daysLeftInTrial !== null && (
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
            {daysLeftInTrial} day{daysLeftInTrial === 1 ? "" : "s"} left in
            trial
          </span>
        )}
      </div>

      <p className="mt-3 max-w-2xl text-sm text-neutral-500">
        Let customers see how a product looks on them before they buy. Upload
        reference photos for a product and a floating{" "}
        <span className="font-medium text-neutral-700">Try It On</span> button
        appears on that product's storefront page automatically.
      </p>

      {store && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Plan"
            value={store.planKey === "trial" ? "Free trial" : store.planKey}
          />
          <StatCard
            label="Generations used"
            value={`${store.generationsUsed} / ${store.generationLimit}`}
            sub="resets each billing period"
          />
          <StatCard label="Status" value={store.subscriptionStatus} />
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold text-neutral-900">
        How it works
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4">
        <StepCard number={1} title="Add reference photos">
          Go to{" "}
          <a href="/app/products" className="underline">
            Products
          </a>
          , open any product, and upload a front, back, and side photo. This
          writes each image to that product as a metafield — no theme editing
          required.
        </StepCard>
        <StepCard number={2} title="Set a category and size chart">
          Each product is auto-classified (outfit, footwear, handbag, or
          jewelry) the first time it's tried on — check or override it on the
          product page. Add a size chart there too, so size suggestions use the
          product's real sizing instead of a generic estimate.
        </StepCard>
        <StepCard number={3} title="Widget appears automatically">
          Any product with a front photo saved shows the "Try It On" button on
          its storefront page. Turn it on once under{" "}
          <span className="font-medium">Theme Editor → App embeds</span>.
        </StepCard>
        <StepCard number={4} title="Customer tries it on">
          They upload their own photo (or use a sample), tap Generate, and see
          themselves wearing the product. Depending on your plan, they can also
          get a size suggestion, spin through extra angles, add companion
          products for a full outfit, generate a short video, or revisit past
          try-ons from their closet.
        </StepCard>
        <StepCard number={5} title="Track usage and stay covered">
          Every generation counts against your plan's monthly limit. Check{" "}
          <a href="/app/billing" className="underline">
            Billing
          </a>{" "}
          anytime to see usage or change plans, and we'll email you
          automatically at 80% and 100% of your limit.
        </StepCard>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-neutral-900">
        Features & what's included
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-neutral-500">
        {store?.subscriptionStatus === "trial"
          ? "Your trial includes every feature below. Here's which plan keeps each one active once it ends."
          : "What's live on your current plan, and what a higher plan unlocks."}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <FeatureCard
            key={feature.key}
            feature={feature}
            active={storeFeatures.includes(feature.key)}
            plan={planForFeature[feature.key]}
          />
        ))}
      </div>

      <div className="mt-10 flex gap-3">
        <a
          href="/app/products"
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          Add your first product
        </a>
        <a
          href="/app/billing"
          className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          View plans
        </a>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
