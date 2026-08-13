import prisma from "./db.server";
import { DEFAULT_CARE_STAGES, nextStage, isTerminal } from "./care-stages";
import { createDraftOrderForQuote } from "./care-payment.server";

// ---- Merchant profile / branding ----------------------------------------

export async function getOrCreateMerchantProfile(shop) {
    let profile = await prisma.merchantProfile.findUnique({ where: { shop } });
    if (!profile) {
          profile = await prisma.merchantProfile.create({ data: { shop } });
    }
    return profile;
}

export async function updateMerchantProfile(shop, data) {
    return prisma.merchantProfile.update({
          where: { shop },
          data,
    });
}

// ---- Service catalogue ----------------------------------------------------

export async function listCatalogue(merchantId) {
    return prisma.serviceCatalogueItem.findMany({
          where: { merchantId },
          orderBy: { position: "asc" },
    });
}

export async function createCatalogueItem(merchantId, data) {
    const count = await prisma.serviceCatalogueItem.count({ where: { merchantId } });
    return prisma.serviceCatalogueItem.create({
          data: { ...data, merchantId, position: count },
    });
}

export async function updateCatalogueItem(id, data) {
    return prisma.serviceCatalogueItem.update({ where: { id }, data });
}

export async function deleteCatalogueItem(id) {
    return prisma.serviceCatalogueItem.update({
          where: { id },
          data: { active: false },
    });
}

// ---- Care cases -------------------------------------------------------

export async function createCareCase(merchantId, input) {
    const careCase = await prisma.careCase.create({
          data: {
                  merchantId,
                  shopifyOrderId: input.shopifyOrderId ?? null,
                  shopifyOrderName: input.shopifyOrderName ?? null,
                  shopifyProductId: input.shopifyProductId ?? null,
                  productTitle: input.productTitle ?? null,
                  productImageUrl: input.productImageUrl ?? null,
                  customerName: input.customerName,
                  customerEmail: input.customerEmail,
                  catalogueItemId: input.catalogueItemId ?? null,
                  serviceName: input.serviceName,
                  issueDescription: input.issueDescription ?? null,
                  photos: input.photos ? JSON.stringify(input.photos) : null,
                  videos: input.videos ? JSON.stringify(input.videos) : null,
                  status: "request_received",
          },
    });

  await prisma.careUpdate.create({
        data: {
                caseId: careCase.id,
                status: "request_received",
                note: "Request received.",
                visibleToCustomer: true,
        },
  });

  return careCase;
}

export async function getCaseByToken(token) {
    return prisma.careCase.findUnique({
          where: { token },
          include: {
                  updates: { orderBy: { createdAt: "asc" } },
                  catalogueItem: true,
                  merchant: true,
          },
    });
}

export async function getCaseById(id, merchantId) {
    return prisma.careCase.findFirst({
          where: { id, merchantId },
          include: {
                  updates: { orderBy: { createdAt: "asc" } },
                  catalogueItem: true,
          },
    });
}

