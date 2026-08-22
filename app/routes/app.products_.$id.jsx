import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CATEGORIES } from "../services/category.server";

// Media types the native file picker should offer — reference photos are always images.
const PICKER_DATA = { mediaTypes: ["MediaImage"] };

const METAFIELD_NAMESPACE = "tryon";

const IMAGE_FIELDS = [
  { key: "front_image", formField: "front", label: "Front image" },
  { key: "back_image", formField: "back", label: "Back image" },
  { key: "side_image", formField: "side", label: "Side image" },
];

const CATEGORY_LABELS = {
  outfit: "Outfit",
  footwear: "Footwear",
  handbag: "Handbag",
  jewelry_necklace: "Necklace",
  jewelry_ear: "Earrings",
  jewelry_hand: "Ring / Bracelet",
};

const SUBCATEGORIES = ["unisex", "womens", "mens"];

const SOURCE_LABELS = {
  heuristic: "Auto-detected from product type/tags",
  ai_vision: "Auto-detected from product photo (AI)",
  manual: "Set manually",
};

const SIZE_CHART_COLUMNS = [
  { key: "size", label: "Size", placeholder: "S" },
  { key: "chest_in", label: "Chest (in)", placeholder: "36", numeric: true },
  { key: "waist_in", label: "Waist (in)", placeholder: "28", numeric: true },
  { key: "hip_in", label: "Hip (in)", placeholder: "38", numeric: true },
];

function toProductGid(id) {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

function emptySizeRow() {
  return { size: "", chest_in: "", waist_in: "", hip_in: "" };
}

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const productGid = toProductGid(params.id);

  const response = await admin.graphql(
    `#graphql
    query ProductDetail($id: ID!) {
      product(id: $id) {
        id
        title
        front: metafield(namespace: "tryon", key: "front_image") {
          reference { ... on MediaImage { image { url } } }
        }
        back: metafield(namespace: "tryon", key: "back_image") {
          reference { ... on MediaImage { image { url } } }
        }
        side: metafield(namespace: "tryon", key: "side_image") {
          reference { ... on MediaImage { image { url } } }
        }
        sizeChart: metafield(namespace: "tryon", key: "size_chart") { value }
      }
    }`,
    { variables: { id: productGid } },
  );

  const { data } = await response.json();
  if (!data?.product) {
    throw new Response("Product not found", { status: 404 });
  }

  const store = await prisma.store.findUnique({
    where: { shop: session.shop },
  });
  const profile = store
    ? await prisma.productProfile.findUnique({
        where: {
          storeId_productId: { storeId: store.id, productId: productGid },
        },
      })
    : null;

  let sizeChartRows = [];
  if (data.product.sizeChart?.value) {
    try {
      const parsed = JSON.parse(data.product.sizeChart.value);
      if (Array.isArray(parsed) && parsed.length) sizeChartRows = parsed;
    } catch {
      // Malformed metafield value (e.g. edited outside the app) — fall back
      // to an empty editor rather than crashing the page.
    }
  }

  return {
    product: { id: data.product.id, title: data.product.title },
    existingImages: {
      front: data.product.front?.reference?.image?.url || null,
      back: data.product.back?.reference?.image?.url || null,
      side: data.product.side?.reference?.image?.url || null,
    },
    sizeChartRows,
    category: profile?.category || null,
    subcategory: profile?.subcategory || "unisex",
    categorySource: profile?.source || null,
    categories: CATEGORIES,
  };
}

async function ensureMetafieldDefinitions(admin) {
  const definitions = [
    ...IMAGE_FIELDS.map((field) => ({
      name: field.label,
      namespace: METAFIELD_NAMESPACE,
      key: field.key,
      type: "file_reference",
      ownerType: "PRODUCT",
      access: { storefront: "PUBLIC_READ" },
    })),
    {
      name: "Size chart",
      namespace: METAFIELD_NAMESPACE,
      key: "size_chart",
      type: "json",
      ownerType: "PRODUCT",
      access: { storefront: "PUBLIC_READ" },
    },
  ];

  for (const definition of definitions) {
    const response = await admin.graphql(
      `#graphql
      mutation EnsureTryOnMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { code message }
        }
      }`,
      { variables: { definition } },
    );
    const { data } = await response.json();
    const errors = data?.metafieldDefinitionCreate?.userErrors || [];
    const blocking = errors.filter((e) => e.code !== "TAKEN");
    if (blocking.length) {
      throw new Error(blocking.map((e) => e.message).join(", "));
    }
  }
}

