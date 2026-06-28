# Video Studio CORS Proxy (Cloudflare Worker)

This tiny Worker lets the static app call NVIDIA and Hugging Face from the browser
(both block direct browser/CORS calls). It stores nothing — your API key is forwarded
per request to the provider only.

## Option A — Dashboard (no install, no upload)

1. Go to **Cloudflare dashboard → Workers & Pages → Create → Workers**.
2. Choose **Hello World / Create Worker**, name it `video-proxy`, click **Deploy**.
3. Click **Edit code**. Select all, delete, then paste the contents of `worker.js`.
4. Click **Deploy**.
5. Copy the URL (e.g. `https://video-proxy.yourname.workers.dev`) into the app's **Proxy URL** box.

> Do NOT use the file "Upload" option — it expects static assets and shows
> "Please use `wrangler deploy` instead". Use the **Edit code** editor instead.

## Option B — wrangler CLI

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```

After deploy, wrangler prints the Worker URL. Paste it into the app's **Proxy URL** box.

## What it allows

The proxy only relays to these hosts (it is not an open proxy):

- ai.api.nvidia.com, integrate.api.nvidia.com, api.nvcf.nvidia.com
- huggingface.co, api-inference.huggingface.co, router.huggingface.co
