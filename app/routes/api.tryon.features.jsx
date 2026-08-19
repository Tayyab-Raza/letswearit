import prisma from "../db.server";
import { getStoreFeatures } from "../services/plan.server";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function loader({ request }) {
  const cors = corsHeaders(request);
  const json = (data, init = {}) =>
    Response.json(data, { ...init, headers: { ...cors, ...(init.headers || {}) } });

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return json({ error: "MISSING_SHOP" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  const features = await getStoreFeatures(store);
  return json({ features });
}
