import prisma from "./db.server";

// Looks up a real Shopify order for the public customer request form, so a
// case can be tied to an actual order/product instead of freeform text.
// Falls back gracefully (found: false) if there's no offline access token
// yet, the order can't be found, or the email doesn't match — the caller
// (care.request.jsx) lets the customer continue with manual entry either way.

const API_VERSION = "2025-10";

function numericIdFromGid(gid) {
  return typeof gid === "string" ? gid.split("/").pop() : null;
}

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
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `#graphql
          query FindOrderForCustomer($query: String!) {
            orders(first: 1, query: $query, sortKey: CREATED_AT, reverse: true) {
              nodes {
                id
                name
                email
                lineItems(first: 250) {
                  nodes {
                    title
                    quantity
                    product {
                      id
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { query: `name:${name}` },
      }),
    });

    if (!res.ok) {
      console.warn(`[shopify-orders.server] order lookup returned ${res.status}`);
      return { found: false, reason: "api_error" };
    }

    const data = await res.json();
    if (data.errors?.length) {
      console.warn("[shopify-orders.server] GraphQL order lookup failed", data.errors);
      return { found: false, reason: "api_error" };
    }

    const order = data.data?.orders?.nodes?.[0];
    if (!order) {
      return { found: false, reason: "not_found" };
    }

    const orderEmail = (order.email || "").toLowerCase();
    if (orderEmail !== email.trim().toLowerCase()) {
      return { found: false, reason: "email_mismatch" };
    }

    const lineItems = (order.lineItems?.nodes || []).map((li) => ({
      title: li.title,
      shopifyProductId: numericIdFromGid(li.product?.id),
      quantity: li.quantity,
    }));

    return {
      found: true,
      shopifyOrderId: numericIdFromGid(order.id),
      shopifyOrderName: order.name,
      lineItems,
    };
  } catch (err) {
    console.error("[shopify-orders.server] order lookup failed", err);
    return { found: false, reason: "error" };
  }
}
