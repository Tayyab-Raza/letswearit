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

    let companions = [];
    try {
      const raw = root.querySelector("[data-tryon-companions]");
      companions = raw ? JSON.parse(raw.textContent || "[]") : [];
    } catch {
      companions = [];
    }

    const els = {
      cta: root.querySelector("[data-tryon-open]"),
      closetOpenBtn: root.querySelector("[data-tryon-closet-open]"),
      overlay: root.querySelector("[data-tryon-overlay]"),
      sheet: root.querySelector("[data-tryon-sheet]"),
      close: root.querySelector("[data-tryon-close]"),
      primary: root.querySelector("[data-tryon-primary]"),
      steps: {
        intro: root.querySelector('[data-step="intro"]'),
        upload: root.querySelector('[data-step="upload"]'),
        processing: root.querySelector('[data-step="processing"]'),
        result: root.querySelector('[data-step="result"]'),
      },
      historyBanner: root.querySelector("[data-tryon-history-banner]"),
      historyBannerImg: root.querySelector("[data-tryon-history-banner-img]"),
      historyBannerText: root.querySelector("[data-tryon-history-banner-text]"),
      photoGood: root.querySelector("[data-tryon-photo-good]"),
      photoBad: root.querySelector("[data-tryon-photo-bad]"),
      uploadTitle: root.querySelector("[data-tryon-upload-title]"),
      uploadNote: root.querySelector("[data-tryon-upload-note]"),
      outfitPicker: root.querySelector("[data-tryon-outfit-picker]"),
      outfitLock: root.querySelector("[data-tryon-outfit-lock]"),
      outfitChips: root.querySelector("[data-tryon-outfit-chips]"),
      uploadBox: root.querySelector("[data-tryon-upload-box]"),
      uploadPreview: root.querySelector("[data-tryon-upload-preview]"),
      uploadPlaceholder: root.querySelector("[data-tryon-upload-placeholder]"),
      fileInput: root.querySelector("[data-tryon-file-input]"),
      error: root.querySelector("[data-tryon-error]"),
      sampleBtn: root.querySelector("[data-tryon-sample]"),
      demoNote: root.querySelector("[data-tryon-demo-note]"),
      sizefitWrap: root.querySelector("[data-tryon-sizefit-wrap]"),
      sizefitBtn: root.querySelector("[data-tryon-sizefit-btn]"),
      sizefitResult: root.querySelector("[data-tryon-sizefit-result]"),
      angleTabs: root.querySelector("[data-tryon-angle-tabs]"),
      resultImage: root.querySelector("[data-tryon-result-image]"),
      spinViewer: root.querySelector("[data-tryon-spin-viewer]"),
      spinHint: root.querySelector("[data-tryon-spin-hint]"),
      resultImg: root.querySelector("[data-tryon-result-img]"),
      angleLoading: root.querySelector("[data-tryon-angle-loading]"),
      angleLoadingLabel: root.querySelector("[data-tryon-angle-loading-label]"),
      shareBtn: root.querySelector("[data-tryon-share]"),
      videoBtn: root.querySelector("[data-tryon-video-btn]"),
      videoLock: root.querySelector("[data-tryon-video-lock]"),
      videoWrap: root.querySelector("[data-tryon-video-wrap]"),
      videoEl: root.querySelector("[data-tryon-video-el]"),
      closetDrawer: root.querySelector("[data-tryon-closet-drawer]"),
      closetOverlay: root.querySelector("[data-tryon-closet-overlay]"),
      closetGrid: root.querySelector("[data-tryon-closet-grid]"),
      closetEmpty: root.querySelector("[data-tryon-closet-empty]"),
      closetCompareBtn: root.querySelector("[data-tryon-closet-compare]"),
      compareView: root.querySelector("[data-tryon-compare-view]"),
    };

    const state = {
      step: "intro",
      uploadData: "",
      sampleImageUrl: "",
      resultImages: {},
      angleStatus: {},
      activeAngle: "front",
      features: [],
      category: null,
      categoryConfig: null,
      selectedCompanionIds: [],
      closetSelection: [],
    };

    function hasFeature(key) {
      return state.features.includes(key);
    }

    // --- Setup fetches (run in parallel on first open) ---

    async function loadFeatures() {
      try {
        const res = await fetch(
          `${featuresEndpoint}?shop=${encodeURIComponent(shop)}`,
        );
        const data = await res.json();
        state.features = data.features || [];
      } catch {
        state.features = [];
      }
      els.closetOpenBtn.hidden = !hasFeature("closet");
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

      const showOutfitPicker =
        companions.length > 0 && state.category === "outfit";
      els.outfitPicker.hidden = !showOutfitPicker;
      if (showOutfitPicker) {
        els.outfitLock.hidden = hasFeature("full_outfit");
        renderOutfitChips();
      }

      const showVideoBtn = state.step === "result";
      els.videoLock.hidden = hasFeature("video_tryon");
      if (showVideoBtn) els.videoBtn.hidden = false;
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
          if (!hasFeature("full_outfit")) {
            showError("Full outfit try-on is available on a higher plan.");
            return;
          }
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
            state.step = "result";
            render();
          };
        } else {
          els.historyBanner.hidden = true;
        }
      } catch {
        els.historyBanner.hidden = true;
      }
    }

    // --- Standard open/close ---

    els.cta.addEventListener("click", openSheet);
    els.overlay.addEventListener("click", closeSheet);
    els.close.addEventListener("click", closeSheet);
    els.uploadBox.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFileChange);
    els.sampleBtn.addEventListener("click", useSamplePhoto);
    els.primary.addEventListener("click", handlePrimary);
    els.shareBtn.addEventListener("click", handleShare);
    els.sizefitBtn.addEventListener("click", handleSizeFit);
    els.videoBtn.addEventListener("click", handleVideo);
    els.closetOpenBtn.addEventListener("click", openCloset);
    els.closetOverlay.addEventListener("click", closeCloset);

    let setupLoaded = false;
    async function openSheet() {
      state.step = "intro";
      showError("");
      els.overlay.hidden = false;
      els.sheet.classList.add("open");
      els.sheet.setAttribute("aria-hidden", "false");
      render();

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
      els.sizefitWrap.hidden = false;
      updatePrimaryState();
    }

    function useSamplePhoto() {
      showError("");
      els.uploadPreview.src = samplePhotoUrl;
      els.uploadPreview.hidden = false;
      els.uploadPlaceholder.hidden = true;
      state.uploadData = "sample";
      state.sampleImageUrl = samplePhotoUrl;
      els.sizefitWrap.hidden = false;
      updatePrimaryState();
    }

    // --- Size & fit (basic-plan feature) ---

    async function handleSizeFit() {
      if (!state.uploadData) return;
      els.sizefitBtn.disabled = true;
      els.sizefitBtn.textContent = "Checking fit...";
      els.sizefitResult.hidden = true;
      try {
        const res = await fetch(sizefitEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop,
            productId,
            imageDataUrl: state.sampleImageUrl ? null : state.uploadData,
          }),
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

    // --- Generation ---

    async function generateAngle(angle) {
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
              companionProductIds: state.selectedCompanionIds,
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

    async function generateBackgroundAngle(angle) {
      state.angleStatus[angle] = "loading";
      renderAngleTabs();
      try {
        const imageUrl = await generateAngle(angle);
        state.resultImages[angle] = imageUrl;
        state.angleStatus[angle] = "ready";
      } catch (err) {
        state.angleStatus[angle] = "failed";
      }
      renderAngleTabs();
      if (state.activeAngle === angle) renderResultImage();
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
      if (!state.uploadData) {
        els.fileInput.click();
        return;
      }

      const angles = defaultAngleSet();
      state.step = "processing";
      showError("");
      state.activeAngle = angles[0];
      state.resultImages = {};
      state.angleStatus = {};
      angles.forEach(
        (a, i) => (state.angleStatus[a] = i === 0 ? "loading" : "queued"),
      );
      render();

      try {
        const firstUrl = await generateAngle(angles[0]);
        state.resultImages[angles[0]] = firstUrl;
        state.angleStatus[angles[0]] = "ready";
        angles.slice(1).forEach((a) => (state.angleStatus[a] = "loading"));
        state.step = "result";
        render();
        angles.slice(1).forEach((a, i) => {
          window.setTimeout(() => generateBackgroundAngle(a), (i + 1) * 900);
        });
      } catch (err) {
        state.step = "result";
        state.resultImages = {};
        angles.forEach((a) => (state.angleStatus[a] = "failed"));
        showResultError(
          err.message ||
            "We could not generate this try-on. Please try another photo.",
        );
        render();
      }
    }

    function showResultError(message) {
      els.demoNote.hidden = false;
      els.demoNote.textContent = message;
    }

    function handlePrimary() {
      if (state.step === "intro") {
        state.step = "upload";
        render();
        return;
      }
      if (state.step === "upload") {
        generateTryOn();
        return;
      }
      if (state.step === "result") {
        closeSheet();
        window.setTimeout(() => {
          const event = new CustomEvent("tryon:add-to-cart", {
            detail: { productId, productTitle },
          });
          root.dispatchEvent(event);
        }, 250);
      }
    }

    async function handleShare() {
      const resultImage = state.resultImages[state.activeAngle];
      if (!resultImage) return;
      const url = resultImage.startsWith("http")
        ? resultImage
        : window.location.href;
      if (navigator.share) {
        await navigator.share({
          title: "My AI Try On",
          text: `Try-on result for ${productTitle}.`,
          url,
        });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        window.alert("Result link copied.");
      }
    }

    // --- Angle tabs (default set only — extra angles live behind the spin drag) ---

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
      } else {
        els.resultImg.hidden = true;
        els.angleLoading.hidden = false;
        els.angleLoadingLabel.textContent = `${ANGLE_LABELS[state.activeAngle] || state.activeAngle} view is generating`;
      }
    }

    function setActiveAngle(angle) {
      state.activeAngle = angle;
      renderAngleTabs();
      renderResultImage();
    }

    // --- Multi-angle spin viewer (higher-tier feature) ---

    let dragStartX = null;

    function fullAngleList() {
      return (
        (state.categoryConfig && state.categoryConfig.angles) ||
        defaultAngleSet()
      );
    }

    function initSpinViewer() {
      const canSpin =
        hasFeature("multi_angle_spin") &&
        fullAngleList().length > defaultAngleSet().length;
      els.spinHint.hidden = !canSpin;
      if (!canSpin) return;

      els.spinViewer.onpointerdown = (e) => {
        dragStartX = e.clientX;
      };
      els.spinViewer.onpointerup = (e) => {
        if (dragStartX === null) return;
        const delta = e.clientX - dragStartX;
        dragStartX = null;
        if (Math.abs(delta) < 40) return;
        stepSpin(delta < 0 ? 1 : -1);
      };
    }

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
      renderResultImage();
      renderAngleTabs();
    }

    // --- Video try-on (top-tier feature) ---

    async function handleVideo() {
      if (!hasFeature("video_tryon")) {
        showResultError("Video try-on is available on the top plan.");
        return;
      }
      const stillImageDataUrl = state.resultImages[state.activeAngle];
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
        els.videoBtn.hidden = true;
      } catch (err) {
        showResultError(
          err.message || "Could not generate the video right now.",
        );
      } finally {
        els.videoBtn.disabled = false;
        els.videoBtn.textContent = "▶ Generate a short turn video";
      }
    }

    // --- Closet / compare drawer ---

    async function openCloset() {
      els.closetDrawer.classList.add("open");
      els.closetDrawer.setAttribute("aria-hidden", "false");
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

    function closeCloset() {
      els.closetDrawer.classList.remove("open");
      els.closetDrawer.setAttribute("aria-hidden", "true");
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

    // --- Render ---

    function updatePrimaryState() {
      els.primary.disabled =
        state.step === "processing" ||
        (state.step === "upload" && !state.uploadData);
      const labels = {
        intro: "Start Try On",
        upload: state.uploadData ? "Generate Look" : "Upload Photo",
        processing: "Generating...",
        result: "Add to Cart",
      };
      els.primary.textContent = labels[state.step] || "Try Again";
    }

    function render() {
      Object.keys(els.steps).forEach((key) => {
        els.steps[key].hidden = key !== state.step;
      });
      if (state.step === "upload") applyCategoryUi();
      if (state.step === "result") {
        renderAngleTabs();
        renderResultImage();
        initSpinViewer();
        els.videoBtn.hidden = false;
        els.videoLock.hidden = hasFeature("video_tryon");
        els.videoWrap.hidden = true;
      }
      updatePrimaryState();
    }

    render();
  }
})();
