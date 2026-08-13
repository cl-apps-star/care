// app/care-payment.server.js
//
// Turns an approved Care quote into a real Shopify Draft Order, so the
// customer can actually pay for the repair through Shopify's own hosted
// checkout — this is the piece that was previously a stub (`markPaid()`
// just flipped a status flag with no real charge behind it).
//
// Pattern: same offline-token lookup shopify-orders.server.js already
// uses for the order-lookup feature, just calling draftOrderCreate
// instead of reading orders. Requires the `write_draft_orders` scope
// (see shopify.app.toml note below — this is new, Care didn't need it
// before).

import prisma from "./db.server";

const API_VERSION = "2025-10"; // matches ApiVersion.October25 used elsewhere in this app

async function getOfflineAccessToken(shop) {
  // Offline sessions have isOnline: false — this is the long-lived token
  // used for background/API work not tied to a specific admin user
  // session, same convention shopify-orders.server.js relies on.
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session?.accessToken) {
    throw new Error(`No offline access token found for ${shop}`);
  }
  return session.accessToken;
}

async function adminGraphQL(shop, query, variables) {
  const accessToken = await getOfflineAccessToken(shop);
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation careDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
        totalPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Builds and creates a Shopify Draft Order from an approved Care quote,
 * then returns a real, Shopify-hosted invoice URL the customer can pay
 * through. Care never touches card details itself — Shopify's own
 * checkout handles payment collection end to end.
 *
 * A custom attribute carries the CareCase id so the orders/create
 * webhook can match the resulting real Order back to this case once the
 * customer completes payment (see webhooks.orders.create.jsx).
 */
export async function createDraftOrderForQuote(careCase, shop) {
  if (!careCase.customerEmail) {
    throw new Error("Cannot create a draft order without a customer email.");
  }
  if (!shop) {
    throw new Error("Cannot create a draft order without the shop domain.");
  }

  const lineItems = [];
  const labour = Number(careCase.quoteLabourCost || 0);
  const parts = Number(careCase.quotePartsCost || 0);
  const shipping = Number(careCase.quoteShippingCost || 0);
  const tax = Number(careCase.quoteTax || 0);

  // Custom (non-catalogue) line items — a repair quote isn't tied to a
  // sellable product variant, so these are freeform priced lines rather
  // than variant references. Only include lines with a nonzero amount so
  // an itemized $0 line doesn't show up on the customer's invoice.
  if (labour > 0) {
    lineItems.push({
      title: `${careCase.serviceName || "Care & repair"} — labour`,
      originalUnitPrice: labour.toFixed(2),
      quantity: 1,
    });
  }
  if (parts > 0) {
    lineItems.push({
      title: `${careCase.serviceName || "Care & repair"} — parts`,
      originalUnitPrice: parts.toFixed(2),
      quantity: 1,
    });
  }
  // Tax as its own itemized line, matching the exact amount the merchant
  // typed into the Quote builder — previously this was handled only via
  // the taxExempt flag below, which just toggled Shopify's OWN automatic
  // tax calculation on/off. That doesn't necessarily match what the
  // customer was actually quoted (different rate, different rounding, or
  // no tax config at all on the shop), so the invoice total could silently
  // drift from the quote total. An explicit line item guarantees the two
  // always agree.
  if (tax > 0) {
    lineItems.push({
      title: "Tax",
      originalUnitPrice: tax.toFixed(2),
      quantity: 1,
    });
  }
  if (lineItems.length === 0) {
    // Every quote should have at least a labour or parts line, but guard
    // against a $0 quote (e.g. a goodwill / warranty repair) so
    // draftOrderCreate doesn't reject an empty lineItems array.
    lineItems.push({
      title: careCase.serviceName || "Care & repair",
      originalUnitPrice: "0.00",
      quantity: 1,
    });
  }

  const input = {
    email: careCase.customerEmail,
    lineItems,
    shippingLine: shipping > 0
      ? { title: "Return shipping", price: shipping.toFixed(2) }
      : undefined,
    // Tax is now always carried as its own explicit line item above (when
    // present) rather than left to Shopify's automatic calculation, so this
    // must always be taxExempt: true — otherwise Shopify would calculate
    // and add its OWN tax on top of the tax line we already itemized,
    // double-charging the customer.
    taxExempt: true,
    note: `Care request ${careCase.id}${careCase.shopifyOrderName ? ` (order ${careCase.shopifyOrderName})` : ""}${careCase.quoteNote ? ` — ${careCase.quoteNote}` : ""}`,
    customAttributes: [
      { key: "care_case_id", value: careCase.id },
      { key: "care_case_token", value: careCase.token },
    ],
  };

  const data = await adminGraphQL(shop, DRAFT_ORDER_CREATE_MUTATION, { input });
  const result = data?.draftOrderCreate;

  if (result?.userErrors?.length) {
    throw new Error(
      `Draft order creation failed: ${result.userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!result?.draftOrder?.invoiceUrl) {
    throw new Error("Draft order created but no invoice URL was returned.");
  }

  return {
    draftOrderId: result.draftOrder.id,
    invoiceUrl: result.draftOrder.invoiceUrl,
    totalPrice: result.draftOrder.totalPrice,
  };
}
