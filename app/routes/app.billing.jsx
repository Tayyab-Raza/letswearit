import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  const daysLeftInTrial = store.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(store.trialEndsAt) - new Date()) / 86400000),
      )
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Billing</h1>

      {store.subscriptionStatus === "trial" && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Free trial — {daysLeftInTrial} day{daysLeftInTrial === 1 ? "" : "s"}{" "}
          left, {store.generationsUsed}/{store.generationLimit} try-ons used.
        </div>
      )}

      {fetcher.data?.error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetcher.data.error}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = store.planKey === plan.key;
          return (
            <div
              key={plan.key}
              className={`rounded-2xl border p-6 shadow-sm ${
                isCurrent
                  ? "border-neutral-900 ring-1 ring-neutral-900"
                  : "border-neutral-200"
              }`}
            >
              <h2 className="text-lg font-semibold text-neutral-900">
                {plan.name}
              </h2>
              <p className="mt-2 text-3xl font-bold text-neutral-900">
                ${plan.monthlyPrice}
                <span className="text-sm font-normal text-neutral-500">
                  /mo
                </span>
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                {plan.generationLimit} try-on generations / month
              </p>
              <button
                onClick={() => handleSelect(plan.key)}
                disabled={isCurrent || fetcher.state !== "idle"}
                className={`mt-6 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                  isCurrent
                    ? "cursor-default bg-neutral-100 text-neutral-400"
                    : "bg-neutral-900 text-white hover:bg-neutral-800"
                }`}
              >
                {isCurrent ? "Current plan" : "Choose plan"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
