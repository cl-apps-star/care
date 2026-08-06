import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Mandatory GDPR compliance webhook - redact this customer's data.
// Blanks the identifying fields on their CareCase rows rather than
// deleting the case history outright (service records may need to be
// retained for warranty/accounting purposes per the merchant's own
// retention policy - revisit before public launch).
export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`, payload);

    const email = payload?.customer?.email;
    if (email) {
          await prisma.careCase.updateMany({
                  where: { customerEmail: email },
                  data: { customerEmail: "redacted@example.com", customerName: "Redacted" },
          });
    }

    return new Response();
};
