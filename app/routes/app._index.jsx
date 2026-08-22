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
    <div className="lwi-stat">
      <div className="lwi-stat-label">{label}</div>
      <div className="lwi-stat-value">{value}</div>
      {sub && <div className="lwi-stat-sub">{sub}</div>}
    </div>
  );
}

function StepCard({ number, title, children }) {
  return (
    <div className="lwi-step">
      <div className="lwi-step-number">{number}</div>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

function FeatureCard({ feature, active, plan }) {
  return (
    <div className="lwi-card lwi-feature">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-sm font-semibold text-neutral-900">{feature.label}</p>
        <span className={`lwi-badge ${active ? "lwi-badge--active" : "lwi-badge--plan"}`}>
          {active ? "Active" : plan ? `Included in ${plan.name}` : "Higher plan"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500">{feature.description}</p>
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
    <main className="lwi-page">
      <section className="lwi-hero">
        <div>
          <p className="lwi-kicker">LetsWearIt AI</p>
          <h1 className="lwi-title">Turn browsing into trying.</h1>
          <p className="lwi-subtitle">
            Give shoppers a premium virtual try-on experience directly on your
            product pages. Upload product references once and LetsWearIt handles
            the AI preview for you.
          </p>
        </div>
        {store?.subscriptionStatus === "trial" && daysLeftInTrial !== null && (
          <span className="lwi-trial-pill">
            <i>✦</i> Free trial · {daysLeftInTrial} day{daysLeftInTrial === 1 ? "" : "s"} left
          </span>
        )}
      </section>

      {store && (
        <div className="lwi-grid-3">
          <StatCard
            label="Current plan"
            value={store.planKey === "trial" ? "Free trial" : store.planKey}
          />
          <StatCard
            label="Generations"
            value={`${store.generationsUsed} / ${store.generationLimit}`}
            sub="Current billing period"
          />
          <StatCard label="Store status" value={store.subscriptionStatus} />
        </div>
      )}

      <section className="mt-10">
        <div className="mb-4">
          <p className="lwi-kicker">Setup</p>
          <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-900">Get your first product live</h2>
        </div>
        <div className="grid gap-3">
          <StepCard number="01" title="Add reference photos">
            Open <a href="/app/products">Products</a> and upload front, back and
            side reference photos. These become the visual anchors for your AI
            generations.
          </StepCard>
          <StepCard number="02" title="Set the product profile">
            Confirm the category and add a size chart when relevant. LetsWearIt
            uses these details to tailor prompts and fit guidance.
          </StepCard>
          <StepCard number="03" title="Enable the storefront widget">
            Turn on the LetsWearIt app embed in Theme Editor. The floating
            <strong className="ml-1">Try It On</strong> button will appear on
            eligible product pages.
          </StepCard>
          <StepCard number="04" title="Let shoppers create their look">
            Customers upload a photo, generate their look, explore angles and
            use the features included with their plan.
          </StepCard>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <p className="lwi-kicker">Capabilities</p>
          <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-900">Everything your storefront can offer</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {store?.subscriptionStatus === "trial"
              ? "Your active trial includes every feature so you can experience the complete customer journey."
              : "See what is active now and what a higher plan unlocks."}
          </p>
        </div>
        <div className="lwi-grid-2">
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.key}
              feature={feature}
              active={storeFeatures.includes(feature.key)}
              plan={planForFeature[feature.key]}
            />
          ))}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap gap-2">
        <a href="/app/products" className="lwi-btn-primary">Configure products →</a>
        <a href="/app/billing" className="lwi-btn-secondary">View plans</a>
      </div>
    </main>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
