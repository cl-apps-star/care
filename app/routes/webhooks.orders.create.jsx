// app/routes/webhooks.orders.create.jsx
//
// New for Care. Closes the loop the draft-order flow opens: when a
// customer pays their repair invoice, Shopify turns that draft order
// into a real Order and fires this webhook. We match it back to the
// CareCase via the custom attribute set at draft-order creation time
// (see care-payment.server.js) and flip the case to paid automatically
// — no merchant action needed.
//
// Matches the GDPR webhook routes' existing pattern in this app
// (authenticate.webhook, plain Response() on completion).

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { markPaid } from "../care.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const attributes = payload.note_attributes || [];
  const caseIdAttr = attributes.find((a) => a.name === "care_case_id");
  if (!caseIdAttr?.value) {
    // Most orders/create events won't be a Care draft order at all —
    // that's expected and not an error, just nothing for this webhook
    // to do.
    return new Response();
  }

  const careCase = await prisma.careCase.findUnique({ where: { id: caseIdAttr.value } });
  if (!careCase) {
    console.error(`[CARE] orders/create referenced unknown case ${caseIdAttr.value}`);
    return new Response();
  }

  await markPaid(careCase.id, String(payload.id));
  console.log(`[CARE] Case ${careCase.id} marked paid via order ${payload.name || payload.id}`);

  return new Response();
};