async function uploadImageFile(admin, file) {
  const stagedResponse = await admin.graphql(
    `#graphql
    mutation StagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [
          {
            filename: file.name || "reference-image.jpg",
            mimeType: file.type || "image/jpeg",
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(file.size),
          },
        ],
      },
    },
  );

  const stagedJson = await stagedResponse.json();
  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors || [];
  if (!target || stagedErrors.length) {
    throw new Error(
      stagedErrors.map((e) => e.message).join(", ") ||
        "Could not start the image upload.",
    );
  }

  const uploadForm = new FormData();
  for (const param of target.parameters) {
    uploadForm.append(param.name, param.value);
  }
  uploadForm.append("file", file);

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Image upload failed (${uploadResponse.status}).`);
  }

  const fileCreateResponse = await admin.graphql(
    `#graphql
    mutation CreateFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "IMAGE",
            alt: file.name,
          },
        ],
      },
    },
  );

  const fileJson = await fileCreateResponse.json();
  const created = fileJson.data?.fileCreate?.files?.[0];
  const fileErrors = fileJson.data?.fileCreate?.userErrors || [];
  if (!created || fileErrors.length) {
    throw new Error(
      fileErrors.map((e) => e.message).join(", ") ||
        "Could not save the uploaded image.",
    );
  }

  return created.id;
}

async function handleImagesIntent(admin, productGid, formData) {
  const uploads = [];
  const picked = [];
  for (const field of IMAGE_FIELDS) {
    const file = formData.get(field.formField);
    if (file && typeof file === "object" && "size" in file && file.size > 0) {
      uploads.push({ field, file });
      continue;
    }
    // Imported via the native "Import from Shopify" file picker — already
    // a real File/MediaImage on this store, so it just needs writing to
    // the metafield directly, no staged upload required.
    const pickedFileId = formData.get(`${field.formField}_file_id`);
    if (pickedFileId) {
      picked.push({ field, fileGid: String(pickedFileId) });
    }
  }

  if (uploads.length === 0 && picked.length === 0) {
    return { error: "Choose at least one image before saving." };
  }

  await ensureMetafieldDefinitions(admin);

  const metafieldsInput = [];
  for (const { field, file } of uploads) {
    const fileGid = await uploadImageFile(admin, file);
    metafieldsInput.push({
      ownerId: productGid,
      namespace: METAFIELD_NAMESPACE,
      key: field.key,
      type: "file_reference",
      value: fileGid,
    });
  }
  for (const { field, fileGid } of picked) {
    metafieldsInput.push({
      ownerId: productGid,
      namespace: METAFIELD_NAMESPACE,
      key: field.key,
      type: "file_reference",
      value: fileGid,
    });
  }

  const setResponse = await admin.graphql(
    `#graphql
    mutation SetTryOnImages($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key }
        userErrors { field message }
      }
    }`,
    { variables: { metafields: metafieldsInput } },
  );

  const setJson = await setResponse.json();
  const setErrors = setJson.data?.metafieldsSet?.userErrors || [];
  if (setErrors.length) {
    return { error: setErrors.map((e) => e.message).join(", ") };
  }

  return {
    imagesSuccess: true,
    savedFields: [...uploads, ...picked].map((u) => u.field.formField),
  };
}

async function handleSizeChartIntent(admin, productGid, formData) {
  const raw = formData.get("sizeChartJson");
  let rows;
  try {
    rows = JSON.parse(raw || "[]");
  } catch {
    return { error: "Could not read the size chart table." };
  }
  if (!Array.isArray(rows)) {
    return { error: "Could not read the size chart table." };
  }

  await ensureMetafieldDefinitions(admin);

  const setResponse = await admin.graphql(
    `#graphql
    mutation SetSizeChart($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productGid,
            namespace: METAFIELD_NAMESPACE,
            key: "size_chart",
            type: "json",
            value: JSON.stringify(rows),
          },
        ],
      },
    },
  );

  const setJson = await setResponse.json();
  const setErrors = setJson.data?.metafieldsSet?.userErrors || [];
  if (setErrors.length) {
    return { error: setErrors.map((e) => e.message).join(", ") };
  }

  return { sizeChartSuccess: true };
}

