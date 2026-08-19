import { useEffect, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 10;

const CATEGORY_LABELS = {
  outfit: "Outfit",
  footwear: "Footwear",
  handbag: "Handbag",
  jewelry_necklace: "Necklace",
  jewelry_ear: "Earrings",
  jewelry_hand: "Ring / Bracelet",
};

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("query") || "";
  const cursor = url.searchParams.get("cursor") || null;
  const direction =
    url.searchParams.get("direction") === "prev" ? "prev" : "next";

  const sanitizedTerm = searchTerm.replace(/["\\]/g, "").trim();
  const searchQuery = sanitizedTerm ? `title:*${sanitizedTerm}*` : null;

  const variables = { query: searchQuery };
  if (direction === "prev" && cursor) {
    variables.last = PAGE_SIZE;
    variables.before = cursor;
  } else {
    variables.first = PAGE_SIZE;
    variables.after = cursor || undefined;
  }

  const response = await admin.graphql(
    `#graphql
    query DashboardProducts(
      $first: Int
      $after: String
      $last: Int
      $before: String
      $query: String
    ) {
      products(
        first: $first
        after: $after
        last: $last
        before: $before
        query: $query
        sortKey: TITLE
      ) {
        nodes {
          id
          title
          status
          totalInventory
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          front: metafield(namespace: "tryon", key: "front_image") { id }
        }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    { variables },
  );

  const { data } = await response.json();
  const nodes = data.products.nodes;

  // Cross-reference with our own category classifications so the merchant
  // can see, at a glance, which products are set up and how they'll be
  // categorized — without opening each one individually.
  let profileByProductId = {};
  if (nodes.length) {
    const store = await prisma.store.findUnique({
      where: { shop: session.shop },
    });
    if (store) {
      const profiles = await prisma.productProfile.findMany({
        where: { storeId: store.id, productId: { in: nodes.map((n) => n.id) } },
      });
      profileByProductId = Object.fromEntries(
        profiles.map((p) => [p.productId, p]),
      );
    }
  }

  const products = nodes.map((n) => ({
    ...n,
    tryOnReady: !!n.front,
    category: profileByProductId[n.id]?.category || null,
  }));

  return {
    products,
    pageInfo: data.products.pageInfo,
    searchTerm,
  };
}

function StatusBadge({ status }) {
  const isActive = status === "ACTIVE";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isActive
          ? "bg-green-50 text-green-700"
          : "bg-neutral-100 text-neutral-600"
      }`}
    >
      {status}
    </span>
  );
}

function TryOnBadge({ ready }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ready ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {ready ? "Ready" : "Not set up"}
    </span>
  );
}

export default function ProductsDashboard() {
  const { products, pageInfo, searchTerm } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [searchDraft, setSearchDraft] = useState(searchTerm);
  useEffect(() => setSearchDraft(searchTerm), [searchTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (searchDraft) params.set("query", searchDraft);
      setSearchParams(params);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function goNext() {
    const params = new URLSearchParams();
    if (searchTerm) params.set("query", searchTerm);
    params.set("direction", "next");
    params.set("cursor", pageInfo.endCursor);
    setSearchParams(params);
  }

  function goPrev() {
    const params = new URLSearchParams();
    if (searchTerm) params.set("query", searchTerm);
    params.set("direction", "prev");
    params.set("cursor", pageInfo.startCursor);
    setSearchParams(params);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Products</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Open a product to add its try-on reference photos, size chart, or
        category.
      </p>

      <input
        type="text"
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        placeholder="Search by product title"
        className="mt-6 w-full max-w-sm rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
      />

      <div
        className={`mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white ${isLoading ? "opacity-60" : ""}`}
      >
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Try-on</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Inventory</th>
              <th className="px-4 py-3 font-medium">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {products.map((product) => {
              const productId = product.id.split("/").pop();
              return (
                <tr key={product.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/products/${productId}`}
                      className="flex items-center gap-3"
                    >
                      <div className="h-10 w-10 flex-none overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                        {product.featuredImage?.url && (
                          <img
                            src={product.featuredImage.url}
                            alt={product.featuredImage.altText || product.title}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <span className="font-medium text-neutral-900 underline-offset-2 hover:underline">
                        {product.title}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={product.status} />
                  </td>
                  <td className="px-4 py-3">
                    <TryOnBadge ready={product.tryOnReady} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {product.category ? (
                      CATEGORY_LABELS[product.category] || product.category
                    ) : (
                      <span className="text-neutral-400">
                        Not classified yet
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {product.totalInventory}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {product.priceRangeV2.minVariantPrice.amount}{" "}
                    {product.priceRangeV2.minVariantPrice.currencyCode}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {products.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No products found{searchTerm ? ` for "${searchTerm}"` : ""}.
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={!pageInfo.hasPreviousPage}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-neutral-100"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!pageInfo.hasNextPage}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-neutral-100"
        >
          Next
        </button>
      </div>
    </div>
  );
}