export async function listCasesForMerchant(merchantId, { statusIn } = {}) {
    return prisma.careCase.findMany({
          where: {
                  merchantId,
                  ...(statusIn ? { status: { in: statusIn } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          include: { catalogueItem: true },
    });
}

// Advance a case to the next default stage, or to an explicit status
// (e.g. "declined"). Optionally attaches a note/media and flags whether
// the customer should be notified - caller wires the actual email send.
export async function advanceCase(caseId, { status, note, media, notifyCustomer = true } = {}) {
    const current = await prisma.careCase.findUnique({ where: { id: caseId } });
    if (!current) throw new Error("Case not found");

  const targetStatus = status ?? nextStage(current.status)?.key;
    if (!targetStatus) throw new Error("Already at the final stage");

  const data = { status: targetStatus };
    if (targetStatus === "completed") data.completedAt = new Date();
    if (targetStatus === "quote_sent") data.quoteSentAt = new Date();
    if (targetStatus === "approved") data.quoteApprovedAt = new Date();
    if (targetStatus === "declined") data.quoteDeclinedAt = new Date();

  const updated = await prisma.careCase.update({ where: { id: caseId }, data });

  const update = await prisma.careUpdate.create({
        data: {
                caseId,
                status: targetStatus,
                note: note ?? null,
                media: media ? JSON.stringify(media) : null,
                visibleToCustomer: true,
                customerNotified: notifyCustomer,
        },
  });

  return { case: updated, update };
}

export async function addInternalNote(caseId, note) {
    return prisma.careUpdate.create({
          data: { caseId, note, visibleToCustomer: false, customerNotified: false },
    });
}

// ---- Quote builder ---------------------------------------------------

// Tax is entered by the merchant as a PERCENTAGE (e.g. "20" meaning 20%),
// not a flat cash amount — matches how sales/VAT tax is actually quoted.
// It's calculated here off the subtotal (labour + parts + shipping) and
// stored two ways: quoteTaxPercent (what the merchant typed, so the form
// shows it back correctly if they reopen/edit the quote) and quoteTax
// (the resulting CASH amount — everything downstream, the customer's quote
// breakdown, the Shopify draft order line item in care-payment.server.js,
// still reads a real currency amount, not a percent).
export async function setQuote(caseId, { labourCost = 0, partsCost = 0, shippingCost = 0, taxPercent = 0, note, currency = "GBP" }) {
    // Guard every field against blank/malformed input producing NaN — a NaN
    // quoteTotal gets silently written as NULL by Postgres, which used to
    // leave the customer tracking page with no quote to show and no
    // approve/decline buttons at all. `|| 0` ensures a real number always
    // lands here.
    const safeLabour = Number(labourCost) || 0;
    const safeParts = Number(partsCost) || 0;
    const safeShipping = Number(shippingCost) || 0;
    const safeTaxPercent = Number(taxPercent) || 0;
    const subtotal = safeLabour + safeParts + safeShipping;
    const taxAmount = Math.round(subtotal * (safeTaxPercent / 100) * 100) / 100;
    const total = subtotal + taxAmount;
    const updated = await prisma.careCase.update({
          where: { id: caseId },
          data: {
                  quoteLabourCost: safeLabour,
                  quotePartsCost: safeParts,
                  quoteShippingCost: safeShipping,
                  quoteTaxPercent: safeTaxPercent,
                  quoteTax: taxAmount,
                  quoteTotal: total,
                  quoteCurrency: currency,
                  quoteNote: note ?? null,
          },
    });
    return updated;
}

export async function sendQuote(caseId) {
    return advanceCase(caseId, {
          status: "quote_sent",
          note: "Quote sent to customer.",
          notifyCustomer: true,
    });
}

export async function approveQuote(caseId) {
    const updated = await advanceCase(caseId, {
          status: "approved",
          note: "Customer approved the quote.",
          notifyCustomer: true,
    });
    await prisma.careCase.update({ where: { id: caseId }, data: { paymentStatus: "unpaid" } });
    return updated;
}

export async function declineQuote(caseId) {
    return advanceCase(caseId, {
          status: "declined",
          note: "Customer declined the quote.",
          notifyCustomer: true,
    });
}

export async function markPaid(caseId, shopifyOrderIdForPayment) {
    return prisma.careCase.update({
          where: { id: caseId },
          data: { paymentStatus: "paid", shopifyOrderIdForPayment },
    });
}

// Called right after approveQuote() — creates the real, payable Shopify
// draft order for the case's quote and stores its invoice link so the
// customer tracking page can show a working "Pay now" button. Separate
// from markPaid(), which only fires later once the customer actually
// completes payment (see app/routes/webhooks.orders.create.jsx).
export async function createPayableOrderForCase(caseId, shop) {
    const careCase = await prisma.careCase.findUnique({ where: { id: caseId } });
    if (!careCase) throw new Error("Case not found");

  const { draftOrderId, invoiceUrl } = await createDraftOrderForQuote(careCase, shop);

  return prisma.careCase.update({
        where: { id: caseId },
        data: {
                shopifyDraftOrderId: draftOrderId,
                shopifyInvoiceUrl: invoiceUrl,
        },
  });
}

// ---- Invite links (personalized "start your request" links) -----------
// See the CareInvite model comment in schema.prisma for why this exists —
// short version: any query string on the invite link, even fully opaque,
// was enough to get these emails collapsed in Gmail. Storing the prefill
// server-side lets the email link to a clean /care/request/<token> path
// with no query string, matching every other Care email link that's never
// had the problem.
export async function createCareInvite(merchantId, { customerEmail, customerName, orderNumber, productTitle }) {
  return prisma.careInvite.create({
    data: { merchantId, customerEmail, customerName, orderNumber, productTitle },
  });
}

export async function getCareInviteByToken(token) {
  return prisma.careInvite.findUnique({
    where: { token },
    include: { merchant: true },
  });
}

export function caseIsAtFinalStage(careCase) {
    return isTerminal(careCase.status);
}

export const STAGES = DEFAULT_CARE_STAGES;
