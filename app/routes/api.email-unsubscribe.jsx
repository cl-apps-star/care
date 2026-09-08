import { createHash } from "node:crypto";
import db from "../db.server";
import { verifyEmailUnsubscribeToken } from "../emailHeaders.server.js";

const terminal = new Set(["failed", "suppressed", "complained"]);

function page(message, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preferences</title></head><body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:40px;line-height:1.5;color:#1c1b19;background:#fffaf2;"><main style="max-width:560px;margin:auto;background:#fff;padding:32px;border:1px solid #eadfce;border-radius:18px;"><p style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a6b3d;">CL Apps</p><h1 style="font-size:28px;margin:0 0 16px;">Email preferences</h1><p>${message}</p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function aggregate(recipients) {
  const primary = recipients.filter(r => r.role === "to");
  const bad = primary.find(r => terminal.has(r.status));
  if (bad) return bad.status;
  if (primary.length && primary.every(r => r.status === "delivered")) return "delivered";
  if (primary.some(r => r.status === "unknown")) return "unknown";
  return "accepted";
}

function unsubscribeEventKey(messageId, recipient) {
  return createHash("sha256").update(JSON.stringify(["list-unsubscribe", messageId, recipient])).digest("hex");
}

export async function loader() {
  return page("This link is used by mailbox providers for one-click unsubscribe requests. To stop customer update emails from a message, use the unsubscribe control shown by your email app, or reply to the sender for help.");
}

export async function action({ request }) {
  const url = new URL(request.url);
  const messageId = url.searchParams.get("message") || "";
  const token = url.searchParams.get("token") || "";
  if (!verifyEmailUnsubscribeToken(messageId, token)) return new Response("Invalid unsubscribe token", { status: 400 });

  const message = await db.emailMessage.findUnique({ where: { id: messageId }, include: { recipients: true } });
  if (!message) return new Response("", { status: 202 });
  const recipients = message.recipients.filter(recipient => recipient.role === "to");
  if (!recipients.length) return new Response("", { status: 202 });

  const occurredAt = new Date();
  await db.$transaction(async tx => {
    for (const recipient of recipients) {
      await tx.emailDeliveryEvent.create({
        data: {
          eventKey: unsubscribeEventKey(message.id, recipient.email),
          messageId: message.id,
          recipient: recipient.email,
          type: "ListUnsubscribe",
          occurredAt,
        },
      }).catch(error => { if (error.code !== "P2002") throw error; });
    }
    await tx.emailRecipient.updateMany({
      where: { messageId: message.id, role: "to" },
      data: { status: "suppressed", eventAt: occurredAt },
    });
    const updatedRecipients = await tx.emailRecipient.findMany({ where: { messageId: message.id } });
    await tx.emailMessage.update({
      where: { id: message.id },
      data: {
        status: aggregate(updatedRecipients),
        reason: "Recipient requested not to receive these customer update emails.",
      },
    });
  });

  return new Response("", { status: 202 });
}
