/* Cloudflare Worker — CORS proxy for the Video Generation Studio.
 *
 * It relays browser requests to NVIDIA and Hugging Face (which block direct
 * browser calls) and adds the CORS header so your static site can talk to them.
 * It also transparently handles NVIDIA's async (202 + poll) responses so the
 * browser just awaits one call.
 *
 * Your API key is NOT stored here — it's forwarded from the browser to the
 * provider for that single request only.
 *
 * Usage from the app:  https://YOUR-WORKER.workers.dev/?url=<encoded target URL>
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create Worker → paste this → Deploy.
 */

const ALLOWED_HOSTS = [
  "ai.api.nvidia.com",
  "integrate.api.nvidia.com",
  "api.nvcf.nvidia.com",
  "huggingface.co",
  "api-inference.huggingface.co",
  "router.huggingface.co"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, accept",
  "Access-Control-Max-Age": "86400"
};

function withCors(resp) {
  const h = new Headers(resp.headers);
  Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function isAllowed(urlStr) {
  try { return ALLOWED_HOSTS.indexOf(new URL(urlStr).hostname) !== -1; }
  catch (e) { return false; }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target || !isAllowed(target)) {
      return withCors(new Response(JSON.stringify({ error: "Missing or disallowed ?url= target." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      }));
    }

    // Forward only the headers we need.
    const fwd = new Headers();
    ["authorization", "content-type", "accept"].forEach(k => {
      const v = request.headers.get(k);
      if (v) fwd.set(k, v);
    });
    // Ask NVCF to wait (long-poll) so it often returns the result in one response.
    if (target.indexOf("api.nvcf.nvidia.com") !== -1) {
      fwd.set("NVCF-POLL-SECONDS", "300");
    }

    const init = { method: request.method, headers: fwd };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    let resp = await fetch(target, init);

    // NVIDIA async pattern: 202 + a request id we poll until complete.
    if (resp.status === 202) {
      const reqId = resp.headers.get("nvcf-reqid") || resp.headers.get("NVCF-REQID");
      if (reqId) {
        const auth = fwd.get("authorization");
        const pollUrl = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/" + reqId;
        for (let i = 0; i < 140; i++) { // ~300s max
          resp = await fetch(pollUrl, {
            headers: { "Authorization": auth, "Accept": "application/json", "NVCF-POLL-SECONDS": "300" }
          });
          if (resp.status !== 202) break;
        }
      }
    }

    return withCors(resp);
  }
};
