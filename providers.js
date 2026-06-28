/* providers.js — Provider_Adapter layer for NVIDIA Cosmos + Hugging Face.
 * Both are reached through your CORS proxy (Cloudflare Worker). Set Providers.proxyUrl
 * from the app's "Proxy URL" field. Your API key still lives in the browser and is
 * forwarded by the proxy to the provider; the proxy stores nothing. */

class AuthError extends Error {}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read image file."));
    r.readAsDataURL(file);
  });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function b64ToBlob(b64, type) {
  const clean = (b64 || "").replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || "video/mp4" });
}

/* Build a proxied URL: WORKER?url=<encoded target>. Falls back to direct if no proxy set. */
function proxied(targetUrl) {
  const p = Providers.proxyUrl;
  if (!p) return targetUrl;
  return p + (p.indexOf("?") !== -1 ? "&" : "?") + "url=" + encodeURIComponent(targetUrl);
}

/* ---------- NVIDIA Cosmos adapter ---------- */
const NvidiaAdapter = {
  async listModels() {
    // NVIDIA has no lightweight per-key catalog; use the curated entry.
    return { models: PROVIDERS.nvidia.models };
  },

  async generate(apiKey, req, { signal, onStatus }) {
    if (!apiKey) throw new AuthError("An NVIDIA key is required (nvapi-…).");
    if (!Providers.proxyUrl) throw new Error("Set your Proxy URL first (NVIDIA blocks direct browser calls).");

    const fps = PROVIDERS.nvidia.fps || 16;
    const maxFrames = PROVIDERS.nvidia.maxFrames || 197;
    const body = {
      prompt: req.prompt || "",
      resolution: nvidiaResString(req.aspect),               // e.g. "720_16_9"
      num_output_frames: Math.min(maxFrames, Math.max(16, Math.round(req.length * fps))),
      fps: fps,
      steps: 35,
      guidance_scale: 6.0,
      seed: Math.floor(Math.random() * 1e6)
    };
    if (req.images && req.images.length) {
      body.image = await fileToDataURL(req.images[0]); // data URI; T2V→I2V inferred automatically
    }

    onStatus("submitting to NVIDIA…");
    const res = await fetch(proxied(Providers.endpointFor("nvidia")), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal
    });

    if (res.status === 401 || res.status === 403) throw new AuthError("API key was rejected by NVIDIA.");
    if (res.status === 404 || res.status === 405) {
      throw new Error("Wrong endpoint (HTTP " + res.status + "). NVIDIA's URL is unique to this model — copy the exact URL from the cosmos3-nano page's Shell/cURL sample and paste it into 'Advanced: override endpoint URL'.");
    }
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = j.detail || j.message || (j.error && j.error.message) || msg; } catch (e) {}
      throw new Error(msg);
    }

    onStatus("decoding result");
    const j = await res.json();
    const b64 = j.b64_video ||
      (j.artifacts && j.artifacts[0] && (j.artifacts[0].base64 || j.artifacts[0].b64_video)) ||
      (j.video && j.video.b64) || j.video;
    if (!b64) throw new Error("Response did not contain a video (b64_video).");
    return b64ToBlob(b64, "video/mp4");
  }
};

/* ---------- Hugging Face adapter ---------- */
const HuggingFaceAdapter = {
  async listModels(apiKey) {
    // whoami is CORS-friendly, so call it directly (no proxy needed) to validate the key.
    // Only a real auth rejection blocks; anything else still shows the curated models.
    try {
      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: "Bearer " + apiKey }
      });
      if (res.status === 401 || res.status === 403) {
        throw new AuthError("API key was rejected by Hugging Face.");
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // Network/other: don't block listing — generation will surface real errors later.
    }
    return { models: PROVIDERS.huggingface.models };
  },

  async generate(apiKey, req, { signal, onStatus }) {
    if (!Providers.proxyUrl) throw new Error("Set your Proxy URL first (Hugging Face blocks direct browser calls).");
    const url = Providers.endpointFor("huggingface") + req.modelId;
    const parameters = {
      width: req.dims.width,
      height: req.dims.height,
      num_frames: Math.max(16, req.length * 8)
    };
    if (req.images && req.images.length) parameters.image = await fileToDataURL(req.images[0]);
    const body = JSON.stringify({ inputs: req.prompt || "", parameters });

    for (let attempt = 0; attempt < 40; attempt++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      onStatus(attempt === 0 ? "submitted" : "model loading / queued");

      const res = await fetch(proxied(url), {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: "video/mp4" },
        body, signal
      });

      if (res.status === 401 || res.status === 403) throw new AuthError("API key was rejected.");
      if (res.status === 404) throw new Error("This model isn't available on the free serverless tier (404). Try LTX-Video.");

      if (res.status === 503) {
        let wait = 8;
        try { const jj = await res.clone().json(); if (jj.estimated_time) wait = Math.ceil(jj.estimated_time); } catch (e) {}
        onStatus("warming up (~" + wait + "s)");
        await sleep(Math.min(wait, 20) * 1000, signal);
        continue;
      }

      const ctype = res.headers.get("content-type") || "";
      if (res.ok && ctype.startsWith("video")) { onStatus("downloading result"); return await res.blob(); }
      if (res.ok && ctype.indexOf("application/json") !== -1) {
        const jj = await res.json();
        const link = jj.video || jj.url || (jj[0] && jj[0].url);
        if (link) { const v = await fetch(proxied(link), { signal }); return await v.blob(); }
        throw new Error("Model returned an unexpected JSON response.");
      }

      let msg = "HTTP " + res.status;
      try { const jj = await res.json(); msg = jj.error || jj.message || msg; } catch (e) {}
      throw new Error(msg);
    }
    throw new Error("Model did not become ready in time.");
  }
};

const Providers = {
  proxyUrl: "",
  endpointOverrides: {},
  _adapters: { nvidia: NvidiaAdapter, huggingface: HuggingFaceAdapter },
  setProxy(url) { this.proxyUrl = (url || "").trim().replace(/\/+$/, ""); },
  endpointFor(id) { return (this.endpointOverrides && this.endpointOverrides[id]) || (PROVIDERS[id] && PROVIDERS[id].endpoint); },
  adapter(id) { return this._adapters[id]; },
  listModels(id, apiKey) { return this.adapter(id).listModels(apiKey); },
  generate(id, apiKey, req, opts) { return this.adapter(id).generate(apiKey, req, opts); }
};
