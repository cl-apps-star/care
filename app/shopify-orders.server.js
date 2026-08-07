import prisma from "./db.server";

// Looks up a real Shopify order for the public customer request form, so a
// case can be tied to an actual order/product instead of freeform text.
// Falls back gracefully (found: false) if there's no offline access token
// yet, the order can't be found, or the email doesn't match — the caller
// (care.request.jsx) lets the customer continue with manual entry either way.

const API_VERSION = "2025-10";

export async function findOrderForCustomer({ shop, orderNumber, email }) {
  if (!shop || !orderNumber || !email) {
    return { found: false, reason: "missing_input" };
  }

  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session?.accessToken) {
    return { found: false, reason: "no_admin_access" };
  }

  const name = orderNumber.trim().startsWith("#") ? orderNumber.trim() : `#${orderNumber.trim()}`;

  try {
    const res = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/orders.json?name=${encodeURIComponent(name)}&status=any`,
      {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      console.warn(`[shopify-orders.server] order lookup returned ${res.status}`);
      return { found: false, reason: "api_error" };
    }

    const data = await res.json();
    const order = (data.orders || [])[0];
    if (!order) {
      return { found: false, reason: "not_found" };
    }

    const orderEmail = (order.email || order.customer?.email || "").toLowerCase();
    if (orderEmail !== email.trim().toLowerCase()) {
      return { found: false, reason: "email_mismatch" };
    }

    const lineItems = (order.line_items || []).map((li) => ({
      title: li.title,
      shopifyProductId: li.product_id ? String(li.product_id) : null,
      quantity: li.quantity,
    }));

    return {
      found: true,
      shopifyOrderId: String(order.id),
      shopifyOrderName: order.name,
      customerName: `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
      lineItems,
    };
  } catch (err) {
    console.error("[shopify-orders.server] order lookup failed", err);
    return { found: false, reason: "error" };
  }
}
