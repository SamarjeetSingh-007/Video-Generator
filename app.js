/* app.js — UI controller + Job_Manager. Ties together Key_Manager, Providers,
 * Model_Catalog, Prompt_Editor, Generation_Options, jobs, project, assembly. */

(function () {
  "use strict";

  const POLL_TIMEOUT_MS = 300000; // 300s default (req 7)
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const OK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_SEGMENTS = 20;

  // ---- App state ----
  const state = {
    providerId: null,
    models: [],
    selectedModel: null,
    images: [],            // { file, url }
    options: { aspect: null, resolution: null, length: null },
    segments: [],          // { id, blob, url, aspect, resolution, length, label }
    job: null,             // { controller, timeoutId, tickId, timedOut, cancelled }
    assembled: null        // { blob, url }
  };

  // ---- Element shortcuts ----
  const $ = (id) => document.getElementById(id);
  let autoSaveTimer = null;
  const els = {};
  ["providerSelect","providerDocs","apiKeyInput","revealKeyBtn","saveKeyBtn","clearKeyBtn",
   "keyStatus","fetchModelsBtn","modelsLoading","modelMessage","modelList","inputGuard","proxyInput","endpointInput","endpointHint",
   "textInputWrap","promptInput","promptCount","imageInputWrap","dropZone","imageFile","thumbs",
   "imgCount","aspectOptions","resolutionOptions","lengthOptions","generateBtn","cancelBtn",
   "genMessage","jobProgress","jobStatusText","jobElapsed","segmentList","assembleBtn",
   "assembleMessage","assembledWrap","assembledVideo","downloadAssembledBtn",
   "helpBtn","helpModal","closeHelpBtn","helpContent"].forEach(id => els[id] = $(id));

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  // ---- Provider selection (req 2) ----
  function initProviders() {
    Object.values(PROVIDERS).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      els.providerSelect.appendChild(opt);
    });
    const saved = StateStore.read();
    const initial = (saved.providerId && PROVIDERS[saved.providerId]) ? saved.providerId : Object.keys(PROVIDERS)[0];
    els.providerSelect.value = initial;
    selectProvider(initial);
  }

  function selectProvider(id) {
    state.providerId = id;
    StateStore.patch({ providerId: id });
    const p = PROVIDERS[id];
    els.providerDocs.innerHTML = p.docs +
      (p.keyUrl ? ' <a href="' + p.keyUrl + '" target="_blank" rel="noopener">Get a key →</a>' : "") +
      '<br><span class="muted">' + p.keyHint + "</span>";
    // Load any saved endpoint override for this provider.
    const overrides = StateStore.read().endpointOverrides || {};
    els.endpointInput.value = overrides[id] || "";
    els.endpointHint.textContent = "Default: " + p.endpoint;
    // Load stored key for this provider
    const key = KeyManager.get(id);
    els.apiKeyInput.value = key;
    if (KeyManager.has(id)) {
      setStatus(els.keyStatus, "✓ Saved key loaded. Provider ready.", "ok");
    } else {
      setStatus(els.keyStatus, "No key stored for this provider. Paste one and Save.", "muted");
    }
    // Reset catalog/model when provider changes
    state.models = [];
    state.selectedModel = null;
    els.modelList.innerHTML = "";
    setStatus(els.modelMessage, "");
    refreshInputAvailability();
    updateGenerateEnabled();
  }

  // ---- Key manager (req 1) ----
  function saveKey() {
    const res = KeyManager.save(state.providerId, els.apiKeyInput.value);
    if (res.ok) {
      setStatus(els.keyStatus, "✓ Key saved for " + PROVIDERS[state.providerId].label + ".", "ok");
    } else {
      setStatus(els.keyStatus, res.error, "error");
    }
  }
  function clearKey() {
    KeyManager.remove(state.providerId);
    els.apiKeyInput.value = "";
    setStatus(els.keyStatus, "Saved key removed.", "muted");
  }
  function toggleReveal() {
    els.apiKeyInput.type = els.apiKeyInput.type === "password" ? "text" : "password";
  }

  // ---- Model catalog (req 3) + selection (req 4) ----
  async function fetchModels() {
    const id = state.providerId;
    const key = els.apiKeyInput.value.trim() || KeyManager.get(id);
    if (!id) { setStatus(els.modelMessage, "Select a provider first.", "error"); return; }
    if (!key) { setStatus(els.modelMessage, "A provider and API key are required to fetch models.", "error"); return; }

    els.modelsLoading.classList.remove("hidden");
    setStatus(els.modelMessage, "");
    els.fetchModelsBtn.disabled = true;
    try {
      const { models } = await withTimeout(Providers.listModels(id, key), 30000);
      state.models = models || [];
      if (!state.models.length) {
        setStatus(els.modelMessage, "No models are available for this provider.", "warn");
      } else {
        setStatus(els.modelMessage, state.models.length + " model(s) available. Pick one.", "ok");
      }
      renderModels();
    } catch (err) {
      if (err instanceof AuthError) {
        setStatus(els.modelMessage, "Your API key was rejected. Check the key and retry.", "error");
      } else {
        setStatus(els.modelMessage, "Could not load models: " + err.message + ". Retry?", "error");
      }
      els.modelList.innerHTML = "";
    } finally {
      els.modelsLoading.classList.add("hidden");
      els.fetchModelsBtn.disabled = false;
    }
  }

  function capTag(label, value) {
    if (value === null || value === undefined) return '<span class="cap-tag unspec">' + label + ": unspecified</span>";
    if (value === true) return '<span class="cap-tag on">' + label + "</span>";
    if (value === false) return '<span class="cap-tag">no ' + label + "</span>";
    if (Array.isArray(value)) return '<span class="cap-tag">' + label + ": " + value.join("/") + "</span>";
    return '<span class="cap-tag">' + label + ": " + value + "</span>";
  }

  function renderModels() {
    els.modelList.innerHTML = "";
    state.models.forEach(m => {
      const card = document.createElement("div");
      card.className = "model-card" + (state.selectedModel && state.selectedModel.id === m.id ? " selected" : "");
      const caps = [
        m.text === true ? '<span class="cap-tag on">text→video</span>' : (m.text === false ? '<span class="cap-tag">no text</span>' : '<span class="cap-tag unspec">text: unspecified</span>'),
        m.image === true ? '<span class="cap-tag on">image→video</span>' : (m.image === false ? '<span class="cap-tag">no image</span>' : '<span class="cap-tag unspec">image: unspecified</span>'),
        capTag("res", m.resolutions),
        capTag("len(s)", m.lengths),
        capTag("ratio", m.aspects)
      ].join("");
      card.innerHTML = '<div class="model-name">' + m.name + '</div>' +
        '<div class="muted" style="font-size:11px;word-break:break-all">' + m.id + '</div>' +
        '<div class="caps">' + caps + '</div>';
      card.addEventListener("click", () => selectModel(m));
      els.modelList.appendChild(card);
    });
  }

  function selectModel(m) {
    const prev = state.selectedModel;
    state.selectedModel = m;
    renderModels();

    // Remove incompatible inputs (req 4.6)
    const removed = [];
    if (m.image === false && state.images.length) {
      removed.push(state.images.length + " image(s)");
      clearImages();
    }
    if (m.text === false && els.promptInput.value) {
      removed.push("text prompt");
      els.promptInput.value = "";
      updatePromptCount();
    }
    refreshInputAvailability();
    setupOptionsForModel();
    if (removed.length) {
      setStatus(els.genMessage, "Removed inputs unsupported by this model: " + removed.join(", ") + ".", "warn");
    } else {
      setStatus(els.genMessage, "");
    }
    updateGenerateEnabled();
  }

  function refreshInputAvailability() {
    const m = state.selectedModel;
    if (!m) {
      els.inputGuard.classList.remove("hidden");
      els.textInputWrap.classList.add("disabled");
      els.imageInputWrap.classList.add("disabled");
      return;
    }
    els.inputGuard.classList.add("hidden");
    // text: enabled when true or unspecified
    els.textInputWrap.classList.toggle("disabled", m.text === false);
    els.imageInputWrap.classList.toggle("disabled", m.image === false);
  }

  // ---- Generation options (req 6) ----
  function supports(model, kind, value) {
    const arr = model && model[kind];
    if (!arr) return true; // unspecified => allow
    return arr.indexOf(value) !== -1;
  }

  function buildChips(container, items, kind, getId, getLabel) {
    container.innerHTML = "";
    items.forEach(item => {
      const id = getId(item);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = getLabel(item);
      const ok = !state.selectedModel || supports(state.selectedModel, kind, id);
      chip.disabled = !ok;
      if (state.options[chipKey(kind)] === id) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        if (chip.disabled) return;
        state.options[chipKey(kind)] = id;
        buildAllChips();
        updateGenerateEnabled();
      });
      container.appendChild(chip);
    });
  }

  function chipKey(kind) {
    return kind === "aspects" ? "aspect" : kind === "resolutions" ? "resolution" : "length";
  }

  function buildAllChips() {
    buildChips(els.aspectOptions, ASPECT_RATIOS, "aspects", x => x.id, x => x.label);
    buildChips(els.resolutionOptions, RESOLUTIONS, "resolutions", x => x.id, x => x.label);
    buildChips(els.lengthOptions, CLIP_LENGTHS, "lengths", x => x.id, x => x.label);
  }

  function firstSupported(model, kind, items, getId) {
    for (const it of items) {
      if (supports(model, kind, getId(it))) return getId(it);
    }
    return getId(items[0]);
  }

  function setupOptionsForModel() {
    const m = state.selectedModel;
    // default to supported values (req 6.4); replace unsupported current values (req 6.6)
    if (!m || !supports(m, "aspects", state.options.aspect))
      state.options.aspect = firstSupported(m, "aspects", ASPECT_RATIOS, x => x.id);
    if (!m || !supports(m, "resolutions", state.options.resolution))
      state.options.resolution = firstSupported(m, "resolutions", RESOLUTIONS, x => x.id);
    if (!m || !supports(m, "lengths", state.options.length))
      state.options.length = firstSupported(m, "lengths", CLIP_LENGTHS, x => x.id);
    buildAllChips();
  }

  // ---- Prompt + images (req 5) ----
  function updatePromptCount() {
    els.promptCount.textContent = els.promptInput.value.length + " / 5000";
  }

  function addImages(fileList) {
    if (state.selectedModel && state.selectedModel.image === false) return;
    const files = Array.from(fileList);
    for (const f of files) {
      if (state.images.length >= MAX_IMAGES) {
        setStatus(els.genMessage, "Rejected: maximum of " + MAX_IMAGES + " reference images.", "error");
        break;
      }
      if (OK_IMAGE_TYPES.indexOf(f.type) === -1) {
        setStatus(els.genMessage, "Rejected '" + (f.name || "image") + "': only JPEG, PNG, WebP allowed.", "error");
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setStatus(els.genMessage, "Rejected '" + (f.name || "image") + "': exceeds 10 MB.", "error");
        continue;
      }
      const url = URL.createObjectURL(f);
      state.images.push({ file: f, url });
    }
    renderThumbs();
    updateGenerateEnabled();
  }

  function renderThumbs() {
    els.thumbs.innerHTML = "";
    state.images.forEach((img, i) => {
      const d = document.createElement("div");
      d.className = "thumb";
      d.innerHTML = '<img src="' + img.url + '" alt="reference ' + (i + 1) + '" />' +
        '<button type="button" title="Remove">✕</button>';
      d.querySelector("button").addEventListener("click", () => {
        URL.revokeObjectURL(img.url);
        state.images.splice(i, 1);
        renderThumbs();
        updateGenerateEnabled();
      });
      els.thumbs.appendChild(d);
    });
    els.imgCount.textContent = state.images.length + " / " + MAX_IMAGES;
  }

  function clearImages() {
    state.images.forEach(img => URL.revokeObjectURL(img.url));
    state.images = [];
    renderThumbs();
  }

  // ---- Validation + generate enabling ----
  function missingRequiredInputs() {
    const m = state.selectedModel;
    if (!m) return ["a selected model"];
    const missing = [];
    const hasText = els.promptInput.value.trim().length > 0;
    const hasImage = state.images.length > 0;
    // If model supports only one kind, that kind is required.
    if (m.text === true && m.image !== true && !hasText) missing.push("a text prompt");
    if (m.image === true && m.text !== true && !hasImage) missing.push("at least one reference image");
    // If it supports both/unspecified, require at least one of them.
    if ((m.text !== false) && (m.image !== false) && !hasText && !hasImage) {
      missing.push("a prompt or a reference image");
    }
    return missing;
  }

  function updateGenerateEnabled() {
    const ready = state.providerId && (els.apiKeyInput.value.trim() || KeyManager.has(state.providerId))
      && els.proxyInput.value.trim()
      && state.selectedModel && missingRequiredInputs().length === 0 && !state.job;
    els.generateBtn.disabled = !ready;
  }

  // ---- Job manager (req 7) ----
  async function generate() {
    setStatus(els.genMessage, "");
    const key = els.apiKeyInput.value.trim() || KeyManager.get(state.providerId);
    if (!key) { setStatus(els.genMessage, "A provider API key is required.", "error"); return; }
    if (!els.proxyInput.value.trim()) {
      setStatus(els.genMessage, "Set your Proxy URL first — see ‘Where do I get a free key?’ for the 1-time Worker setup.", "error");
      return;
    }
    const missing = missingRequiredInputs();
    if (missing.length) { setStatus(els.genMessage, "Missing: " + missing.join(", ") + ".", "error"); return; }
    if (state.segments.length >= MAX_SEGMENTS) {
      setStatus(els.genMessage, "Project is full (max " + MAX_SEGMENTS + " segments).", "error"); return;
    }

    const opt = state.options;
    if (!supports(state.selectedModel, "aspects", opt.aspect) ||
        !supports(state.selectedModel, "resolutions", opt.resolution) ||
        !supports(state.selectedModel, "lengths", opt.length)) {
      setStatus(els.genMessage, "Selected options are not supported by this model.", "error"); return;
    }

    const dims = dimsFor(opt.aspect, opt.resolution);
    const req = {
      modelId: state.selectedModel.id,
      prompt: els.promptInput.value.trim(),
      images: state.images.map(i => i.file),
      aspect: opt.aspect, resolution: opt.resolution, length: opt.length, dims
    };

    const controller = new AbortController();
    const startTime = Date.now();
    state.job = { controller, timedOut: false, cancelled: false };

    state.job.timeoutId = setTimeout(() => {
      state.job.timedOut = true;
      controller.abort();
    }, POLL_TIMEOUT_MS);

    els.jobProgress.classList.remove("hidden");
    els.cancelBtn.classList.remove("hidden");
    setJobStatus("submitted");
    state.job.tickId = setInterval(() => {
      els.jobElapsed.textContent = Math.round((Date.now() - startTime) / 1000) + "s elapsed";
    }, 1000);
    updateGenerateEnabled();

    try {
      const blob = await Providers.generate(state.providerId, key, req, {
        signal: controller.signal,
        onStatus: setJobStatus
      });
      addSegment(blob, req);
      setStatus(els.genMessage, "✓ Clip ready and added to your project.", "ok");
    } catch (err) {
      if (err.name === "AbortError") {
        if (state.job.timedOut) {
          setStatus(els.genMessage, "Timed out after " + (POLL_TIMEOUT_MS / 1000) + "s. Retry?", "error");
        } else {
          setStatus(els.genMessage, "Generation cancelled.", "muted");
        }
      } else if (err instanceof AuthError) {
        setStatus(els.genMessage, "API key rejected. Fix the key and retry.", "error");
      } else if (isNetworkError(err)) {
        setStatus(els.genMessage,
          "Network/CORS block: the request didn't reach the provider. Check that your Proxy URL is correct and the Worker is deployed.",
          "error");
      } else {
        setStatus(els.genMessage, "Generation failed: " + err.message + ". Retry?", "error");
      }
    } finally {
      endJob();
    }
  }

  function setJobStatus(text) {
    els.jobStatusText.textContent = text;
  }

  function endJob() {
    if (state.job) {
      clearTimeout(state.job.timeoutId);
      clearInterval(state.job.tickId);
    }
    state.job = null;
    els.jobProgress.classList.add("hidden");
    els.cancelBtn.classList.add("hidden");
    updateGenerateEnabled();
  }

  function cancelJob() {
    if (state.job) { state.job.cancelled = true; state.job.controller.abort(); }
  }

  // ---- Project / segments (req 8) ----
  function addSegment(blob, req) {
    const url = URL.createObjectURL(blob);
    state.segments.push({
      id: "seg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      blob, url,
      aspect: req.aspect, resolution: req.resolution, length: req.length,
      dims: req.dims,
      label: req.prompt ? req.prompt.slice(0, 40) : "image clip"
    });
    renderSegments();
  }

  function renderSegments() {
    els.segmentList.innerHTML = "";
    state.segments.forEach((s, i) => {
      const card = document.createElement("div");
      card.className = "segment-card";
      card.innerHTML =
        '<video src="' + s.url + '" muted controls preload="metadata"></video>' +
        '<div class="segment-meta">' +
          '<div class="seg-title">#' + (i + 1) + " · " + escapeHtml(s.label) + '</div>' +
          '<div>' + s.aspect + " · " + s.resolution + " · " + s.length + 's</div>' +
        '</div>' +
        '<div class="segment-actions">' +
          '<button data-act="up" ' + (i === 0 ? "disabled" : "") + '>↑</button>' +
          '<button data-act="down" ' + (i === state.segments.length - 1 ? "disabled" : "") + '>↓</button>' +
          '<button data-act="dl">⬇</button>' +
          '<button data-act="rm">✕</button>' +
        '</div>';
      card.querySelector('[data-act="up"]').addEventListener("click", () => moveSegment(i, -1));
      card.querySelector('[data-act="down"]').addEventListener("click", () => moveSegment(i, 1));
      card.querySelector('[data-act="dl"]').addEventListener("click", () => downloadBlob(s.blob, "clip-" + (i + 1) + ".mp4"));
      card.querySelector('[data-act="rm"]').addEventListener("click", () => removeSegment(i));
      els.segmentList.appendChild(card);
    });
    els.assembleBtn.disabled = state.segments.length < 2;
    updateGenerateEnabled();
  }

  function moveSegment(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= state.segments.length) return;
    const tmp = state.segments[i];
    state.segments[i] = state.segments[j];
    state.segments[j] = tmp;
    renderSegments();
  }

  function removeSegment(i) {
    URL.revokeObjectURL(state.segments[i].url);
    state.segments.splice(i, 1);
    renderSegments();
  }

  // ---- Assembly (req 8.5–8.9) ----
  async function assemble() {
    if (state.segments.length < 2) {
      setStatus(els.assembleMessage, "At least two segments are required to stitch.", "error");
      return;
    }
    // Mismatch check (req 8.8)
    const first = state.segments[0];
    const mismatch = state.segments.some(s => s.aspect !== first.aspect || s.resolution !== first.resolution);
    if (mismatch) {
      const ok = window.confirm(
        "Your segments have different resolution or aspect ratio. They will be scaled/padded to match the first clip (" +
        first.aspect + " · " + first.resolution + "). Continue?"
      );
      if (!ok) { setStatus(els.assembleMessage, "Assembly cancelled due to mismatch.", "muted"); return; }
    }

    els.assembleBtn.disabled = true;
    try {
      const blob = await Assembler.assemble(
        state.segments,
        first.dims || dimsFor(first.aspect, first.resolution),
        (t) => setStatus(els.assembleMessage, t, "muted")
      );
      if (state.assembled) URL.revokeObjectURL(state.assembled.url);
      const url = URL.createObjectURL(blob);
      state.assembled = { blob, url };
      els.assembledVideo.src = url;
      els.assembledWrap.classList.remove("hidden");
      setStatus(els.assembleMessage, "✓ Final video ready.", "ok");
    } catch (err) {
      setStatus(els.assembleMessage, "Assembly failed: " + err.message + ". Your segments are unchanged.", "error");
    } finally {
      els.assembleBtn.disabled = state.segments.length < 2;
    }
  }

  // ---- Download (req 9) ----
  function downloadBlob(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setStatus(els.assembleMessage, "Download could not be started.", "error");
    }
  }

  // Detects browser CORS / network failures (no HTTP status reaches JS).
  function isNetworkError(err) {
    if (!err) return false;
    if (err.name === "TypeError") return true; // Chrome "Failed to fetch"
    const m = (err.message || "").toLowerCase();
    return m.indexOf("failed to fetch") !== -1 ||
           m.indexOf("networkerror") !== -1 ||
           m.indexOf("load failed") !== -1 ||
           m.indexOf("cors") !== -1;
  }

  function escapeHtml(s) {    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- generic timeout wrapper for catalog (req 3.1) ----
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("request timed out after " + (ms / 1000) + "s")), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  // ---- Wire events ----
  function wire() {
    els.providerSelect.addEventListener("change", e => selectProvider(e.target.value));
    els.saveKeyBtn.addEventListener("click", saveKey);
    els.clearKeyBtn.addEventListener("click", clearKey);
    els.revealKeyBtn.addEventListener("click", toggleReveal);
    els.apiKeyInput.addEventListener("input", () => {
      updateGenerateEnabled();
      // Auto-save (debounced) so you never have to click Save.
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        const v = els.apiKeyInput.value.trim();
        if (!v) return;
        const res = KeyManager.save(state.providerId, v);
        if (res.ok) setStatus(els.keyStatus, "✓ Key saved automatically for this device.", "ok");
        else setStatus(els.keyStatus, res.error, "error");
      }, 700);
    });
    els.fetchModelsBtn.addEventListener("click", fetchModels);

    els.promptInput.addEventListener("input", () => { updatePromptCount(); updateGenerateEnabled(); });

    els.dropZone.addEventListener("click", () => els.imageFile.click());
    els.dropZone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") els.imageFile.click(); });
    els.imageFile.addEventListener("change", e => { addImages(e.target.files); e.target.value = ""; });
    ["dragover", "dragenter"].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.remove("drag"); }));
    els.dropZone.addEventListener("drop", e => { if (e.dataTransfer.files.length) addImages(e.dataTransfer.files); });
    document.addEventListener("paste", e => {
      if (!state.selectedModel || state.selectedModel.image === false) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = [];
      for (const it of items) if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) files.push(f); }
      if (files.length) addImages(files);
    });

    els.generateBtn.addEventListener("click", generate);
    els.cancelBtn.addEventListener("click", cancelJob);
    els.assembleBtn.addEventListener("click", assemble);
    els.downloadAssembledBtn.addEventListener("click", () => {
      if (state.assembled) downloadBlob(state.assembled.blob, "final-ad.mp4");
    });

    els.helpBtn.addEventListener("click", () => { els.helpContent.innerHTML = FREE_KEY_GUIDE; els.helpModal.classList.remove("hidden"); });
    els.closeHelpBtn.addEventListener("click", () => els.helpModal.classList.add("hidden"));
    els.helpModal.addEventListener("click", e => { if (e.target === els.helpModal) els.helpModal.classList.add("hidden"); });
  }

  // ---- Boot ----
  function boot() {
    if (!KeyManager.available()) {
      setStatus(els.keyStatus, "Browser storage is unavailable; keys can't be saved between sessions.", "warn");
    }
    // Restore + wire the proxy URL (needed by both providers).
    const savedProxy = StateStore.read().proxyUrl || "";
    els.proxyInput.value = savedProxy;
    Providers.setProxy(savedProxy);
    els.proxyInput.addEventListener("input", () => {
      const v = els.proxyInput.value.trim();
      Providers.setProxy(v);
      StateStore.patch({ proxyUrl: v });
      updateGenerateEnabled();
    });

    // Restore endpoint overrides; save per-provider as the user edits.
    Providers.endpointOverrides = StateStore.read().endpointOverrides || {};
    els.endpointInput.addEventListener("input", () => {
      const overrides = StateStore.read().endpointOverrides || {};
      const v = els.endpointInput.value.trim();
      if (v) overrides[state.providerId] = v;
      else delete overrides[state.providerId];
      StateStore.patch({ endpointOverrides: overrides });
      Providers.endpointOverrides = overrides;
    });

    initProviders();
    buildAllChips();
    updatePromptCount();
    renderThumbs();
    wire();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
