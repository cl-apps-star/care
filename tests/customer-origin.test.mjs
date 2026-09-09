import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publicOrigin } from "../app/publicOrigin.server.js";

const original = { ...process.env };
test.afterEach(() => {
  process.env = { ...original };
});

test("Care prefers the branded customer origin and validates production URLs", () => {
  process.env.NODE_ENV = "production";
  process.env.SHOPIFY_APP_URL = "https://care-production.example";
  process.env.CUSTOMER_APP_URL = "https://care.cl-apps.net/";
  assert.equal(publicOrigin("http://internal:8080"), "https://care.cl-apps.net");

  process.env.CUSTOMER_APP_URL = "http://care.cl-apps.net";
  assert.throws(() => publicOrigin("http://internal:8080"), /HTTPS/);
});

test("every Care customer link uses the public origin layer", async () => {
  const paths = [
    "app/routes/app._index.jsx",
    "app/routes/app.cases._index.jsx",
    "app/routes/app.cases.$id.jsx",
    "app/routes/care.$token.jsx",
    "app/care-request.server.js",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  for (const source of sources) assert.match(source, /publicOrigin\(/);
  for (const source of sources) assert.doesNotMatch(source, /const appUrl = process\.env\.SHOPIFY_APP_URL/);
});