async function handleCategoryIntent(session, productGid, formData) {
  const category = formData.get("category");
  const subcategory = formData.get("subcategory") || "unisex";

  if (!CATEGORIES.includes(category)) {
    return { error: "Choose a valid category." };
  }
  if (!SUBCATEGORIES.includes(subcategory)) {
    return { error: "Choose a valid subcategory." };
  }

  const store = await prisma.store.findUnique({
    where: { shop: session.shop },
  });
  if (!store) return { error: "Store not found." };

  await prisma.productProfile.upsert({
    where: { storeId_productId: { storeId: store.id, productId: productGid } },
    update: { category, subcategory, source: "manual" },
    create: {
      storeId: store.id,
      productId: productGid,
      category,
      subcategory,
      source: "manual",
    },
  });

  return { categorySuccess: true, category, subcategory };
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const productGid = toProductGid(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent") || "images";

  try {
    if (intent === "sizeChart")
      return await handleSizeChartIntent(admin, productGid, formData);
    if (intent === "category")
      return await handleCategoryIntent(session, productGid, formData);
    return await handleImagesIntent(admin, productGid, formData);
  } catch (error) {
    return { error: error.message || "Something went wrong while saving." };
  }
}

export default function ProductDetail() {
  const {
    product,
    existingImages,
    sizeChartRows: initialSizeChartRows,
    category: initialCategory,
    subcategory: initialSubcategory,
    categorySource,
    categories,
  } = useLoaderData();

  const imagesFetcher = useFetcher();
  const previewFetcher = useFetcher();
  const sizeChartFetcher = useFetcher();
  const categoryFetcher = useFetcher();

  const [previews, setPreviews] = useState({
    front: null,
    back: null,
    side: null,
  });

  // Files picked via Shopify's native file picker, keyed by field:
  // { id: "gid://shopify/MediaImage/...", url: "..." }
  const [pickedFiles, setPickedFiles] = useState({
    front: null,
    back: null,
    side: null,
  });
  const [importingField, setImportingField] = useState(null);
  const pendingPreviewField = useRef(null);

  // The image currently shown in the "view full size" modal.
  const [viewingImage, setViewingImage] = useState(null);

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, [previews]);

  function handleFileChange(fieldKey, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreviews((current) => ({
      ...current,
      [fieldKey]: URL.createObjectURL(file),
    }));
    // A manual upload replaces any previously-imported file for this slot.
    setPickedFiles((current) => ({ ...current, [fieldKey]: null }));
  }

  async function handleImport(fieldKey) {
    if (typeof window === "undefined" || !window.shopify?.intents) return;
    setImportingField(fieldKey);
    try {
      const activity = await window.shopify.intents.invoke(
        "pick:shopify/File",
        {
          data: PICKER_DATA,
        },
      );
      const response = await activity.complete;
      if (response.code !== "ok") return;

      const fileId = response.data?.ids?.[0];
      if (!fileId) return;

      setPreviews((current) => {
        if (current[fieldKey]) URL.revokeObjectURL(current[fieldKey]);
        return { ...current, [fieldKey]: null };
      });
      setPickedFiles((current) => ({
        ...current,
        [fieldKey]: { id: fileId, url: null },
      }));

      pendingPreviewField.current = fieldKey;
      previewFetcher.load(
        `/app/api/file-preview?ids=${encodeURIComponent(fileId)}`,
      );
    } finally {
      setImportingField(null);
    }
  }

  // Route the resolved preview URL back to whichever field triggered it.
  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) return;
    const fieldKey = pendingPreviewField.current;
    if (!fieldKey) return;
    const images = previewFetcher.data.images || {};
    setPickedFiles((current) => {
      const entry = current[fieldKey];
      if (!entry) return current;
      const url = images[entry.id];
      if (!url || entry.url === url) return current;
      return { ...current, [fieldKey]: { ...entry, url } };
    });
  }, [previewFetcher.state, previewFetcher.data]);

  const isSavingImages = imagesFetcher.state !== "idle";
  const imagesResult = imagesFetcher.data;

  const [sizeChartRows, setSizeChartRows] = useState(
    initialSizeChartRows.length ? initialSizeChartRows : [emptySizeRow()],
  );
  const isSavingSizeChart = sizeChartFetcher.state !== "idle";
  const sizeChartResult = sizeChartFetcher.data;

  function updateSizeCell(rowIndex, key, value) {
    setSizeChartRows((rows) =>
      rows.map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row)),
    );
  }
  function addSizeRow() {
    setSizeChartRows((rows) => [...rows, emptySizeRow()]);
  }
  function removeSizeRow(rowIndex) {
    setSizeChartRows((rows) => rows.filter((_, i) => i !== rowIndex));
  }
  function saveSizeChart() {
    const cleaned = sizeChartRows
      .filter((row) => row.size?.trim())
      .map((row) => {
        const out = { size: row.size.trim() };
        for (const col of SIZE_CHART_COLUMNS) {
          if (col.key === "size") continue;
          if (row[col.key] !== "" && row[col.key] != null) {
            const num = Number(row[col.key]);
            if (!Number.isNaN(num)) out[col.key] = num;
          }
        }
        return out;
      });
    sizeChartFetcher.submit(
      { intent: "sizeChart", sizeChartJson: JSON.stringify(cleaned) },
      { method: "POST" },
    );
  }

  const [category, setCategory] = useState(initialCategory || "outfit");
  const [subcategory, setSubcategory] = useState(
    initialSubcategory || "unisex",
  );
  const isSavingCategory = categoryFetcher.state !== "idle";
  const categoryResult = categoryFetcher.data;
  function saveCategory() {
    categoryFetcher.submit(
      { intent: "category", category, subcategory },
      { method: "POST" },
    );
  }

  return (
    <main className="lwi-page lwi-page--narrow">
      <Link
        to="/app/products"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← Back to products
      </Link>

      <div className="mt-5">
        <p className="lwi-kicker">Product setup</p>
        <h1 className="lwi-title">{product.title}</h1>
      </div>

      {/* --- Reference photos --- */}
      <p className="mt-2 max-w-xl text-sm text-neutral-500">
        Upload a front, back, and side reference photo of this product. Saving
        writes each image to this product's{" "}
        <code className="text-neutral-400">tryon.*</code> metafields — those get
        created automatically on first save.
      </p>

      {imagesResult?.error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {imagesResult.error}
        </div>
      )}
      {imagesResult?.imagesSuccess && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Reference images updated.
        </div>
      )}

      <imagesFetcher.Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="images" />
        <div className="mt-8 space-y-4">
          {IMAGE_FIELDS.map(({ formField, label }) => {
            const picked = pickedFiles[formField];
            const previewUrl =
              previews[formField] || picked?.url || existingImages[formField];
            return (
              <div
                key={formField}
                className="flex items-start gap-4 rounded-xl border border-neutral-200 p-4"
              >
                <div className="relative h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`${label} preview`}
                      className="h-full w-full object-cover"
                    />
                  ) : picked ? (
                    <div className="flex h-full w-full items-center justify-center">
                      <svg
                        className="h-4 w-4 animate-spin text-neutral-400"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          stroke="currentColor"
                          strokeWidth="3"
                          opacity="0.25"
                        />
                        <path
                          d="M21 12a9 9 0 0 0-9-9"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  ) : null}
                  {previewUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        setViewingImage({ url: previewUrl, label })
                      }
                      aria-label={`View ${label} full size`}
                      className="absolute right-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/55 text-white"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex-1">
                  <p className="mb-2 text-sm font-medium text-neutral-700">
                    {label}
                  </p>
                  <div className="flex flex-wrap items-stretch gap-3">
                    <label
                      htmlFor={`${formField}-file-input`}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3.5 py-2.5 text-xs text-neutral-600 hover:border-neutral-500"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 3v12" />
                        <path d="M7 8l5-5 5 5" />
                        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                      </svg>
                      Choose file
                      <input
                        id={`${formField}-file-input`}
                        type="file"
                        name={formField}
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => handleFileChange(formField, event)}
                        className="hidden"
                      />
                    </label>

                    {picked && (
                      <input
                        type="hidden"
                        name={`${formField}_file_id`}
                        value={picked.id}
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => handleImport(formField)}
                      disabled={importingField === formField}
                      className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      {importingField === formField
                        ? "Opening..."
                        : "Import from Shopify"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={isSavingImages}
          className="mt-8 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:enabled:bg-neutral-800"
        >
          {isSavingImages ? "Saving…" : "Save photos"}
        </button>
      </imagesFetcher.Form>

      {viewingImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setViewingImage(null)}
        >
          <div
            className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-2xl bg-white p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setViewingImage(null)}
              aria-label="Close preview"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-lg font-semibold text-white"
            >
              ×
            </button>
            <img
              src={viewingImage.url}
              alt={`${viewingImage.label} full size`}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
            <p className="mt-2 text-center text-sm text-neutral-600">
              {viewingImage.label}
            </p>
          </div>
        </div>
      )}

      {/* --- Category --- */}
      <div className="mt-10 rounded-2xl border border-neutral-200 p-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Try-on category
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Controls which prompt and photo guidance is used for this product's
          try-on. Detected automatically the first time someone tries this
          product on — override it here if it's wrong.
        </p>

        {categorySource && (
          <p className="mt-3 text-xs text-neutral-400">
            {SOURCE_LABELS[categorySource] || categorySource}
          </p>
        )}
        {!initialCategory && (
          <p className="mt-3 text-xs text-amber-600">
            Not classified yet — this product hasn't been tried on. Defaults
            shown below until then, or set it manually now.
          </p>
        )}

        {categoryResult?.error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {categoryResult.error}
          </div>
        )}
        {categoryResult?.categorySuccess && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
            Category saved.
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] || c}
              </option>
            ))}
          </select>
          <select
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {SUBCATEGORIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={saveCategory}
            disabled={isSavingCategory}
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:enabled:bg-neutral-800"
          >
            {isSavingCategory ? "Saving…" : "Save category"}
          </button>
        </div>
      </div>

      {/* --- Size chart (size_fit feature) --- */}
      <div className="mt-8 rounded-2xl border border-neutral-200 p-6">
        <h2 className="text-base font-semibold text-neutral-900">Size chart</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Optional — without this, "Get a size suggestion" on the storefront
          falls back to a generic XS–XXL band instead of this product's real
          sizing.
        </p>

        {sizeChartResult?.error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {sizeChartResult.error}
          </div>
        )}
        {sizeChartResult?.sizeChartSuccess && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
            Size chart saved.
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                {SIZE_CHART_COLUMNS.map((col) => (
                  <th key={col.key} className="px-2 py-1.5 font-medium">
                    {col.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {sizeChartRows.map((row, i) => (
                <tr key={i}>
                  {SIZE_CHART_COLUMNS.map((col) => (
                    <td key={col.key} className="px-2 py-1">
                      <input
                        type={col.numeric ? "number" : "text"}
                        value={row[col.key] ?? ""}
                        placeholder={col.placeholder}
                        onChange={(e) =>
                          updateSizeCell(i, col.key, e.target.value)
                        }
                        className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-900 focus:outline-none"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => removeSizeRow(i)}
                      className="text-xs text-neutral-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={addSizeRow}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
          >
            + Add size
          </button>
          <button
            type="button"
            onClick={saveSizeChart}
            disabled={isSavingSizeChart}
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:enabled:bg-neutral-800"
          >
            {isSavingSizeChart ? "Saving…" : "Save size chart"}
          </button>
        </div>
      </div>
    </main>
  );
}
