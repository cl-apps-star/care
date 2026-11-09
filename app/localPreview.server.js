export function isLocalCarePreview() {
  if (process.env.CARE_LOCAL_PREVIEW !== "true") return false;
  const url = new URL(process.env.SHOPIFY_APP_URL || "http://127.0.0.1:3202");
  const database = new URL(process.env.DATABASE_URL || "postgresql://localhost/cl_care_preview");
  if (process.env.NODE_ENV === "production" || process.env.SHOPIFY_API_SECRET || process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN || process.env.MAILGUN_API_KEY ||
    !["localhost", "127.0.0.1"].includes(url.hostname) || !["localhost", "127.0.0.1"].includes(database.hostname) || !database.pathname.startsWith("/cl_care_preview")) {
    throw new Error("Care preview requires loopback URLs, its own preview database and no external credentials.");
  }
  return true;
}
export const carePreviewShop = "care-suite-preview.myshopify.com";
export function carePreviewShopify() {
  const reject = async () => { throw new Response("External actions are disabled in Care preview.", { status: 403 }); };
  return {
    authenticate: { admin: async request => {
      if (!isLocalCarePreview() || !["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) throw new Response("Forbidden", { status: 403 });
      return { session: { id: "care-local-preview", shop: carePreviewShop, email: "preview@example.com" }, admin: { graphql: reject }, billing: { check: async () => ({ hasActivePayment: false, appSubscriptions: [] }), request: reject, cancel: reject } };
    }, webhook: reject },
    unauthenticated: { admin: reject }, login: reject, registerWebhooks: reject,
    addDocumentResponseHeaders() {}, sessionStorage: null,
  };
}
