import prisma from "../db.server";
import { authenticateProxy } from "../utils/app-proxy.server";
import { getStoreFeatures } from "../services/plan.server";

export async function loader({ request }) {
  const json = (data, init = {}) => Response.json(data, init);

  const { shop } = await authenticateProxy(request);

  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ error: "UNKNOWN_SHOP" }, { status: 403 });

  const features = await getStoreFeatures(store);
  return json({ features });
}
