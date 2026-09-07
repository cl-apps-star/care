import { createHash, timingSafeEqual } from "node:crypto";
import db from "./db.server";
import { sendTransactionalEmail as transport } from "./emailTransport.server";

const terminal = new Set(["failed", "suppressed", "complained"]);
export const emailStatusLabels = {
  sending: "Sending", accepted: "Sent to email provider", delivered: "Accepted by receiving mail server",
  failed: "Could not deliver", suppressed: "Sending blocked", complained: "Marked as spam by recipient",
  unknown: "Status unconfirmed",
};

export function normaliseRecipient(value) {
  const raw = String(value || "").trim();
  return (raw.match(/<([^<>]+)>/)?.[1] || raw).trim().toLowerCase();
}
function recipientsFor(email) {
  const recipients = new Map();
  for (const role of ["to", "cc", "bcc"]) {
    const values = Array.isArray(email[role]) ? email[role] : String(email[role] || "").split(",");
    for (const value of values) {
      const address = normaliseRecipient(value);
      if (address && !recipients.has(address)) recipients.set(address, { email: address, role });
    }
  }
  return [...recipients.values()];
}
function outcome(message, duplicate = false) {
  const accepted = ["accepted", "delivered"].includes(message.status);
  return {
    skipped: !accepted, provider: message.provider, providerMessageId: message.providerMessageId,
    emailRecordId: message.id, status: message.status, duplicate,
    reason: accepted ? undefined : message.reason || "This email already has a sending record. Check its status before sending again.",
  };
}

