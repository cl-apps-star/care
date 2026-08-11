// Cross-app link to Digital Unboxing & COA Kit, mirroring the pattern
// already used in In the Making's app/partner.server.js. Best-effort and
// read-only: any failure (env vars unset, COA not installed on this shop,
// unreachable, timeout, non-2xx response) just means "nothing to show" —
// never an error surfaced to the merchant. Care has to keep working
// exactly the same whether or not COA is installed alongside it.
const COA_KIT_APP_URL = process.env.COA_KIT_APP_URL;
const PARTNER_API_SECRET = process.env.PARTNER_API_SECRET;

// Returns an array of recently-generated COA kits for this shop, or null
// if there's nothing to show (COA not installed, no kits generated yet,
// the env vars aren't set, or the call failed for any reason). Callers
// should treat null exactly like "no kits" — never render an error state
// from this, just fall back to the manual entry form.
export async function getRecentCoaKits(shop, limit = 6) {
  if (!COA_KIT_APP_URL || !PARTNER_API_SECRET || !shop) return null;
  try {
    const url = new URL("/api/recent-kits", COA_KIT_APP_URL);
    url.searchParams.set("shop", shop);
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url, {
      headers: { "X-Partner-Secret": PARTNER_API_SECRET },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.kits) || data.kits.length === 0) {
      return null;
    }
    return data.kits;
  } catch (error) {
    console.error(
      "[PARTNER] Digital Unboxing & COA Kit recent-kits check failed:",
      error?.message || error,
    );
    return null;
  }
}
