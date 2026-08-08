import prisma from "../db.server";
import { stageLabel } from "../care-stages";

// Server-to-server partner endpoint — called by COA's certificate page to
// ask "does this shop have Care installed, and is there a case for this
// order?" so it can render a Care card on the return-visit tracker. Not a
// customer-facing route: authenticated with a shared secret header, not
// Shopify session auth.
//
// Contract (matches In the Making's /api/journey-lookup shape):
//   GET /api/order-lookup?shop=<shop>&orderName=<name>
//   -> { available, exists, status, statusLabel, token, serviceName }
//
// `available` = Care is installed for this shop at all (checked via a
// Session row, since MerchantProfile is only lazily created the first
// time the merchant opens the embedded app — a shop can have Care
// installed, with zero merchant setup done yet, and should still count
// as available so the customer sees a "request care" invitation).
// `exists` = a CareCase matches this specific order.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const orderName = url.searchParams.get("orderName");

  const partnerSecret = request.headers.get("X-Partner-Secret");
  if (!process.env.PARTNER_API_SECRET || partnerSecret !== process.env.PARTNER_API_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!shop) {
    return Response.json({ error: "missing_shop" }, { status: 400 });
  }

  const session = await prisma.session.findFirst({ where: { shop, isOnline: false } });
  if (!session) {
    return Response.json({ available: false, exists: false });
  }

  if (!orderName) {
    return Response.json({ available: true, exists: false });
  }

  // orderName may arrive with or without the leading "#" - normalize so
  // "#1003" and "1003" both match.
  const normalized = orderName.trim();
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  const withoutHash = normalized.startsWith("#") ? normalized.slice(1) : normalized;

  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) {
    return Response.json({ available: true, exists: false });
  }

  const careCase = await prisma.careCase.findFirst({
    where: {
      merchantId: merchant.id,
      shopifyOrderName: { in: [withHash, withoutHash] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!careCase) {
    return Response.json({ available: true, exists: false });
  }

  return Response.json({
    available: true,
    exists: true,
    status: careCase.status,
    statusLabel: stageLabel(careCase.status),
    token: careCase.token,
    serviceName: careCase.serviceName,
  });
};
