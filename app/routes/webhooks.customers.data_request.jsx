import db from "../db.server";
import { authenticate } from "../shopify.server";

// Mandatory GDPR compliance webhook - a customer or Shopify has requested
// the data this app stores about a customer. We only key CareCase rows by
// name/email (no separate Customer table), so log for manual export today;
// automate a lookup-by-email export before public launch.
export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`, payload);
  const email = payload?.customer?.email;
  if (email) {
    const resources = await db.careCase.findMany({ where: { merchant: { shop }, customerEmail: email }, select: { id: true } });
    const emails = await db.emailMessage.findMany({
      where: { shop, OR: [{ recipients: { some: { email: email.trim().toLowerCase() } } }, { resources: { some: { resourceId: { in: resources.map(r => r.id) } } } }] },
      select: { id: true, kind: true, resourceId: true, updateId: true, subject: true, status: true, createdAt: true, providerMessageId: true },
    });
    console.log("[COMPLIANCE] Email records for the requested customer export", JSON.stringify(emails));
  }
  return new Response();
};
