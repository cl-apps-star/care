import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Mandatory GDPR compliance webhook - 48 hours after uninstall, Shopify
// asks us to erase all shop data.
export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`, payload);

    const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
    if (merchant) {
          const cases = await prisma.careCase.findMany({ where: { merchantId: merchant.id }, select: { id: true } });
          const caseIds = cases.map((c) => c.id);
          await prisma.careUpdate.deleteMany({ where: { caseId: { in: caseIds } } });
          await prisma.careCase.deleteMany({ where: { merchantId: merchant.id } });
          await prisma.serviceCatalogueItem.deleteMany({ where: { merchantId: merchant.id } });
          await prisma.merchantProfile.delete({ where: { id: merchant.id } });
    }

    return new Response();
};
