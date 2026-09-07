import db from "./db.server";
import { applyPostmarkEvent } from "./emailDelivery.server";

async function postmarkGet(path) {
  const response = await fetch(`https://api.postmarkapp.com${path}`, {
    headers: { Accept: "application/json", "X-Postmark-Server-Token": process.env.POSTMARK_API_KEY },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Postmark reconciliation HTTP ${response.status}`);
  return response.json();
}

// Read-only provider checks. This function NEVER sends or retries an email.
export async function reconcileEmailMessages({ shop, limit = 10 } = {}) {
  if (!process.env.POSTMARK_API_KEY) return { unavailable: true };
  const messages = await db.emailMessage.findMany({ where: {
    ...(shop ? { shop } : {}), provider: "postmark", status: { in: ["sending", "unknown", "accepted"] },
    createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
  }, orderBy: { updatedAt: "asc" }, take: Math.min(10, Math.max(1, limit)) });
  let checked = 0, unconfirmed = 0, errors = 0;
  for (const message of messages) {
    try {
      let id = message.providerMessageId;
      if (!id) {
        const query = new URLSearchParams({ count: "2", offset: "0", metadata_emailRecordId: message.id,
          messagestream: process.env.POSTMARK_MESSAGE_STREAM || "outbound" });
        const matches = await postmarkGet(`/messages/outbound?${query}`);
        if (matches.TotalCount === 1 && matches.Messages?.[0]?.Metadata?.emailRecordId === message.id) id = matches.Messages[0].MessageID;
      }
      if (!id) {
        await db.emailMessage.updateMany({ where: { id: message.id, status: { in: ["sending", "unknown"] } },
          data: { status: "unknown", reason: "No unique provider record was found. Contact support before sending again." } });
        unconfirmed++; continue;
      }
      const details = await postmarkGet(`/messages/outbound/${encodeURIComponent(id)}/details`);
      if (details.MessageID !== id) throw new Error("Provider message ID mismatch");
      await db.$transaction(async tx => {
        await tx.emailMessage.update({ where: { id: message.id }, data: { providerMessageId: id } });
        await tx.emailMessage.updateMany({ where: { id: message.id, status: { in: ["sending", "unknown"] } }, data: { status: "accepted", reason: null } });
        await tx.emailRecipient.updateMany({ where: { messageId: message.id, status: { in: ["sending", "unknown"] } }, data: { status: "accepted" } });
      });
      for (const event of details.MessageEvents || []) {
        const RecordType = { Delivered: "Delivery", Bounced: "Bounce" }[event.Type];
        if (!RecordType) continue;
        await applyPostmarkEvent({ RecordType, MessageID: id, Recipient: event.Recipient,
          DeliveredAt: event.ReceivedAt, BouncedAt: event.ReceivedAt,
          Description: event.Details?.Summary });
      }
      checked++;
    } catch {
      errors++;
      console.error("[EMAIL] reconciliation_failed", JSON.stringify({ emailRecordId: message.id }));
    }
  }
  return { checked, unconfirmed, errors };
}
