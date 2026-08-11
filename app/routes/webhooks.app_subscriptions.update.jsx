import { authenticate, unauthenticated } from "../shopify.server";
import { STUDIO_PLAN } from "../planConstants";
import prisma from "../db.server";

// Ask Shopify directly which subscriptions are currently ACTIVE for this
// shop rather than trusting a single webhook payload's status — an
// app_subscriptions/update webhook fires for ONE subscription and says
// nothing about the others. This is the exact bug that got Digital
// Unboxing & COA Kit rejected on submission (1.2.2): its handler set the
// whole shop to "free" on ANY non-ACTIVE status, so declining an upgrade
// attempt wiped out an already-active Studio subscription. Care only has
// one paid plan today, so the practical risk is lower, but querying the
// real state costs nothing and rules the bug class out entirely.
async function resolveActivePlan(shop) {
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(
    `#graphql
      query ActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
          }
        }
      }`,
  );
  const body = await response.json();
  const active = body?.data?.currentAppInstallation?.activeSubscriptions || [];
  const studioSub = active.find(
    (s) => (s?.status || "").toUpperCase() === "ACTIVE" && s?.name === STUDIO_PLAN,
  );

  return {
    plan: studioSub ? "studio" : "free",
    shopifyChargeId: studioSub?.id || null,
  };
}

// Keeps our stored plan in sync when a subscription changes on Shopify's
// side (merchant cancels/upgrades from Shopify's own billing settings, a
// charge is declined, or Shopify expires/freezes it) rather than only
// through our own in-app Billing page.
export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session) {
    return new Response();
  }

  const { plan, shopifyChargeId } = await resolveActivePlan(shop);

  await prisma.merchantProfile.updateMany({
    where: { shop },
    data: {
      plan,
      planStatus: payload?.app_subscription?.status || null,
      shopifyChargeId,
      // Switching plans doesn't reset the usage counter mid-period — the
      // free limit only applies while actually on the free plan, so this
      // just keeps the stored plan accurate.
    },
  });

  return new Response();
};
