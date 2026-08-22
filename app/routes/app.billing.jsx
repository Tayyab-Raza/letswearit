import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const FEATURE_LABELS = {
  tryon: "AI try-on (photo results)",
  size_fit: "Size & fit suggestions",
  multi_angle_spin: "Multi-angle spin view",
  full_outfit: "Full outfit (multiple items at once)",
  closet: "Closet & compare",
  video_tryon: "Video try-on",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [store, plans] = await Promise.all([
    prisma.store.findUnique({ where: { shop: session.shop } }),
    prisma.plan.findMany({ orderBy: { monthlyPrice: "asc" } }),
  ]);
  return { store, plans };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planKey = formData.get("planKey");

  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan) return { error: "Unknown plan." };

  const store = await prisma.store.findUnique({
    where: { shop: session.shop },
  });
  const isFirstSubscription = !store?.subscriptionId;

  const response = await admin.graphql(
    `#graphql
    mutation CreateSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: ${process.env.NODE_ENV !== "production"}
      ) {
        appSubscription { id }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: plan.name,
        returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing`,
        trialDays: isFirstSubscription ? 5 : 0, // trial only applies once
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.monthlyPrice, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const { data } = await response.json();
  const errors = data?.appSubscriptionCreate?.userErrors;
  if (errors?.length) return { error: errors[0].message };

  return { redirectUrl: data.appSubscriptionCreate.confirmationUrl };
};

export default function Billing() {
  const { store, plans } = useLoaderData();
  const fetcher = useFetcher();

  const handleSelect = (planKey) => {
    fetcher.submit({ planKey }, { method: "POST" });
  };

  if (fetcher.data?.redirectUrl) {
    window.top.location.href = fetcher.data.redirectUrl;
  }

  const daysLeftInTrial = store?.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(store.trialEndsAt) - new Date()) / 86400000),
      )
    : 0;

  return (
    <main className="lwi-page">
      <section className="lwi-hero">
        <div>
          <p className="lwi-kicker">Plans & usage</p>
          <h1 className="lwi-title">Choose your level.</h1>
          <p className="lwi-subtitle">
            Start with the complete LetsWearIt experience, then choose the
            generation volume and features that fit your store.
          </p>
        </div>
        {store?.subscriptionStatus === "trial" && (
          <span className="lwi-trial-pill"><i>✦</i> {daysLeftInTrial} day{daysLeftInTrial === 1 ? "" : "s"} left</span>
        )}
      </section>

      {fetcher.data?.error && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {fetcher.data.error}
        </div>
      )}

      <div className="lwi-grid-3">
        {plans.map((plan, index) => {
          const isCurrent = store.planKey === plan.key;
          return (
            <article
              key={plan.key}
              className={`lwi-card flex flex-col ${isCurrent ? "ring-2 ring-[#7650db]" : ""}`}
            >
              {index === 1 && (
                <span className="mb-3 w-fit rounded-full bg-[#f3efff] px-2 py-1 text-[8px] font-extrabold uppercase tracking-[.12em] text-[#7146cb]">
                  Most popular
                </span>
              )}
              <h2 className="text-lg font-bold tracking-tight text-neutral-900">{plan.name}</h2>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-neutral-900">
                ${plan.monthlyPrice}
                <span className="text-xs font-medium text-neutral-400"> / month</span>
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                {plan.generationLimit} AI generations each billing period
              </p>

              <div className="my-5 h-px bg-neutral-100" />
              <ul className="flex-1 space-y-2">
                {(plan.features || []).map((key) => (
                  <li key={key} className="flex gap-2 text-[10px] leading-4 text-neutral-600">
                    <span className="font-bold text-[#7850d8]">✓</span>
                    {FEATURE_LABELS[key] || key}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSelect(plan.key)}
                disabled={isCurrent || fetcher.state !== "idle"}
                className={`mt-6 w-full rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
                  isCurrent
                    ? "cursor-default border border-neutral-200 bg-neutral-50 text-neutral-400"
                    : "bg-[#0d1423] text-white hover:bg-[#18233a]"
                }`}
              >
                {isCurrent ? "Current plan" : fetcher.state !== "idle" ? "Opening checkout…" : "Choose plan →"}
              </button>
            </article>
          );
        })}
      </div>
    </main>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
