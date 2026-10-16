# Pulse — Internet Speed Test Suite

A fast, no-install internet speed test that runs entirely in the browser.
It measures real download, upload, ping, and jitter against Cloudflare's
global edge network.

**Live site:** https://lucky-kulfi-dc5fa8.netlify.app

## Features

- **Ping & jitter** — latency measured with repeated tiny requests
- **Download** — parallel streams with a live gauge
- **Upload** — real upload throughput
- **Verdict** — plain-English guidance for 4K streaming, video calls,
  gaming, and large uploads
- **Recent tests** — last 8 results saved only in your browser (local storage)
- Copy / share results

## Run locally

```bash
npm start
# then open http://127.0.0.1:3000
```

No build step and no dependencies — `server.js` is a tiny static file
server using only Node's built-in modules.

## Deploy

The app is static (`index.html`, `style.css`, `app.js`), so any static
host works. It is currently deployed on Netlify; `netlify.toml` holds
the publish and header settings. Drag the folder onto
[Netlify Drop](https://app.netlify.com/drop) or connect this repo to
Netlify / Vercel / Cloudflare Pages for automatic deploys.

## How it works

- Ping: times round trips to `speed.cloudflare.com/__down?bytes=0`
- Download: counts bytes from parallel `__down` streams over ~10 seconds
- Upload: posts generated payloads to `__up` over ~10 seconds

Results depend on Wi-Fi, device, and network load.
