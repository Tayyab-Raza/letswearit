(function () {
  "use strict";

  const ANGLE_LABELS = {
    front: "Front",
    side: "Side",
    back: "Back",
    three_quarter_left: "3/4 Left",
    three_quarter_right: "3/4 Right",
    back_side: "Back 3/4",
  };

  const ANON_ID_KEY = "letswearit_anon_id";

  // Maps each tab to the plan feature that gates it. "tryon" is included on
  // every plan today, but it's still checked the same way as the rest so a
  // future plan without it is handled automatically instead of silently
  // leaving that one tab always unlocked.
  const TAB_FEATURE = {
    tryon: "tryon",
    sizefit: "size_fit",
    spin: "multi_angle_spin",
    outfit: "full_outfit",
    video: "video_tryon",
    closet: "closet",
  };

  // Which tabs need the shared photo picker visible.
  const PHOTO_TABS = new Set(["tryon", "sizefit", "outfit"]);

  function getAnonymousId() {
    try {
      let id = window.localStorage.getItem(ANON_ID_KEY);
      if (!id) {
        id =
          "anon_" +
          Math.random().toString(36).slice(2) +
          Date.now().toString(36);
        window.localStorage.setItem(ANON_ID_KEY, id);
      }
      return id;
    } catch {
      // Storage blocked (private mode, etc.) — fall back to a per-page id.
      return "anon_" + Math.random().toString(36).slice(2);
    }
  }

  document.querySelectorAll(".tryon-root").forEach(initTryOnWidget);

  function initTryOnWidget(root) {
    const productId = root.dataset.productId;
    const productTitle = root.dataset.productTitle || "";
    const shop = root.dataset.shop;
    const endpoint = root.dataset.tryonEndpoint;
    const videoEndpoint = root.dataset.tryonVideoEndpoint;
    const sizefitEndpoint = root.dataset.tryonSizefitEndpoint;
    const historyEndpoint = root.dataset.tryonHistoryEndpoint;
    const featuresEndpoint = root.dataset.tryonFeaturesEndpoint;
    const categoryEndpoint = root.dataset.tryonCategoryEndpoint;
    const samplePhotoUrl = root.dataset.samplePhotoUrl;
    const shopifyCustomerId = root.dataset.shopifyCustomerId || null;
    const anonymousId = getAnonymousId();
    const variantId = root.dataset.variantId;
    const initialAvailable = root.dataset.available === "true";
    const productHandle = root.dataset.productHandle;

    let companions = [];
    try {
      const raw = root.querySelector("[data-tryon-companions]");
      companions = raw ? JSON.parse(raw.textContent || "[]") : [];
    } catch {
      companions = [];
    }

    const els = {
      cta: root.querySelector("[data-tryon-open]"),
      overlay: root.querySelector("[data-tryon-overlay]"),
      sheet: root.querySelector("[data-tryon-sheet]"),
      close: root.querySelector("[data-tryon-close]"),
      tabs: root.querySelector("[data-tryon-tabs]"),
      error: root.querySelector("[data-tryon-error]"),
      historyBanner: root.querySelector("[data-tryon-history-banner]"),
      historyBannerImg: root.querySelector("[data-tryon-history-banner-img]"),
      historyBannerText: root.querySelector("[data-tryon-history-banner-text]"),

      // Shared photo picker
      photoPicker: root.querySelector("[data-tryon-photo-picker]"),
      photoGood: root.querySelector("[data-tryon-photo-good]"),
      photoBad: root.querySelector("[data-tryon-photo-bad]"),
      uploadTitle: root.querySelector("[data-tryon-upload-title]"),
      uploadNote: root.querySelector("[data-tryon-upload-note]"),
      uploadBox: root.querySelector("[data-tryon-upload-box]"),
      uploadPreview: root.querySelector("[data-tryon-upload-preview]"),
      uploadPlaceholder: root.querySelector("[data-tryon-upload-placeholder]"),
      fileInput: root.querySelector("[data-tryon-file-input]"),
      sampleBtn: root.querySelector("[data-tryon-sample]"),

      // Try On panel
      tryOnIdle: root.querySelector('[data-tryon-step="idle"]'),
      tryOnProcessing: root.querySelector('[data-tryon-step="processing"]'),
      tryOnResult: root.querySelector('[data-tryon-step="result"]'),
      generateBtn: root.querySelector("[data-tryon-generate]"),
      angleTabs: root.querySelector("[data-tryon-angle-tabs]"),
      resultImg: root.querySelector("[data-tryon-result-img]"),
      angleLoading: root.querySelector("[data-tryon-angle-loading]"),
      angleLoadingLabel: root.querySelector("[data-tryon-angle-loading-label]"),
      shareBtn: root.querySelector("[data-tryon-share]"),
      addToCartBtn: root.querySelector("[data-tryon-add-to-cart]"),
      resultDownloadBtn: root.querySelector("[data-tryon-download]"),

      // Size & Fit panel
      sizefitBtn: root.querySelector("[data-tryon-sizefit-btn]"),
      sizefitResult: root.querySelector("[data-tryon-sizefit-result]"),

      // Spin panel
      spinEmpty: root.querySelector("[data-tryon-spin-empty]"),
      spinContent: root.querySelector("[data-tryon-spin-content]"),
      spinResultImage: root.querySelector("[data-tryon-spin-result-image]"),
      spinImg: root.querySelector("[data-tryon-spin-img]"),
      spinHint: root.querySelector("[data-tryon-spin-hint]"),

      // Full Outfit panel
      outfitChips: root.querySelector("[data-tryon-outfit-chips]"),
      outfitEmpty: root.querySelector("[data-tryon-outfit-empty]"),
      outfitGenerateBtn: root.querySelector("[data-tryon-outfit-generate]"),
      outfitResultImage: root.querySelector("[data-tryon-outfit-result-image]"),
      outfitResultImg: root.querySelector("[data-tryon-outfit-result-img]"),
      outfitDownloadBtn: root.querySelector("[data-tryon-outfit-download]"),

      // Video panel
      videoEmpty: root.querySelector("[data-tryon-video-empty]"),
      videoContent: root.querySelector("[data-tryon-video-content]"),
      videoBtn: root.querySelector("[data-tryon-video-btn]"),
      videoWrap: root.querySelector("[data-tryon-video-wrap]"),
      videoEl: root.querySelector("[data-tryon-video-el]"),
      videoDownloadBtn: root.querySelector("[data-tryon-video-download]"),

      // Closet panel
      closetGrid: root.querySelector("[data-tryon-closet-grid]"),
      closetEmpty: root.querySelector("[data-tryon-closet-empty]"),
      closetCompareBtn: root.querySelector("[data-tryon-closet-compare]"),
      compareView: root.querySelector("[data-tryon-compare-view]"),
    };

    const state = {
      activeTab: "tryon",
      uploadData: "",
      sampleImageUrl: "",
      resultImages: {},
      angleStatus: {},
      activeAngle: "front",
      tryOnStep: "idle", // idle | processing | result
      features: [],
      featuresError: false,
      category: null,
      categoryConfig: null,
      selectedCompanionIds: [],
      outfitStatus: "idle", // idle | loading | ready | failed
      outfitImage: null,
      closetSelection: [],
      variantId: variantId || null,
      available: variantId ? initialAvailable : false,
      addingToCart: false,
    };

    function hasFeature(key) {
      return state.features.includes(key);
    }

    // Availability lookup for every variant, keyed by variant id. Loaded
    // once in the background; used so we can tell whether whatever variant
    // the shopper currently has selected is actually in stock.
    let variantsById = null;
    if (productHandle) {
      fetch(`/products/${productHandle}.js`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || !Array.isArray(data.variants)) return;
          variantsById = {};
          data.variants.forEach((v) => {
            variantsById[String(v.id)] = v;
          });
          if (state.tryOnStep === "result") {
            syncSelectedVariant();
            renderAddToCartState();
          }
        })
        .catch(() => {});
    }

    // Reads the variant the shopper currently has selected directly from
    // the page's own add-to-cart form — the same source of truth the theme
    // itself uses — rather than relying on the value at page load.
    function getSelectedVariantIdFromPage() {
      const field = document.querySelector(
        'form[action*="/cart/add"] [name="id"]',
      );
      return field && field.value ? String(field.value) : null;
    }

    // Refreshes state.variantId/state.available from whatever is currently
    // selected on the page. Call this right before anything that depends
    // on knowing the exact variant (opening the sheet, showing the Add to
    // Cart button, actually adding to cart).
    function syncSelectedVariant() {
      const id = getSelectedVariantIdFromPage() || state.variantId;
      if (!id) {
        state.variantId = null;
        state.available = false;
        return;
      }
      state.variantId = id;
      if (variantsById && variantsById[id]) {
        state.available = !!variantsById[id].available;
      } else if (id === variantId) {
        // Haven't loaded the variants map yet (or it failed) — fall back
        // to the value rendered at page load for the original variant.
        state.available = initialAvailable;
      } else {
        // A different variant than the one rendered server-side, and we
        // don't have fresh availability data for it yet — assume it's
        // orderable; /cart/add.js is the final authority and will reject
        // it with a clear error if it's actually out of stock.
        state.available = true;
      }
    }

    function renderAddToCartState() {
      syncSelectedVariant();
      const outOfStock = !state.available;
      els.addToCartBtn.disabled = outOfStock || state.addingToCart;
      els.addToCartBtn.classList.toggle(
        "tryon-primary--out-of-stock",
        outOfStock,
      );
      els.addToCartBtn.textContent = outOfStock
        ? "Out of Stock"
        : state.addingToCart
          ? "Adding..."
          : "Add to Cart";
    }

    root.querySelectorAll(".tryon-panel-lock p").forEach((p) => {
      p.dataset.defaultText = p.textContent;
    });

    // --- Setup fetches (run on first open) ---

    async function loadFeatures() {
      try {
        const res = await fetch(
          `${featuresEndpoint}?shop=${encodeURIComponent(shop)}`,
        );
        if (!res.ok) {
          // A non-2xx here (401 from App Proxy verification, 404 if the
          // proxy route isn't registered with Shopify yet, etc.) is NOT the
          // same thing as "this plan has zero features" — treating it that
          // way silently locked every tab, including during the trial,
          // with no way to tell the two apart. Throw so the catch below can
          // mark it as a check failure instead.
          throw new Error(`features request failed (${res.status})`);
        }
        const data = await res.json();
        state.features = data.features || [];
        state.featuresError = false;
      } catch {
        state.features = [];
        state.featuresError = true;
      }
      renderTabs();
      renderLocks();
    }

    async function loadCategory() {
      try {
        const res = await fetch(
          `${categoryEndpoint}?shop=${encodeURIComponent(shop)}&productId=${encodeURIComponent(productId)}`,
        );
        const data = await res.json();
        if (data.category) {
          state.category = data.category;
          state.categoryConfig = data;
          state.activeAngle = data.defaultAngles[0] || "front";
        }
      } catch {
        // Fall back to generic apparel copy/angles already in the markup.
        state.categoryConfig = {
          photoHint: "Head to at least the waist visible.",
          photoBad: "Cropped shoulders only, heavy filters.",
          angles: ["front", "side", "back"],
          defaultAngles: ["front", "side", "back"],
        };
      }
      applyCategoryUi();
    }

    function applyCategoryUi() {
      const cfg = state.categoryConfig;
      if (!cfg) return;
      els.photoGood.textContent = `✓ ${cfg.photoHint}`;
      els.photoBad.textContent = `× ${cfg.photoBad}`;
      els.uploadNote.textContent = cfg.photoHint;
      if (state.category === "footwear") {
        els.uploadTitle.textContent = "Use a photo with both feet visible";
      } else if (state.category === "handbag") {
        els.uploadTitle.textContent = "Use a photo with your hand visible";
      } else if (state.category && state.category.startsWith("jewelry")) {
        els.uploadTitle.textContent = "Use a close, well-lit photo";
      } else {
        els.uploadTitle.textContent =
          "Use a clear half-length or full-length photo";
      }

      const showOutfitChips =
        companions.length > 0 && state.category === "outfit";
      els.outfitChips.hidden = !showOutfitChips;
      els.outfitEmpty.hidden = showOutfitChips;
      if (showOutfitChips) renderOutfitChips();
    }

    function renderOutfitChips() {
      els.outfitChips.innerHTML = "";
      companions.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tryon-outfit-chip";
        btn.dataset.companionId = c.id;
        if (c.image) {
          const img = document.createElement("img");
          img.src = c.image;
          img.alt = c.title || "";
          btn.appendChild(img);
        }
        const span = document.createElement("span");
        span.textContent = c.title || "Item";
        btn.appendChild(span);
        btn.addEventListener("click", () => {
          const idx = state.selectedCompanionIds.indexOf(c.id);
          if (idx === -1) state.selectedCompanionIds.push(c.id);
          else state.selectedCompanionIds.splice(idx, 1);
          btn.classList.toggle("selected");
        });
        els.outfitChips.appendChild(btn);
      });
    }

    async function loadHistory() {
      try {
        const params = new URLSearchParams({
          shop,
          productId,
          anonymousId,
          scope: "product",
        });
        if (shopifyCustomerId)
          params.set("shopifyCustomerId", shopifyCustomerId);
        const res = await fetch(`${historyEndpoint}?${params.toString()}`);
        const data = await res.json();
        const latest = (data.generations || [])[0];
        if (latest) {
          els.historyBanner.hidden = false;
          els.historyBannerImg.src = latest.imageUrl;
          els.historyBannerText.textContent =
            "You tried this on before — tap to view";
          els.historyBanner.onclick = () => {
            state.resultImages = { [latest.angle]: latest.imageUrl };
            state.angleStatus = { [latest.angle]: "ready" };
            state.activeAngle = latest.angle;
            state.tryOnStep = "result";
            switchTab("tryon");
          };
        } else {
          els.historyBanner.hidden = true;
        }
      } catch {
        els.historyBanner.hidden = true;
      }
    }

    // --- Open/close ---

    els.cta.addEventListener("click", openSheet);
    els.overlay.addEventListener("click", closeSheet);
    els.close.addEventListener("click", closeSheet);

    let setupLoaded = false;
    async function openSheet() {
      showError("");
      els.overlay.hidden = false;
      els.sheet.classList.add("open");
      els.sheet.setAttribute("aria-hidden", "false");
      lockBodyScroll();
      switchTab(state.activeTab);

      if (!setupLoaded) {
        setupLoaded = true;
        await Promise.all([loadFeatures(), loadCategory()]);
        loadHistory();
      }
    }

    function closeSheet() {
      els.overlay.hidden = true;
      els.sheet.classList.remove("open");
      els.sheet.setAttribute("aria-hidden", "true");
      unlockBodyScroll();
    }

    let bodyScrollLockCount = 0;
    let savedBodyOverflow = "";

    function lockBodyScroll() {
      if (bodyScrollLockCount === 0) {
        savedBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      bodyScrollLockCount += 1;
    }

    function unlockBodyScroll() {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    }

    function showError(message) {
      if (!message) {
        els.error.hidden = true;
        els.error.textContent = "";
        return;
      }
      els.error.hidden = false;
      els.error.textContent = message;
    }

    // --- Tabs ---

    function renderTabs() {
      els.tabs.querySelectorAll("[data-tab]").forEach((btn) => {
        const tab = btn.dataset.tab;
        btn.classList.toggle("active", tab === state.activeTab);
        const featureKey = TAB_FEATURE[tab];
        const locked = featureKey ? !hasFeature(featureKey) : false;
        btn.classList.toggle("locked", locked);
      });
    }

    function renderLocks() {
      Object.keys(TAB_FEATURE).forEach((tab) => {
        const locked = !hasFeature(TAB_FEATURE[tab]);
        const lockEl = root.querySelector(`[data-panel-lock="${tab}"]`);
        const bodyEl = root.querySelector(`[data-panel-body="${tab}"]`);
        if (lockEl) {
          lockEl.hidden = !locked;
          if (locked) {
            const textEl = lockEl.querySelector("p");
            if (state.featuresError) {
              // Not a real plan restriction — the features check itself
              // failed (network/auth/misconfigured proxy). Say so plainly
              // instead of implying this plan has no features, and offer a
              // one-tap retry rather than making the shopper reopen the sheet.
              textEl.textContent = "Couldn't check your plan.";
              lockEl.classList.add("tryon-panel-lock--error");
              if (!lockEl.querySelector("[data-tryon-retry-features]")) {
                const retryBtn = document.createElement("button");
                retryBtn.type = "button";
                retryBtn.dataset.tryonRetryFeatures = "";
                retryBtn.className = "tryon-secondary";
                retryBtn.textContent = "Retry";
                retryBtn.addEventListener("click", loadFeatures);
                lockEl.appendChild(retryBtn);
              }
            } else {
              lockEl.classList.remove("tryon-panel-lock--error");
              const retryBtn = lockEl.querySelector(
                "[data-tryon-retry-features]",
              );
              if (retryBtn) retryBtn.remove();
              textEl.textContent =
                textEl.dataset.defaultText || textEl.textContent;
            }
          }
        }
        if (bodyEl) bodyEl.hidden = locked;
      });
      els.photoPicker.hidden = !PHOTO_TABS.has(state.activeTab);
    }

    function switchTab(tab) {
      state.activeTab = tab;
      root.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
      });
      renderTabs();
      renderLocks();

      if (tab === "tryon") renderTryOnPanel();
      if (tab === "spin") renderSpinPanel();
      if (tab === "outfit") renderOutfitPanel();
      if (tab === "video") renderVideoPanel();
      if (tab === "closet") loadClosetPanel();
    }

    els.tabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // --- Shared photo picker ---

    els.uploadBox.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFileChange);
    els.sampleBtn.addEventListener("click", useSamplePhoto);

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function compressImage(dataUrl, maxSide, quality) {
      maxSide = maxSide || 1500;
      quality = quality || 0.86;
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
    }

    async function handleFileChange(event) {
      const file = event.target.files && event.target.files[0];
      showError("");
      if (!file) return;

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showError("Upload a JPG, PNG, or WEBP image.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showError("Image is too large. Upload an image under 10 MB.");
        return;
      }

      const dataUrl = await fileToDataUrl(file);
      const compressed = await compressImage(dataUrl);
      els.uploadPreview.src = dataUrl;
      els.uploadPreview.hidden = false;
      els.uploadPlaceholder.hidden = true;
      state.uploadData = compressed;
      state.sampleImageUrl = "";
    }

    function useSamplePhoto() {
      showError("");
      els.uploadPreview.src = samplePhotoUrl;
      els.uploadPreview.hidden = false;
      els.uploadPlaceholder.hidden = true;
      state.uploadData = "sample";
      state.sampleImageUrl = samplePhotoUrl;
    }

    function requirePhoto() {
      if (!state.uploadData) {
        showError("Add a photo above first.");
        return false;
      }
      return true;
    }

    // --- Try On panel ---

    els.generateBtn.addEventListener("click", generateTryOn);
    els.shareBtn.addEventListener("click", handleShare);
    els.addToCartBtn.addEventListener("click", handleAddToCart);
    els.resultDownloadBtn.addEventListener("click", () => {
      const imageUrl = state.resultImages[state.activeAngle];
      if (!imageUrl) return;
      downloadFile(
        imageUrl,
        `${slugify(productTitle)}-${state.activeAngle}.jpg`,
      );
    });

    async function generateAngle(angle, companionIds) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.assign(
            {
              angle,
              productId,
              shop,
              anonymousId,
              shopifyCustomerId,
              companionProductIds: companionIds || [],
            },
            state.sampleImageUrl
              ? { sampleImageUrl: state.sampleImageUrl }
              : { imageDataUrl: state.uploadData },
          ),
        ),
      });
      const payload = await response.json();

      if (response.status === 402) {
        throw new Error(
          payload.message ||
            "This store has reached its AI try-on limit for now. Please check back later.",
        );
      }
      if (response.status === 403 && payload.error === "UPGRADE_REQUIRED") {
        throw new Error(payload.message || "This option needs a higher plan.");
      }
      if (!response.ok || !payload.imageUrl) {
        throw new Error(payload.message || "Generation failed");
      }
      if (payload.category) state.category = payload.category;
      return payload.imageUrl;
    }

    function defaultAngleSet() {
      return (
        (state.categoryConfig && state.categoryConfig.defaultAngles) || [
          "front",
          "side",
          "back",
        ]
      );
    }

    async function generateTryOn() {
      if (!requirePhoto()) return;

      const angles = defaultAngleSet();
      state.tryOnStep = "processing";
      showError("");
      state.activeAngle = angles[0];
      state.resultImages = {};
      state.angleStatus = {};
      angles.forEach(
        (a, i) => (state.angleStatus[a] = i === 0 ? "loading" : "queued"),
      );
      renderTryOnPanel();

      try {
        const firstUrl = await generateAngle(angles[0]);
        state.resultImages[angles[0]] = firstUrl;
        state.angleStatus[angles[0]] = "ready";
        angles.slice(1).forEach((a) => (state.angleStatus[a] = "loading"));
        state.tryOnStep = "result";
        renderTryOnPanel();
        angles.slice(1).forEach((a, i) => {
          window.setTimeout(() => generateBackgroundAngle(a), (i + 1) * 900);
        });
      } catch (err) {
        state.tryOnStep = "idle";
        showError(
          err.message ||
            "We could not generate this try-on. Please try another photo.",
        );
        renderTryOnPanel();
      }
    }

    async function generateBackgroundAngle(angle) {
      state.angleStatus[angle] = "loading";
      renderAngleTabs();
      try {
        const imageUrl = await generateAngle(angle);
        state.resultImages[angle] = imageUrl;
        state.angleStatus[angle] = "ready";
      } catch {
        state.angleStatus[angle] = "failed";
      }
      renderAngleTabs();
      if (state.activeAngle === angle) renderResultImage();
      if (state.activeTab === "spin") renderSpinPanel();
    }

    function renderTryOnPanel() {
      els.tryOnIdle.hidden = state.tryOnStep !== "idle";
      els.tryOnProcessing.hidden = state.tryOnStep !== "processing";
      els.tryOnResult.hidden = state.tryOnStep !== "result";
      if (state.tryOnStep === "result") {
        renderAngleTabs();
        renderResultImage();
        renderAddToCartState();
      }
    }

    function renderAngleTabs() {
      const angles = defaultAngleSet();
      els.angleTabs.innerHTML = "";
      angles.forEach((angle) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.angle = angle;
        btn.textContent = ANGLE_LABELS[angle] || angle;
        if (angle === state.activeAngle) btn.classList.add("active");
        const status = state.angleStatus[angle];
        if (status === "loading") appendTag(btn, "Generating");
        if (status === "queued") appendTag(btn, "Queued");
        if (status === "failed") appendTag(btn, "Retry later");
        btn.addEventListener("click", () => setActiveAngle(angle));
        els.angleTabs.appendChild(btn);
      });
    }

    function appendTag(btn, text) {
      const span = document.createElement("span");
      span.textContent = text;
      btn.appendChild(span);
    }

    function renderResultImage() {
      const imageUrl = state.resultImages[state.activeAngle];
      if (imageUrl) {
        els.resultImg.src = imageUrl;
        els.resultImg.hidden = false;
        els.angleLoading.hidden = true;
        els.resultDownloadBtn.hidden = false;
      } else {
        els.resultImg.hidden = true;
        els.angleLoading.hidden = false;
        els.resultDownloadBtn.hidden = true;
        els.angleLoadingLabel.textContent = `${ANGLE_LABELS[state.activeAngle] || state.activeAngle} view is generating`;
      }
    }

    function setActiveAngle(angle) {
      state.activeAngle = angle;
      renderAngleTabs();
      renderResultImage();
      if (state.activeTab === "spin") renderSpinPanel();
    }

    function slugify(text) {
      return (text || "try-on")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    }

    async function downloadFile(url, filename) {
      if (!url) return;
      try {
        if (url.startsWith("data:")) {
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
        // Likely a remote (e.g. cloud-hosted) file — fetch it as a blob so
        // the download attribute actually forces a save instead of just
        // navigating to it.
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      } catch {
        // CORS or network failure — fall back to opening it so the
        // shopper can still save it manually.
        window.open(url, "_blank");
      }
    }

    function handleShare() {
      const resultImage = state.resultImages[state.activeAngle];
      if (!resultImage) return;
      const url = resultImage.startsWith("http")
        ? resultImage
        : window.location.href;
      if (navigator.share) {
        navigator.share({
          title: "My AI Try On",
          text: `Try-on result for ${productTitle}.`,
          url,
        });
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
        window.alert("Result link copied.");
      }
    }

    async function handleAddToCart() {
      syncSelectedVariant();
      if (!state.available || !state.variantId || state.addingToCart) return;

      state.addingToCart = true;
      showError("");
      renderAddToCartState();

      try {
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            items: [{ id: state.variantId, quantity: 1 }],
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            (payload && payload.description) ||
              "Could not add this item to your cart.",
          );
        }

        // Let the theme's own cart drawer/count refresh itself if it's
        // listening for this; if nothing is, the reload below still
        // leaves the cart correctly updated.
        root.dispatchEvent(
          new CustomEvent("tryon:add-to-cart", {
            bubbles: true,
            detail: { productId, productTitle, variantId: state.variantId },
          }),
        );

        closeSheet();
        window.setTimeout(() => window.location.reload(), 200);
      } catch (err) {
        state.addingToCart = false;
        renderAddToCartState();
        showError(
          err.message ||
            "Could not add this item to your cart. Please try again.",
        );
      }
    }

    // --- Size & Fit panel ---

    els.sizefitBtn.addEventListener("click", handleSizeFit);

    async function handleSizeFit() {
      if (!requirePhoto()) return;
      els.sizefitBtn.disabled = true;
      els.sizefitBtn.textContent = "Checking fit...";
      els.sizefitResult.hidden = true;
      try {
        const res = await fetch(sizefitEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            Object.assign(
              { shop, productId },
              state.sampleImageUrl
                ? { sampleImageUrl: state.sampleImageUrl }
                : { imageDataUrl: state.uploadData },
            ),
          ),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.message || "Could not estimate size.");
        els.sizefitResult.hidden = false;
        els.sizefitResult.classList.remove(
          "tryon-sizefit-result--found",
          "tryon-sizefit-result--error",
        );
        if (data.needsSizeChart || !data.suggestedSize) {
          els.sizefitResult.textContent =
            data.note || "Check the product's size chart for this item.";
        } else {
          els.sizefitResult.classList.add("tryon-sizefit-result--found");
          els.sizefitResult.textContent = `Likely fits: ${data.suggestedSize} (${data.confidence} confidence). ${data.note}`;
        }
      } catch (err) {
        els.sizefitResult.hidden = false;
        els.sizefitResult.classList.add("tryon-sizefit-result--error");
        els.sizefitResult.textContent =
          err.message || "Could not estimate size right now.";
      } finally {
        els.sizefitBtn.disabled = false;
        els.sizefitBtn.textContent = "Get a size suggestion";
      }
    }

    // --- Spin View panel (reads the Try On result — doesn't generate its own) ---

    let dragStartX = null;

    function fullAngleList() {
      return (
        (state.categoryConfig && state.categoryConfig.angles) ||
        defaultAngleSet()
      );
    }

    function renderSpinPanel() {
      const hasResult = Object.keys(state.resultImages).length > 0;
      els.spinEmpty.hidden = hasResult;
      els.spinContent.hidden = !hasResult;
      if (!hasResult) return;
      const url =
        state.resultImages[state.activeAngle] ||
        Object.values(state.resultImages)[0];
      els.spinImg.src = url;
      els.spinImg.hidden = false;
      const canSpin = fullAngleList().length > defaultAngleSet().length;
      els.spinHint.hidden = !canSpin;
    }

    els.spinResultImage.onpointerdown = (e) => {
      dragStartX = e.clientX;
    };
    els.spinResultImage.onpointerup = (e) => {
      if (dragStartX === null) return;
      const delta = e.clientX - dragStartX;
      dragStartX = null;
      if (Math.abs(delta) < 40) return;
      stepSpin(delta < 0 ? 1 : -1);
    };

    function stepSpin(direction) {
      const angles = fullAngleList();
      const currentIndex = angles.indexOf(state.activeAngle);
      const nextIndex = Math.min(
        angles.length - 1,
        Math.max(0, currentIndex + direction),
      );
      const nextAngle = angles[nextIndex];
      if (nextAngle === state.activeAngle) return;

      state.activeAngle = nextAngle;
      if (
        !state.resultImages[nextAngle] &&
        state.angleStatus[nextAngle] !== "loading"
      ) {
        generateBackgroundAngle(nextAngle);
      }
      renderSpinPanel();
    }

    // --- Full Outfit panel ---

    els.outfitGenerateBtn.addEventListener("click", generateOutfit);
    els.outfitDownloadBtn.addEventListener("click", () => {
      if (!state.outfitImage) return;
      downloadFile(state.outfitImage, `${slugify(productTitle)}-outfit.jpg`);
    });

    async function generateOutfit() {
      if (!requirePhoto()) return;
      if (state.selectedCompanionIds.length === 0) {
        showError("Pick at least one item to complete the look.");
        return;
      }
      showError("");
      state.outfitStatus = "loading";
      renderOutfitPanel();
      try {
        const imageUrl = await generateAngle(
          "front",
          state.selectedCompanionIds,
        );
        state.outfitImage = imageUrl;
        state.outfitStatus = "ready";
      } catch (err) {
        state.outfitStatus = "failed";
        showError(err.message || "Could not generate the full outfit look.");
      }
      renderOutfitPanel();
    }

    function renderOutfitPanel() {
      els.outfitGenerateBtn.disabled = state.outfitStatus === "loading";
      els.outfitGenerateBtn.textContent =
        state.outfitStatus === "loading"
          ? "Generating..."
          : "Generate outfit look";
      els.outfitResultImage.hidden = state.outfitStatus !== "ready";
      els.outfitDownloadBtn.hidden = state.outfitStatus !== "ready";
      if (state.outfitStatus === "ready") {
        els.outfitResultImg.src = state.outfitImage;
        els.outfitResultImg.hidden = false;
      }
    }

    // --- Video panel (animates whichever still exists — Try On or Full Outfit) ---

    function sourceStillForVideo() {
      return (
        state.resultImages[state.activeAngle] ||
        Object.values(state.resultImages)[0] ||
        state.outfitImage ||
        null
      );
    }

    function renderVideoPanel() {
      const still = sourceStillForVideo();
      els.videoEmpty.hidden = !!still;
      els.videoContent.hidden = !still;
    }

    els.videoBtn.addEventListener("click", handleVideo);
    els.videoDownloadBtn.addEventListener("click", () => {
      if (!els.videoEl.src) return;
      downloadFile(els.videoEl.src, `${slugify(productTitle)}-video.mp4`);
    });

    async function handleVideo() {
      const stillImageDataUrl = sourceStillForVideo();
      if (!stillImageDataUrl) return;

      els.videoBtn.disabled = true;
      els.videoBtn.textContent = "Generating video...";
      try {
        const res = await fetch(videoEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop,
            productId,
            category: state.category,
            stillImageDataUrl,
            productTitle,
            shopifyCustomerId,
            anonymousId,
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.message || "Could not generate the video.");
        els.videoEl.src = data.videoUrl;
        els.videoWrap.hidden = false;
        els.videoDownloadBtn.hidden = false;
        els.videoBtn.hidden = true;
      } catch (err) {
        showError(err.message || "Could not generate the video right now.");
      } finally {
        els.videoBtn.disabled = false;
        els.videoBtn.textContent = "▶ Generate a short turn video";
      }
    }

    // --- Closet panel ---

    async function loadClosetPanel() {
      state.closetSelection = [];
      els.compareView.hidden = true;
      els.closetCompareBtn.hidden = true;
      try {
        const params = new URLSearchParams({
          shop,
          anonymousId,
          scope: "closet",
        });
        if (shopifyCustomerId)
          params.set("shopifyCustomerId", shopifyCustomerId);
        const res = await fetch(`${historyEndpoint}?${params.toString()}`);
        const data = await res.json();
        renderCloset(data.generations || []);
      } catch {
        renderCloset([]);
      }
    }

    function renderCloset(generations) {
      els.closetGrid.innerHTML = "";
      els.closetEmpty.hidden = generations.length > 0;
      generations.forEach((gen) => {
        const item = document.createElement("div");
        item.className = "tryon-closet-item";
        item.dataset.id = gen.id;
        if (gen.mediaType === "video") {
          const video = document.createElement("video");
          video.src = gen.imageUrl;
          video.muted = true;
          item.appendChild(video);
        } else {
          const img = document.createElement("img");
          img.src = gen.imageUrl;
          img.alt = "";
          item.appendChild(img);
        }
        item.addEventListener("click", () => toggleCompareSelection(item, gen));
        els.closetGrid.appendChild(item);
      });
    }

    function toggleCompareSelection(item, gen) {
      const idx = state.closetSelection.findIndex((g) => g.id === gen.id);
      if (idx > -1) {
        state.closetSelection.splice(idx, 1);
        item.classList.remove("selected");
      } else {
        if (state.closetSelection.length >= 2) {
          const removedId = state.closetSelection.shift().id;
          const removedEl = els.closetGrid.querySelector(
            `[data-id="${removedId}"]`,
          );
          if (removedEl) removedEl.classList.remove("selected");
        }
        state.closetSelection.push(gen);
        item.classList.add("selected");
      }
      els.closetCompareBtn.hidden = state.closetSelection.length < 2;
      els.compareView.hidden = true;
    }

    els.closetCompareBtn.addEventListener("click", () => {
      els.compareView.innerHTML = "";
      state.closetSelection.forEach((gen) => {
        const img = document.createElement("img");
        img.src = gen.imageUrl;
        img.alt = "";
        els.compareView.appendChild(img);
      });
      els.compareView.hidden = false;
    });

    // --- Initial render (before first open — harmless, sheet is closed) ---
    switchTab(state.activeTab);
  }
})();
