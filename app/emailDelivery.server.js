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
        provider: result.provider || provider,
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
  let querySecret = "";
  try {
    querySecret = new URL(request.url).searchParams.get("secret") || "";
  } catch {
    querySecret = "";
  }
  const supplied = request.headers.get("X-Email-Webhook-Secret") || querySecret;
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

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function eventDate(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const milliseconds = value > 10_000_000_000 ? value : value * 1000;
      const date = new Date(milliseconds);
      if (Number.isFinite(date.getTime())) return date;
    }
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date;
      if (/^\d+$/.test(value.trim())) {
        const numeric = Number(value);
        const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        const numericDate = new Date(milliseconds);
        if (Number.isFinite(numericDate.getTime())) return numericDate;
      }
    }
  }
  return new Date();
}

function eventRecordId(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return firstString(value.emailRecordId, value.email_record_id, value["X-CL-Email-Record-ID"]);
  }
  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    return eventRecordId(parsed);
  } catch {
    return text.match(/emailRecordId[=:"'\s]+([A-Za-z0-9_-]+)/)?.[1] || "";
  }
}

export function normaliseProviderEvent(event, providerHint = "") {
  const provider = String(providerHint || event?.provider || event?.Provider || "").trim().toLowerCase();
  if (provider === "postmark" || event?.RecordType) {
    const status = { Delivery: "delivered", Bounce: "failed", SpamComplaint: "complained", SubscriptionChange: "suppressed" }[event?.RecordType];
    if (!status || (event.RecordType === "SubscriptionChange" && !event.SuppressSending)) return null;
    return {
      provider: "postmark",
      providerMessageId: firstString(event.MessageID),
      recipient: normaliseRecipient(event.Recipient || event.Email),
      occurredAt: eventDate(event.DeliveredAt, event.BouncedAt, event.ChangedAt),
      type: String(event.RecordType),
      status,
      description: firstString(event.Description, event.Type),
      emailRecordId: eventRecordId(event.Metadata),
    };
  }

  if (provider === "brevo") {
    const type = firstString(event.event, event.Event, event.status).toLowerCase();
    const status = {
      request: "accepted", sent: "accepted", delivered: "delivered", deferred: "unknown",
      hard_bounce: "failed", soft_bounce: "failed", blocked: "suppressed",
      spam: "complained", invalid_email: "failed", error: "failed", unsubscribed: "suppressed",
    }[type];
    if (!status) return null;
    return {
      provider: "brevo",
      providerMessageId: firstString(event["message-id"], event.messageId, event.message_id, event.uuid),
      recipient: normaliseRecipient(event.email || event.recipient || event.to),
      occurredAt: eventDate(event.ts_event, event.ts_epoch, event.date, event.time),
      type,
      status,
      description: firstString(event.reason, event.description, event.subject),
      emailRecordId: eventRecordId(event.metadata || event.Metadata || event["X-Mailin-custom"] || event["X-CL-Email-Record-ID"]),
    };
  }

  if (provider === "smtp2go") {
    const type = firstString(event.event, event.type, event.status).toLowerCase();
    const status = {
      processed: "accepted", sent: "accepted", delivered: "delivered", deferred: "unknown",
      bounce: "failed", bounced: "failed", rejected: "failed", reject: "failed",
      spam: "complained", spam_complaint: "complained", unsubscribe: "suppressed", unsubscribed: "suppressed",
    }[type];
    if (!status) return null;
    return {
      provider: "smtp2go",
      providerMessageId: firstString(event["message-id"], event.message_id, event.messageId, event.email_id, event.id),
      recipient: normaliseRecipient(event.recipient || event.email || event.to),
      occurredAt: eventDate(event.time, event.timestamp, event.date),
      type,
      status,
      description: firstString(event.reason, event.description, event.error, event.bounce),
      emailRecordId: eventRecordId(event.metadata || event.headers || event["X-CL-Email-Record-ID"]),
    };
  }

  if (provider === "mailersend") {
    const data = event.data || {};
    const email = data.email || {};
    const recipient = data.recipient || email.recipient || {};
    const type = firstString(event.type, data.type, data.event).replace(/^activity\./, "").toLowerCase();
    const status = {
      queued: "accepted", sent: "accepted", delivered: "delivered", soft_bounced: "failed",
      hard_bounced: "failed", bounced: "failed", rejected: "failed", spam_complaint: "complained",
      unsubscribed: "suppressed",
    }[type];
    if (!status) return null;
    return {
      provider: "mailersend",
      providerMessageId: firstString(email.message_id, email.id, data.message_id, data.id, event.message_id),
      recipient: normaliseRecipient(recipient.email || data.email || event.email),
      occurredAt: eventDate(data.created_at, data.timestamp, event.created_at),
      type,
      status,
      description: firstString(data.reason, data.description, email.subject),
      emailRecordId: eventRecordId(data.metadata || email.metadata || event.metadata),
    };
  }

  return null;
}

function shouldApplyRecipientStatus(current, status, occurredAt) {
  if (terminal.has(status)) return true;
  if (terminal.has(current.status)) return false;
  if (current.status === "delivered" && status === "accepted") return false;
  if (current.eventAt && occurredAt < current.eventAt) return false;
  return true;
}

export async function applyProviderEvent(event, providerHint = "") {
  const normalised = normaliseProviderEvent(event, providerHint);
  if (!normalised) return { ignored: true };
  const { provider, providerMessageId, recipient, occurredAt, type, status, description, emailRecordId } = normalised;
  if (typeof providerMessageId !== "string" || !providerMessageId || !recipient || !Number.isFinite(occurredAt.getTime())) {
    return { invalid: true };
  }
  const message = await db.emailMessage.findFirst({ where: {
    OR: [
      { provider, providerMessageId },
      ...(emailRecordId ? [{ id: emailRecordId }] : []),
    ],
  }, include: { recipients: true } });
  // Old messages and redacted records are acknowledged, never recreated.
  if (!message || !message.recipients.some(r => r.email === recipient)) return { ignored: true };
  const eventKey = createHash("sha256").update(JSON.stringify([
    provider, providerMessageId, recipient, type, occurredAt.toISOString(),
  ])).digest("hex");
  try {
    await db.$transaction(async tx => {
      await tx.emailDeliveryEvent.create({ data: { eventKey, messageId: message.id, recipient, type, occurredAt } });
      const current = await tx.emailRecipient.findUnique({ where: { messageId_email: { messageId: message.id, email: recipient } } });
      if (shouldApplyRecipientStatus(current, status, occurredAt)) {
        await tx.emailRecipient.update({ where: { id: current.id }, data: { status, eventAt: occurredAt } });
      }
      const recipients = await tx.emailRecipient.findMany({ where: { messageId: message.id } });
      await tx.emailMessage.update({ where: { id: message.id }, data: {
        provider, providerMessageId, status: aggregate(recipients),
        ...(terminal.has(status) && current.role === "to" ? { reason: String(description || "The provider reported a delivery problem.").slice(0, 500) } : {}),
      } });
    });
  } catch (error) {
    if (error.code === "P2002") return { duplicate: true };
    throw error;
  }
  return { processed: true };
}

export async function applyPostmarkEvent(event) {
  return applyProviderEvent(event, "postmark");
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
