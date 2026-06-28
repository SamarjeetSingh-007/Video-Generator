/* config.js — providers (NVIDIA Cosmos + Hugging Face), models, options.
 * No secrets here. Both providers are reached through your CORS proxy (Cloudflare Worker),
 * because neither allows direct browser calls. Set the proxy URL in the app's setup panel. */

const ASPECT_RATIOS = [
  { id: "16:9", label: "Landscape 16:9" },
  { id: "1:1",  label: "Square 1:1" },
  { id: "9:16", label: "Portrait 9:16" }
];

const RESOLUTIONS = [
  { id: "720p",  label: "720p",  height: 720 },
  { id: "1080p", label: "1080p", height: 1080 },
  { id: "2K",    label: "2K",    height: 1440 },
  { id: "4K",    label: "4K",    height: 2160 }
];

const CLIP_LENGTHS = [
  { id: 5,  label: "5s" },
  { id: 10, label: "10s" },
  { id: 15, label: "15s" },
  { id: 20, label: "20s" }
];

/* Pixel dimensions per aspect ratio + resolution (height-driven), used by the stitcher. */
function dimsFor(aspect, resolutionId) {
  const res = RESOLUTIONS.find(r => r.id === resolutionId) || RESOLUTIONS[0];
  const h = res.height;
  const map = {
    "16:9": [Math.round(h * 16 / 9), h],
    "1:1":  [h, h],
    "9:16": [Math.round(h * 9 / 16), h]
  };
  const [w, hh] = map[aspect] || map["16:9"];
  return { width: w - (w % 2), height: hh - (hh % 2) };
}

/* NVIDIA Cosmos resolution string, e.g. "720_16_9". Cosmos hosted endpoint is 720p only. */
function nvidiaResString(aspect) {
  const a = (aspect || "16:9").replace(":", "_");
  return "720_" + a;
}

function model(id, name, caps) {
  return Object.assign({
    id, name,
    text: null, image: null,
    resolutions: null, lengths: null, aspects: null
  }, caps);
}

const PROVIDERS = {
  nvidia: {
    id: "nvidia",
    label: "NVIDIA Cosmos (free endpoint · via proxy)",
    keyUrl: "https://build.nvidia.com/nvidia/cosmos3-nano",
    docs: "Free API key from build.nvidia.com. Physics-aware video from text or image. 720p, ~5–10s clips, commercial-use OK. Requires your CORS proxy (Cloudflare Worker).",
    keyHint: "Key starts with nvapi-… — get it on the cosmos3-nano page (‘Get API Key’).",
    flow: "nvidia",
    // Exact invoke URL for the hosted model. If you get a 404/405, open the cosmos3-nano
    // page → "Get API Key" / the Python or Shell code sample, copy the invoke_url it shows,
    // and paste it into the app's "Advanced: override endpoint URL" box.
    endpoint: "https://ai.api.nvidia.com/v1/genai/nvidia/cosmos3-nano",
    fps: 16,
    maxFrames: 197,
    models: [
      model("cosmos3-nano", "Cosmos3 Nano — physics-aware video", {
        text: true, image: true,
        resolutions: ["720p"], lengths: [5, 10], aspects: ["16:9", "1:1", "9:16"]
      })
    ]
  },

  huggingface: {
    id: "huggingface",
    label: "Hugging Face (Inference · via proxy)",
    keyUrl: "https://huggingface.co/settings/tokens",
    docs: "Free monthly credits. Open models (Wan, LTX-Video). Reached through your CORS proxy. Note: the largest video models may not be on the free serverless tier and can return 404.",
    keyHint: "Token starts with hf_… — create a 'Read' token.",
    flow: "hf",
    endpoint: "https://api-inference.huggingface.co/models/",
    models: [
      model("Wan-AI/Wan2.2-T2V-A14B", "Wan 2.2 — Text→Video (cinematic)", {
        text: true, image: false,
        resolutions: ["720p"], lengths: [5], aspects: ["16:9", "1:1", "9:16"]
      }),
      model("Lightricks/LTX-Video", "LTX-Video — fast Text/Image→Video", {
        text: true, image: true,
        resolutions: ["720p"], lengths: [5], aspects: ["16:9", "1:1", "9:16"]
      })
    ]
  }
};

const FREE_KEY_GUIDE = `
  <h2>🔑 Your two providers &amp; how to make them work</h2>
  <p>Both NVIDIA and Hugging Face block direct browser calls (CORS), so this app talks to them through a tiny free <b>Cloudflare Worker proxy</b> that holds nothing and just relays your request. Set up the Worker once (steps below), paste its URL into the <b>Proxy URL</b> box, and you're done.</p>

  <h3>★ NVIDIA Cosmos3 Nano — genuinely free</h3>
  <ul>
    <li>Get a free key at <a href="https://build.nvidia.com/nvidia/cosmos3-nano" target="_blank" rel="noopener">build.nvidia.com/nvidia/cosmos3-nano</a> → "Get API Key" (key starts with <code>nvapi-</code>).</li>
    <li>720p, ~5–10s clips, text→video and image→video. Commercial use allowed; outputs carry an invisible SynthID watermark (no visible logo).</li>
    <li>Best for realistic product motion / B-roll. It's a physics/world model, so it's less "glossy commercial" than Veo, but it's free and usable.</li>
  </ul>

  <h3>Hugging Face</h3>
  <ul>
    <li>Read token at <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a> (<code>hf_</code>). Free monthly credits.</li>
    <li>Open models like Wan and LTX-Video. Heads-up: the biggest models may not be on the free serverless tier and can return 404 — LTX-Video is the most likely to respond.</li>
  </ul>

  <h3>⚙️ One-time: deploy the free proxy (Cloudflare Worker)</h3>
  <ol>
    <li>Create a free account at <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare</a>.</li>
    <li>Workers &amp; Pages → Create → Workers → "Hello World". Name it <code>video-proxy</code> and Deploy.</li>
    <li>Click <b>Edit code</b>, select-all + delete, then paste the contents of <code>cloudflare-worker/worker.js</code> and Deploy. <b>Do not use the file "Upload" option</b> — it shows a "use wrangler deploy" build error. Pasting into the editor avoids that.</li>
    <li>Copy the Worker URL (e.g. <code>https://video-proxy.YOURNAME.workers.dev</code>) and paste it into the <b>Proxy URL</b> box here.</li>
  </ol>
  <p class="muted">The Worker only relays to NVIDIA and Hugging Face and adds the CORS header. Your API key still lives only in your browser and is sent through the proxy to the provider — the proxy never stores it.</p>

  <h3>For 15–30s product ads</h3>
  <p>Generate a few short clips, add them to the project on the right, reorder, then "Stitch into one video". Keep every clip at the same aspect ratio and resolution for a clean stitch.</p>
`;
