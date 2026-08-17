import { useLoaderData, useFetcher } from "react-router";
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
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Settings</h1>

      <div className="mt-8 rounded-2xl border border-neutral-200 p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Usage notifications
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          We'll email this address when your store is close to, or reaches, its
          monthly try-on generation limit.
        </p>

        {store.ownerEmail ? (
          <p className="mt-4 text-sm text-neutral-700">
            Currently sending to:{" "}
            <span className="font-medium">{store.ownerEmail}</span>{" "}
            <span className="text-neutral-400">
              (from your store's contact info)
            </span>
          </p>
        ) : (
          <fetcher.Form method="POST" className="mt-4 flex gap-3">
            <input
              type="email"
              name="manualNotifyEmail"
              defaultValue={store.manualNotifyEmail || ""}
              placeholder="owner@yourstore.com"
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              Save
            </button>
          </fetcher.Form>
        )}

        {fetcher.data?.error && (
          <p className="mt-3 text-sm text-red-600">{fetcher.data.error}</p>
        )}
        {fetcher.data?.success && (
          <p className="mt-3 text-sm text-green-600">Saved.</p>
        )}

        {!notifyEmail && (
          <p className="mt-3 text-sm text-amber-600">
            No notification email set yet — you won't be alerted before hitting
            your limit.
          </p>
        )}
      </div>
    </div>
  );
}
