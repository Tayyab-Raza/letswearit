import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markUninstalled } from "../services/store.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Record the uninstall on the Store itself — onStoreInstalled()'s reinstall
  // path clears this field, but nothing was ever setting it, so a merchant's
  // uninstall was invisible outside the Session table disappearing.
  await markUninstalled(shop);

  return new Response();
};
