// Customer pages can use a short branded hostname without moving Shopify
// OAuth, webhooks or the embedded admin app away from its Railway origin.
export function publicOrigin(requestUrl) {
  const configured = process.env.CUSTOMER_APP_URL || process.env.SHOPIFY_APP_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("CUSTOMER_APP_URL or SHOPIFY_APP_URL is required for customer links.");
  }

  const url = new URL(configured || requestUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("The configured customer origin must use HTTPS for customer links.");
  }
  if (configured && (url.username || url.password || url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("The configured customer origin must be an origin without credentials, a path, query or fragment.");
  }

  return url.origin;
}
