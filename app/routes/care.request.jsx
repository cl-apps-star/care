import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import prisma from "../db.server";
import { listCatalogue, createCareCase } from "../care.server";
import { sendCaseReceivedEmail } from "../email.server";
import { findOrderForCustomer } from "../shopify-orders.server";

// Public, unauthenticated route — the customer-facing way to actually start
// a repair/return request. Linked from the merchant dashboard as
// `${appUrl}/care/request?shop=<shop>`; merchants share that link wherever
// makes sense for them (order confirmation email, thank-you page, product
// page, customer account). No login required, same access pattern as the
// tracking page at /care/:token.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return { error: "missing_shop" };
  }
  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) {
    return { error: "not_found" };
  }
  const catalogue = (await listCatalogue(merchant.id)).filter((c) => c.active);
  return { merchant, catalogue, shop };
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "lookup_order") {
    const orderNumber = String(formData.get("orderNumber") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const lookup = await findOrderForCustomer({ shop, orderNumber, email });
    return { step: "details", lookup, orderNumber, email };
  }

  if (intent === "submit_request") {
    const email = String(formData.get("email") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const orderNumber = String(formData.get("orderNumber") || "").trim();
    const issueDescription = String(formData.get("issueDescription") || "").trim();
    const catalogueItemId = String(formData.get("catalogueItemId") || "") || null;

    if (!email || !name || !issueDescription) {
      return {
        step: "details",
        lookup: JSON.parse(String(formData.get("lookupJson") || "{}")),
        orderNumber,
        email,
        formError: "Please fill in your name, email, and a short description of the issue.",
      };
    }

    let serviceName = "General enquiry";
    if (catalogueItemId) {
      const item = await prisma.serviceCatalogueItem.findUnique({ where: { id: catalogueItemId } });
      if (item) serviceName = item.name;
    }

    let shopifyOrderId = null;
    let shopifyOrderName = orderNumber ? (orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`) : null;
    let shopifyProductId = null;
    let productTitle = String(formData.get("productTitle") || "").trim() || null;

    const lineItemsJson = formData.get("lineItemsJson");
    const selectedIndex = formData.get("selectedLineItem");
    if (lineItemsJson && selectedIndex !== null && selectedIndex !== "") {
      try {
        const lineItems = JSON.parse(String(lineItemsJson));
        const chosen = lineItems[Number(selectedIndex)];
        if (chosen) {
          productTitle = chosen.title;
          shopifyProductId = chosen.shopifyProductId;
        }
      } catch {
        // fall through to manually-entered productTitle
      }
    }
    if (formData.get("shopifyOrderId")) shopifyOrderId = String(formData.get("shopifyOrderId"));
    if (formData.get("shopifyOrderName")) shopifyOrderName = String(formData.get("shopifyOrderName"));

    let photos = null;
    const photoFile = formData.get("photo");
    if (photoFile && typeof photoFile === "object" && photoFile.size > 0) {
      const buffer = Buffer.from(await photoFile.arrayBuffer());
      photos = [`data:${photoFile.type};base64,${buffer.toString("base64")}`];
    }

    const careCase = await createCareCase(merchant.id, {
      customerName: name,
      customerEmail: email,
      shopifyOrderId,
      shopifyOrderName,
      shopifyProductId,
      productTitle,
      catalogueItemId,
      serviceName,
      issueDescription,
      photos,
    });

    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const trackingUrl = `${appUrl}/care/${careCase.token}`;
    await sendCaseReceivedEmail({ careCase, merchant, trackingUrl });

    return { step: "done", trackingUrl, customerEmail: email };
  }

  return { step: "start" };
};

function Shell({ brand, children }) {
  const accent = brand?.accentColor || "#8a7758";
  return (
    <div
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px",
        color: "#1a1a1a",
      }}
    >
      <div
        style={{
          fontSize: 13,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent,
          marginBottom: 24,
        }}
      >
        {brand?.brandName || "Care"}
      </div>
      {children}
    </div>
  );
}

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  fontSize: 15,
  fontFamily: "inherit",
  border: "1px solid #ccc",
  marginTop: 6,
  marginBottom: 18,
  boxSizing: "border-box",
};

const labelStyle = { display: "block", fontSize: 14, fontWeight: "bold" };

export default function CareRequestPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (data.error === "missing_shop") {
    return (
      <Shell brand={null}>
        <h1 style={{ fontWeight: "normal" }}>This link is missing some information</h1>
        <p>Please use the exact link your retailer shared with you, or contact them directly.</p>
      </Shell>
    );
  }

  if (data.error === "not_found") {
    return (
      <Shell brand={null}>
        <h1 style={{ fontWeight: "normal" }}>We couldn't find this page</h1>
        <p>Please double-check the link, or contact the retailer directly.</p>
      </Shell>
    );
  }

  const { merchant, catalogue, shop } = data;
  const actionUrl = `/care/request?shop=${encodeURIComponent(shop)}`;
  const accent = merchant.accentColor || "#8a7758";

  if (actionData?.step === "done") {
    return (
      <Shell brand={merchant}>
        <h1 style={{ fontWeight: "normal" }}>Thanks — we've got your request</h1>
        <p>
          We've sent a confirmation to <strong>{actionData.customerEmail}</strong> with a link to
          track progress. We'll be in touch with next steps shortly.
        </p>
        <a href={actionData.trackingUrl} style={{ color: accent }}>
          Track your request now
        </a>
      </Shell>
    );
  }

  const showDetails = actionData?.step === "details";
  const lookup = showDetails ? actionData.lookup : null;
  const orderNumber = showDetails ? actionData.orderNumber : "";
  const email = showDetails ? actionData.email : "";

  return (
    <Shell brand={merchant}>
      <h1 style={{ fontWeight: "normal" }}>Request a repair or return</h1>
      <p style={{ color: "#555" }}>
        Tell us a little about your piece and what's going on — we'll follow up with a quote and
        next steps.
      </p>

      {!showDetails && (
        <Form method="post" action={actionUrl}>
          <input type="hidden" name="intent" value="lookup_order" />
          <label style={labelStyle}>
            Order number
            <input style={fieldStyle} name="orderNumber" placeholder="e.g. 1003" />
          </label>
          <label style={labelStyle}>
            Email used at checkout
            <input style={fieldStyle} type="email" name="email" required />
          </label>
          <p style={{ fontSize: 13, color: "#777", marginTop: -10 }}>
            Don't have your order number handy? Leave it blank and continue — you'll be able to
            describe your item instead.
          </p>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "12px 24px",
              background: accent,
              color: "#fff",
              border: "none",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {submitting ? "Looking up your order…" : "Continue"}
          </button>
        </Form>
      )}

      {showDetails && (
        <Form method="post" action={actionUrl} encType="multipart/form-data">
          <input type="hidden" name="intent" value="submit_request" />
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="lookupJson" value={JSON.stringify(lookup || {})} />

          {lookup?.found ? (
            <>
              <input type="hidden" name="shopifyOrderId" value={lookup.shopifyOrderId} />
              <input type="hidden" name="shopifyOrderName" value={lookup.shopifyOrderName} />
              <input type="hidden" name="lineItemsJson" value={JSON.stringify(lookup.lineItems)} />
              <p style={{ fontSize: 13, color: "#777" }}>
                Found order {lookup.shopifyOrderName}.
              </p>
              {lookup.lineItems.length > 1 ? (
                <label style={labelStyle}>
                  Which item is this about?
                  <select style={fieldStyle} name="selectedLineItem" defaultValue="0">
                    {lookup.lineItems.map((li, i) => (
                      <option key={i} value={i}>
                        {li.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="selectedLineItem" value="0" />
              )}
            </>
          ) : (
            <>
              {lookup?.reason === "not_found" || lookup?.reason === "email_mismatch" ? (
                <p style={{ fontSize: 13, color: "#777" }}>
                  We couldn't match that to an order — no problem, just tell us about your item
                  below.
                </p>
              ) : null}
              <label style={labelStyle}>
                What's the item?
                <input style={fieldStyle} name="productTitle" placeholder="e.g. Gold signet ring" required />
              </label>
            </>
          )}

          <label style={labelStyle}>
            Your name
            <input style={fieldStyle} name="name" required />
          </label>

          <label style={labelStyle}>
            What service do you need?
            <select style={fieldStyle} name="catalogueItemId" defaultValue="">
              <option value="">Not sure — let us take a look</option>
              {catalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {catalogue.length === 0 && (
            <p style={{ fontSize: 13, color: "#777", marginTop: -10 }}>
              This retailer hasn't listed specific services yet — that's fine, just describe what
              you need below.
            </p>
          )}

          <label style={labelStyle}>
            Describe the issue
            <textarea style={{ ...fieldStyle, minHeight: 100 }} name="issueDescription" required />
          </label>

          <label style={labelStyle}>
            Add a photo (optional)
            <input style={fieldStyle} type="file" name="photo" accept="image/*" />
          </label>

          {actionData?.formError && (
            <p style={{ color: "#b3261e", fontSize: 14 }}>{actionData.formError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "12px 24px",
              background: accent,
              color: "#fff",
              border: "none",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {submitting ? "Sending…" : "Submit request"}
          </button>
        </Form>
      )}
    </Shell>
  );
}
