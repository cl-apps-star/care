// Shared loader/action logic for the public "request a repair" page,
// used by both app/routes/care.request.jsx (the generic shared link,
// `/care/request?shop=<shop>`) and app/routes/care.request.$token.jsx (a
// personalized invite link, `/care/request/<token>`, prefilled from a
// CareInvite record — see that model's comment in schema.prisma for why
// invites are stored server-side instead of carried in the URL).
//
// Pulled out into its own module so the two route files stay thin (loader
// figures out `shop` + `prefill` its own way, then both delegate here) and
// the actual page component (defined once in care.request.jsx and
// re-exported by care.request.$token.jsx) doesn't care which route matched
// — it just renders whatever `{ merchant, catalogue, shop, prefill,
// actionUrl }` it's given.

import prisma from "./db.server";
import { listCatalogue, createCareCase } from "./care.server";
import { sendCaseReceivedEmail, sendNewCaseAlertEmail } from "./email.server";
import { findOrderForCustomer } from "./shopify-orders.server";
import { checkAndIncrementCaseCount } from "./plan.server";
import { publicOrigin } from "./publicOrigin.server";

export async function loadRequestPageData({ shop, actionUrl, prefillEmail, prefillOrder, prefillName, prefillProductTitle }) {
  if (!shop) {
    return { error: "missing_shop" };
  }
  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) {
    return { error: "not_found" };
  }
  const catalogue = (await listCatalogue(merchant.id)).filter((c) => c.active);

  let prefill = null;
  if (prefillEmail) {
    const orderNumber = (prefillOrder || "").trim();
    const lookup = orderNumber
      ? await findOrderForCustomer({ shop, orderNumber, email: prefillEmail })
      : { found: false, reason: "not_found" };
    prefill = {
      lookup,
      orderNumber,
      email: prefillEmail,
      name: prefillName || "",
      productTitle: prefillProductTitle || "",
    };
  }

  const brandFields = ["shop", "brandName", "primaryColor", "accentColor", "logoUrl", "supportEmail"];
  const publicMerchant = Object.fromEntries(brandFields.map(key => [key, merchant[key]]));
  const publicCatalogue = catalogue.map(({ id, name }) => ({ id, name }));
  return { merchant: publicMerchant, catalogue: publicCatalogue, shop, prefill, actionUrl };
}

export async function runRequestAction({ shop, formData, requestUrl }) {
  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) throw new Response("Not found", { status: 404 });

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
      const item = await prisma.serviceCatalogueItem.findFirst({ where: { id: catalogueItemId, merchantId: merchant.id, active: true } });
      if (!item) return { step: "details", orderNumber, email, formError: "Choose a service offered by this merchant." };
      serviceName = item.name;
    }

    let shopifyOrderId = null;
    let shopifyOrderName = orderNumber ? (orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`) : null;
    let shopifyProductId = null;
    let productTitle = String(formData.get("productTitle") || "").trim() || null;
    let productImageUrl = null;

    const selectedIndex = formData.get("selectedLineItem");
    // Reverify order ownership on submission; hidden JSON is presentation only.
    if (orderNumber) {
      const verified = await findOrderForCustomer({ shop, orderNumber, email });
      if (verified.found) {
        shopifyOrderId = verified.shopifyOrderId;
        shopifyOrderName = verified.shopifyOrderName;
        const index = Number(selectedIndex);
        const chosen = selectedIndex !== null && selectedIndex !== "" && Number.isInteger(index) ? verified.lineItems[index] : null;
        if (chosen) { productTitle = chosen.title; shopifyProductId = chosen.shopifyProductId; productImageUrl = chosen.imageUrl || null; }
      }
    }

    let photos = null;
    const photoFile = formData.get("photo");
    if (photoFile && typeof photoFile === "object" && photoFile.size > 0) {
      if (photoFile.size > 5000000 || !["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
        return { step: "details", orderNumber, email, formError: "Choose a JPEG, PNG or WebP photograph up to 5 MB." };
      }
      const buffer = Buffer.from(await photoFile.arrayBuffer());
      photos = [`data:${photoFile.type};base64,${buffer.toString("base64")}`];
    }

    // Enforced here — at the moment a real case is actually created — not
    // when the merchant sends an invite. A merchant can send as many
    // invites as they like; only real submissions count toward the free
    // plan's monthly allowance. Kept deliberately vague to the customer
    // (no mention of billing/plans on a public-facing page); the merchant
    // sees the real reason on their Billing page.
    const limitCheck = await checkAndIncrementCaseCount(merchant.id);
    if (!limitCheck.allowed) {
      console.warn(`[CARE] Free plan limit reached for shop ${shop} — request blocked.`);
      return {
        step: "details",
        lookup: JSON.parse(String(formData.get("lookupJson") || "{}")),
        orderNumber,
        email,
        formError:
          "We're not able to accept new requests online right now — please contact us directly and we'll help you out.",
      };
    }

    const careCase = await createCareCase(merchant.id, {
      customerName: name,
      customerEmail: email,
      shopifyOrderId,
      shopifyOrderName,
      shopifyProductId,
      productTitle,
      productImageUrl,
      catalogueItemId,
      serviceName,
      issueDescription,
      photos,
    });

    const appUrl = publicOrigin(requestUrl);
    const trackingUrl = `${appUrl}/care/${careCase.token}`;
    await sendCaseReceivedEmail({ careCase, merchant, trackingUrl });

    // Let the merchant know a new case landed, not just the customer. Uses
    // Shopify's embedded-admin URL pattern so the link opens straight to
    // this case inside the app, in whatever store it's installed on.
    const adminUrl = `https://${merchant.shop}/admin/apps/${process.env.SHOPIFY_API_KEY || ""}/app/cases/${careCase.id}`;
    await sendNewCaseAlertEmail({ careCase, merchant, adminUrl });

    return { step: "done", trackingUrl, customerEmail: email };
  }

  return { step: "start" };
}
