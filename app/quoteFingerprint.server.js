import { createHash } from "node:crypto";
export function quoteFingerprint(record) {
  return createHash("sha256").update(JSON.stringify([
    record.id, record.quoteLabourCost, record.quotePartsCost, record.quoteShippingCost,
    record.quoteTaxPercent, record.quoteTotal, record.quoteCurrency, record.quoteNote,
    record.updatedAt?.toISOString(),
  ])).digest("hex");
}
