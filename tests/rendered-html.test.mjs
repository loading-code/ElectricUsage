import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the electricity dashboard loading state", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Electricity Usage Explorer<\/title>/i);
  assert.match(html, /class="state-page"/);
  assert.match(html, /class="loader"/);
  assert.match(html, /Preparing your energy view/);
  assert.match(html, /Organising the half-hour readings/);
});

test("keeps the dashboard loading state small and self-contained", async () => {
  const [page, css, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /if \(!dataset \|\| !analysis\)/);
  assert.match(page, /<main className="state-page">/);
  assert.match(page, /<div className="loader" \/>/);
  assert.match(css, /\.state-page\s*\{[^}]*min-height:\s*100vh/s);
  assert.match(css, /\.loader\s*\{[^}]*animation:\s*spin 900ms linear infinite/s);
  assert.match(css, /@keyframes spin/);
  assert.match(layout, /title:\s*"Electricity Usage Explorer"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
