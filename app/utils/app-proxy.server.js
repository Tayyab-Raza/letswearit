import { authenticate } from "../shopify.server";

// Verifies the request actually came through Shopify's App Proxy (Shopify
// signs the query string with your app secret; the library checks it here)
// instead of trusting a client-supplied `shop` value.
//
// Without this, any of the storefront-facing /api/tryon* routes could be
// called directly, from anywhere, with a `shop` naming a store that never
// made the request — burning that store's Gemini quota — and a
// shopifyCustomerId could be swapped for any customer's, returning their
// saved try-on images. `logged_in_customer_id` below comes from Shopify's
// signed query string, not the client, so it can be trusted.
//
// Throws a Response (not an Error) on failure, so callers can just
// `await authenticateProxy(request)` at the top of loader/action and let it
// short-circuit the request.
export async function authenticateProxy(request) {
  let session, admin;
  try {
    ({ session, admin } = await authenticate.public.appProxy(request));
  } catch {
    throw Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!session?.shop) {
    throw Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const loggedInCustomerId =
    url.searchParams.get("logged_in_customer_id") || null;

  return { shop: session.shop, admin, loggedInCustomerId };
}
