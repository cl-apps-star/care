import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { STUDIO_PLAN } from "../planConstants";
import prisma from "../db.server";

// Shopify sends the merchant back here after they approve (or decline) the
// charge on Shopify's confirmation page. This route didn't exist before —
// app.billing.upgrade.jsx already builds its returnUrl to point at
// /app/billing/callback, but with no route file to handle it, that return
// trip 404'd. That's exactly the reviewer-reported bug (1.2.2): "After
// accepting the charges, I'm shown a 404 error." Mirrors Digital Unboxing's
// and In the Making's app.billing.callback.jsx — we re-check with Shopify
// directly (never trust the redirect alone) before marking the shop paid.
export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);

  const check = await billing.check({ plans: [STUDIO_PLAN] });

  if (check.hasActivePayment) {
    const subs = check.appSubscriptions || [];
    const subscription = subs.find((s) => s?.name === STUDIO_PLAN) || subs[0];

    // Reset the usage counter on a plan change — free and Studio have
    // separate, unrelated monthly allowances, so cases already started
    // shouldn't eat into the new plan's allowance.
    await prisma.merchantProfile.upsert({
      where: { shop: session.shop },
      update: {
        plan: "studio",
        planStatus: "active",
        shopifyChargeId: subscription?.id || null,
        casePeriodCount: 0,
        casePeriodStart: new Date(),
      },
      create: {
        shop: session.shop,
        plan: "studio",
        planStatus: "active",
        shopifyChargeId: subscription?.id || null,
        casePeriodCount: 0,
        casePeriodStart: new Date(),
      },
    });

    return { status: "active" };
  }

  // Shopify reports no active paid subscription for this shop — reconcile
  // our record to free so a declined or cancelled charge can never leave a
  // stale paid state behind. updateMany avoids throwing if the shop has no
  // merchantProfile row yet.
  await prisma.merchantProfile.updateMany({
    where: { shop: session.shop },
    data: { plan: "free", planStatus: null, shopifyChargeId: null },
  });

  return { status: "none" };
};

export default function BillingCallback() {
  const { status } = useLoaderData();
  const approved = status === "active";

  // Deliberately an s-link, NOT navigate()/<Link> — React Router's
  // client-side navigation does nothing in this embedded app, which would
  // strand the merchant on this screen. s-link (App Bridge nav) is the
  // proven way back into the admin, and it keeps the app embedded.
  return (
    <s-page heading={approved ? "Plan confirmed" : "No change made"}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {approved
              ? "Your Studio plan is confirmed — you're all set."
              : "No paid plan is active on your shop. If you meant to upgrade, head back to Billing and try again."}
          </s-paragraph>
          <s-link href="/app/billing">
            <span
              style={{
                display: "inline-block",
                background: "#1a1a1a",
                color: "#ffffff",
                fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                padding: "10px 18px",
                borderRadius: 8,
              }}
            >
              Continue to Billing →
            </span>
          </s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
