import { PrismaClient } from "@prisma/client";
import { isLocalCarePreview, carePreviewShop } from "../app/localPreview.server.js";
if (!isLocalCarePreview()) throw new Error("Preview seed is local only.");
const db = new PrismaClient();
const merchant = await db.merchantProfile.upsert({ where: { shop: carePreviewShop }, create: { shop: carePreviewShop, brandName: "Morrow Studio", primaryColor: "#294d43", accentColor: "#8a7758", supportEmail: "studio@example.com", automaticEmail: false }, update: {} });
if (!await db.serviceCatalogueItem.findFirst({ where: { merchantId: merchant.id } })) await db.serviceCatalogueItem.create({ data: { merchantId: merchant.id, name: "Repair assessment", description: "A careful assessment before work begins.", pricingType: "quote", currency: "GBP" } });
if (!await db.careCase.findFirst({ where: { merchantId: merchant.id } })) {
  const record = await db.careCase.create({ data: { merchantId: merchant.id, customerName: "Alex Taylor", customerEmail: "customer@example.com", productTitle: "Hand-finished signet ring", serviceName: "Repair assessment", issueDescription: "Please assess the setting and the surface finish.", status: "assessment", shopifyOrderName: "#1001" } });
  await db.careUpdate.create({ data: { caseId: record.id, status: "request_received", note: "Your request is with the studio.", visibleToCustomer: true } });
}
await db.$disconnect();
