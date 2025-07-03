import {} from "@cloudflare/workers-types";
import { Router, Method } from "tiny-request-router";

import { pageRoute } from "./routes/page";
import { tableRoute } from "./routes/table";
import { userRoute } from "./routes/user";
import { searchRoute } from "./routes/search";
import { createResponse } from "./response";
import { getCacheKey } from "./get-cache-key";
import * as types from "./api/types";

export type Handler = (
  req: types.HandlerRequest
) => Promise<Response> | Response;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
};

const router = new Router<Handler>();

// --- Serve your portfolio homepage at "/" ---
router.get("/", () =>
  new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Shann Bhakta</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 3rem; background: #f7f7f9; }
        .container { max-width: 600px; margin: auto; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 2px 10px #0001; }
        h1 { color: #3a49d6; }
        p { color: #222; }
        a { color: #3a49d6; text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Welcome to Shann Bhakta's Portfolio!</h1>
        <p>This page is live on <b>shannbhakta.com</b> and powered by Cloudflare Workers.</p>
        <p>To make this your live Notion site, <b>replace this HTML with an export from Notion</b> or use a tool like <a href="https://fruitionsite.com/" target="_blank">Fruition</a>, <a href="https://potion.so/" target="_blank">Potion</a>, or <a href="https://super.so/" target="_blank">Super</a> for a Notion-backed website.</p>
        <hr />
        <h3>API Endpoints:</h3>
        <ul>
          <li><code>/v1/page/:pageId</code></li>
          <li><code>/v1/table/:pageId</code></li>
          <li><code>/v1/user/:userId</code></li>
          <li><code>/v1/search</code></li>
        </ul>
      </div>
    </body>
    </html>
  `, {
    headers: { "Content-Type": "text/html" }
  })
);

// --- Your API endpoints (unchanged) ---
router.options("*", () => new Response(null, { headers: corsHeaders }));
router.get("/v1/page/:pageId", pageRoute);
router.get("/v1/table/:pageId", tableRoute);
router.get("/v1/user/:userId", userRoute);
router.get("/v1/search", searchRoute);

// --- All other routes: 404 handler ---
router.get("*", async () =>
  createResponse(
    {
      error: `Route not found!`,
      routes: ["/", "/v1/page/:pageId", "/v1/table/:pageId", "/v1/user/:userId", "/v1/search"],
    },
    {},
    404
  )
);

const cache = (caches as any).default;
const NOTION_API_TOKEN =
  typeof NOTION_TOKEN !== "undefined" ? NOTION_TOKEN : undefined;

const handleRequest = async (fetchEvent: FetchEvent): Promise<Response> => {
  const request = fetchEvent.request;
  const { pathname, searchParams } = new URL(request.url);
  const notionToken =
    NOTION_API_TOKEN ||
    (request.headers.get("Authorization") || "").split("Bearer ")[1] ||
    undefined;

  const match = router.match(request.method as Method, pathname);

  if (!match) {
    return new Response("Endpoint not found.", { status: 404 });
  }

  const cacheKey = getCacheKey(request);
  let response;

  if (cacheKey) {
    try {
      response = await cache.match(cacheKey);
    } catch (err) {}
  }

  const getResponseAndPersist = async () => {
    const res = await match.handler({
      request,
      searchParams,
      params: match.params,
      notionToken,
    });

    if (cacheKey) {
      await cache.put(cacheKey, res.clone());
    }

    return res;
  };

  if (response) {
    fetchEvent.waitUntil(getResponseAndPersist());
    return response;
  }

  return getResponseAndPersist();
};

self.addEventListener("fetch", async (event: Event) => {
  const fetchEvent = event as FetchEvent;
  fetchEvent.respondWith(handleRequest(fetchEvent));
});