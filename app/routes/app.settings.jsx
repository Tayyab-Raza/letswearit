import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await prisma.store.findUnique({
    where: { shop: session.shop },
  });
  return { store };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const email = formData.get("manualNotifyEmail")?.toString().trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  await prisma.store.update({
    where: { shop: session.shop },
    data: { manualNotifyEmail: email },
  });

  return { success: true };
};

export default function Settings() {
  const { store } = useLoaderData();
  const fetcher = useFetcher();
  const notifyEmail = store.ownerEmail || store.manualNotifyEmail;

  return (
    <main className="lwi-page lwi-page--narrow">
      <section className="lwi-hero">
        <div>
          <p className="lwi-kicker">Workspace</p>
          <h1 className="lwi-title">Settings.</h1>
          <p className="lwi-subtitle">
            Keep your usage alerts and store preferences in one place.
          </p>
        </div>
      </section>

      <section className="lwi-card">
        <div className="flex items-start gap-3">
          <div className="lwi-step-number">✦</div>
          <div>
            <h2 className="lwi-card-title">Usage notifications</h2>
            <p className="lwi-card-copy">
              We'll email this address when your store is close to, or reaches,
              its monthly AI generation limit.
            </p>
          </div>
        </div>

        {store.ownerEmail ? (
          <div className="mt-5 rounded-xl border border-[#e4e7ee] bg-[#fafbfe] px-4 py-3 text-xs text-neutral-600">
            Currently sending to <strong>{store.ownerEmail}</strong>
            <span className="ml-1 text-neutral-400">(store contact)</span>
          </div>
        ) : (
          <fetcher.Form method="POST" className="mt-5 flex gap-2">
            <input
              type="email"
              name="manualNotifyEmail"
              defaultValue={store.manualNotifyEmail || ""}
              placeholder="owner@yourstore.com"
              className="min-w-0 flex-1 px-3 py-2.5 text-xs"
            />
            <button type="submit" className="lwi-btn-primary">
              {fetcher.state !== "idle" ? "Saving…" : "Save"}
            </button>
          </fetcher.Form>
        )}

        {fetcher.data?.error && (
          <p className="mt-3 text-xs text-red-600">{fetcher.data.error}</p>
        )}
        {fetcher.data?.success && (
          <p className="mt-3 text-xs text-green-700">Notification email saved.</p>
        )}
        {!notifyEmail && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No notification email is set yet.
          </p>
        )}
      </section>
    </main>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
