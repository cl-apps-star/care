import test from "node:test";
import assert from "node:assert/strict";
import db from "../app/db.server.js";
import { getOrCreateMerchantProfile, updateMerchantProfile, createCareCase, getCaseByToken, addInternalNote, setQuote, sendQuote, approveQuote } from "../app/care.server.js";
import { customerEmailEnabled, submittedSendingPreference } from "../app/sendingPreference.js";
import { isLocalCarePreview } from "../app/localPreview.server.js";
import { sendCaseReceivedEmail } from "../app/email.server.js";
import { quoteFingerprint } from "../app/quoteFingerprint.server.js";
import { loadRequestPageData } from "../app/care-request.server.js";

test.after(async () => { await db.$disconnect(); });
test("new Care installations default customer email off", async () => {
  const profile = await getOrCreateMerchantProfile("new-care.myshopify.com");
  assert.equal(profile.automaticEmail, false); assert.equal(customerEmailEnabled(profile), false);
});
test("a pre-release settings form cannot silently overwrite an existing sending preference", () => {
  const form = new FormData();
  assert.deepEqual(submittedSendingPreference(form), {});
  form.set("emailPreferenceReviewed", "1");
  assert.deepEqual(submittedSendingPreference(form), { automaticEmail: false });
  form.set("automaticEmail", "on");
  assert.deepEqual(submittedSendingPreference(form), { automaticEmail: true });
});
test("existing Care merchants retain null legacy entitlement, branding, billing and usage", async () => {
  await db.merchantProfile.create({ data: { shop: "existing-care.myshopify.com", brandName: "Existing Studio", primaryColor: "#765432", plan: "studio", planStatus: "active", shopifyChargeId: "legacy-charge", casePeriodCount: 3 } });
  const profile = await getOrCreateMerchantProfile("existing-care.myshopify.com");
  assert.equal(profile.automaticEmail, null); assert.equal(customerEmailEnabled(profile), true);
  assert.equal(profile.plan, "studio"); assert.equal(profile.casePeriodCount, 3); assert.equal(profile.primaryColor, "#765432");
  await updateMerchantProfile(profile.shop, { brandName: "Revised Studio", automaticEmail: false });
  const updated = await getOrCreateMerchantProfile(profile.shop);
  assert.equal(updated.plan, "studio"); assert.equal(updated.shopifyChargeId, "legacy-charge"); assert.equal(updated.casePeriodCount, 3);
});
test("Care keeps its request, assessment, quote and customer approval workflow", async () => {
  const merchant = await getOrCreateMerchantProfile("new-care.myshopify.com");
  const record = await createCareCase(merchant.id, { customerName: "Alex", customerEmail: "alex@example.com", productTitle: "Signet ring", serviceName: "Repair assessment", issueDescription: "Inspect the finish" });
  await addInternalNote(record.id, "Private assessment marker 42718");
  const publicRecord = await getCaseByToken(record.token);
  assert.equal(publicRecord.updates.some(row => row.note?.includes("42718")), false);
  await setQuote(record.id, { labourCost: 40, partsCost: 10, shippingCost: 5, taxPercent: 20, currency: "GBP", note: "Surface restoration" });
  await sendQuote(record.id);
  const quoted = await db.careCase.findUnique({ where: { id: record.id } });
  assert.equal(quoted.quoteTotal, 66); assert.equal(quoted.status, "quote_sent");
  await approveQuote(record.id);
  const approved = await db.careCase.findUnique({ where: { id: record.id } });
  assert.equal(approved.status, "approved"); assert.equal(approved.shopifyDraftOrderId, null);
});
test("the public Care request page omits billing, usage and sending preferences", async () => {
  const merchant = await getOrCreateMerchantProfile("existing-care.myshopify.com");
  await db.serviceCatalogueItem.create({ data: { merchantId: merchant.id, name: "Repair assessment", pricingType: "quote", position: 0 } });
  const result = await loadRequestPageData({ shop: merchant.shop, actionUrl: "/care/request" });
  assert.deepEqual(Object.keys(result.merchant).sort(), ["accentColor", "brandName", "logoUrl", "primaryColor", "shop", "supportEmail"]);
  assert.equal(result.merchant.brandName, "Revised Studio");
  assert.equal(JSON.stringify(result).includes("legacy-charge"), false);
  assert.deepEqual(Object.keys(result.catalogue[0]).sort(), ["id", "name"]);
});
test("the Care preview never sends external email", async () => {
  const merchant = await getOrCreateMerchantProfile("new-care.myshopify.com");
  const record = await db.careCase.findFirst({ where: { merchantId: merchant.id } });
  const result = await sendCaseReceivedEmail({ careCase: record, merchant, trackingUrl: `http://127.0.0.1:3202/care/${record.token}` });
  assert.equal(result.skipped, true); assert.match(result.reason, /preview/);
  assert.equal(await db.emailMessage.count(), 0);
});
test("customers cannot approve an unseen replacement quote", async () => {
  const merchant = await getOrCreateMerchantProfile("new-care.myshopify.com");
  const record = await createCareCase(merchant.id, { customerName: "Sam", customerEmail: "sam@example.com", productTitle: "Pendant", serviceName: "Repair", issueDescription: "Assess the clasp" });
  await setQuote(record.id, { labourCost: 20, currency: "GBP" }); await sendQuote(record.id);
  const before = await db.careCase.findUnique({ where: { id: record.id } });
  await setQuote(record.id, { labourCost: 40, currency: "GBP" });
  await assert.rejects(approveQuote(record.id, quoteFingerprint(before)), /quote has changed/);
  assert.equal((await db.careCase.findUnique({ where: { id: record.id } })).status, "quote_sent");
});
test("Care's authentication preview fails closed in production and for external databases", () => {
  const original = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    assert.throws(isLocalCarePreview, /preview requires/);
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://example.com/cl_care_preview";
    assert.throws(isLocalCarePreview, /preview requires/);
  } finally { process.env = original; }
});