// All senders must supply context; no provider call can bypass recording.
// A database failure aborts sending, rather than creating an untraceable email.
export async function sendRecordedEmail(email) {
  const context = email.context || {};
  if (!context.shop || !context.kind) throw new Error("Email shop and kind are required.");
  const provider = email.provider || (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  const recipients = recipientsFor(email);
  const dedupeKey = context.dedupeKey
    ? createHash("sha256").update(`${context.shop}\0${context.dedupeKey}`).digest("hex") : null;
  let message;
  try {
    message = await db.emailMessage.create({ data: {
      shop: context.shop, kind: context.kind, resourceId: context.resourceId || null,
      updateId: context.updateId || null, dedupeKey, provider,
      subject: String(email.subject || "").slice(0, 998),
      recipients: { create: recipients },
      resources: { create: [...new Set(context.resourceIds || (context.resourceId ? [context.resourceId] : []))].map(resourceId => ({ resourceId })) },
    } });
  } catch (error) {
    if (error.code !== "P2002" || !dedupeKey) throw error;
    const previous = await db.emailMessage.findUnique({ where: { dedupeKey } });
    if (!previous) throw error;
    return outcome(previous, true);
  }
  let result;
  if (!recipients.some(r => r.role === "to")) {
    result = { skipped: true, status: "failed", reason: "No recipient email is available." };
  } else {
    try {
      result = await transport({ ...email, provider, metadata: { emailRecordId: message.id } });
    } catch {
      result = { skipped: true, status: "unknown", reason: "Sending could not be confirmed. Do not send again until the provider record has been checked." };
    }
  }
  const status = result.skipped ? result.status || "failed" : "accepted";
  const reason = result.reason ? String(result.reason).slice(0, 500) : null;
  try {
    // A callback can arrive before the send response. Never overwrite it.
    await db.$transaction(async tx => {
      await tx.emailMessage.update({ where: { id: message.id }, data: {
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      } });
      await tx.emailMessage.updateMany({ where: { id: message.id, status: "sending" }, data: { status, reason } });
      await tx.emailRecipient.updateMany({ where: { messageId: message.id, status: "sending" }, data: { status } });
    });
  } catch {
    // Metadata in the provider record permits later reconciliation if this
    // write fails. Never resend an email just because its local status failed.
    console.error("[EMAIL] acceptance_record_failed", JSON.stringify({
      emailRecordId: message.id, provider, providerMessageId: result.providerMessageId || null,
    }));
    return { ...result, skipped: true, emailRecordId: message.id, status: "unknown",
      reason: "The email may have been accepted, but its status could not be saved. Do not send again; contact support." };
  }
  return { ...result, emailRecordId: message.id, status };
}

export function authorisedEmailWebhook(request) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get("X-Email-Webhook-Secret") || "";
  const a = Buffer.from(supplied); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function aggregate(recipients) {
  const primary = recipients.filter(r => r.role === "to");
  const bad = primary.find(r => terminal.has(r.status));
  if (bad) return bad.status;
  if (primary.length && primary.every(r => r.status === "delivered")) return "delivered";
  if (primary.some(r => r.status === "unknown")) return "unknown";
  return "accepted";
}

export async function applyPostmarkEvent(event) {
  const statuses = { Delivery: "delivered", Bounce: "failed", SpamComplaint: "complained", SubscriptionChange: "suppressed" };
  const status = statuses[event?.RecordType];
  if (!status) return { ignored: true };
  if (event.RecordType === "SubscriptionChange" && !event.SuppressSending) return { ignored: true };
  const providerMessageId = event.MessageID;
  const recipient = normaliseRecipient(event.Recipient || event.Email);
  const occurredAt = new Date(event.DeliveredAt || event.BouncedAt || event.ChangedAt);
  if (typeof providerMessageId !== "string" || !recipient || !Number.isFinite(occurredAt.getTime())) {
    return { invalid: true };
  }
  const id = event.Metadata?.emailRecordId;
  const message = await db.emailMessage.findFirst({ where: {
    provider: "postmark",
    OR: [{ providerMessageId }, ...(typeof id === "string" ? [{ id, providerMessageId: null }] : [])],
  }, include: { recipients: true } });
  // Old messages and redacted records are acknowledged, never recreated.
  if (!message || !message.recipients.some(r => r.email === recipient)) return { ignored: true };
  const eventKey = createHash("sha256").update(JSON.stringify([
    "postmark", providerMessageId, recipient, event.RecordType, occurredAt.toISOString(),
  ])).digest("hex");
  try {
    await db.$transaction(async tx => {
      await tx.emailDeliveryEvent.create({ data: { eventKey, messageId: message.id, recipient, type: event.RecordType, occurredAt } });
      const current = await tx.emailRecipient.findUnique({ where: { messageId_email: { messageId: message.id, email: recipient } } });
      // Failure is terminal for this attempt; a late delivery must not clear it.
      if (!terminal.has(current.status) || terminal.has(status)) {
        if (!current.eventAt || occurredAt >= current.eventAt || terminal.has(status)) {
          await tx.emailRecipient.update({ where: { id: current.id }, data: { status, eventAt: occurredAt } });
        }
      }
      const recipients = await tx.emailRecipient.findMany({ where: { messageId: message.id } });
      await tx.emailMessage.update({ where: { id: message.id }, data: {
        providerMessageId, status: aggregate(recipients),
        ...(terminal.has(status) && current.role === "to" ? { reason: String(event.Description || event.Type || "The provider reported a delivery problem.").slice(0, 500) } : {}),
      } });
    });
  } catch (error) {
    if (error.code === "P2002") return { duplicate: true };
    throw error;
  }
  return { processed: true };
}

export async function listEmailMessages(shop, resourceId) {
  return db.emailMessage.findMany({ where: { shop, ...(resourceId ? { resourceId } : {}) },
    orderBy: { createdAt: "desc" }, take: 100,
    include: { recipients: true },
  });
}

export async function redactEmailRecords(shop, email, resourceIds = []) {
  const OR = [
    ...(email ? [{ recipients: { some: { email: normaliseRecipient(email) } } }] : []),
    ...(resourceIds.length ? [{ resources: { some: { resourceId: { in: resourceIds } } } }] : []),
  ];
  await db.emailMessage.deleteMany({ where: { shop, ...(email || resourceIds.length ? { OR } : {}) } });
}
