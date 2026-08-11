import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanSummary } from "../plan.server";
import { FREE_CASE_LIMIT, STUDIO_PLAN, STUDIO_PLAN_PRICE } from "../planConstants";

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);

  const check = await billing.check({ plans: [STUDIO_PLAN] });
  const planSummary = await getPlanSummary(session.shop);

  return {
    hasActivePayment: check.hasActivePayment,
    planSummary,
    shop: session.shop,
  };
};

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "cancel") {
    const merchant = await prisma.merchantProfile.findUnique({
      where: { shop: session.shop },
    });

    if (merchant?.shopifyChargeId) {
      await billing.cancel({
        subscriptionId: merchant.shopifyChargeId,
        prorate: true,
      });
    }

    // Free and Studio have separate monthly allowances, so a count run up
    // under Studio (which is uncapped) shouldn't strand the shop over the
    // much smaller free limit for the rest of the month after cancelling.
    await prisma.merchantProfile.update({
      where: { shop: session.shop },
      data: {
        plan: "free",
        planStatus: null,
        shopifyChargeId: null,
        casePeriodCount: 0,
        casePeriodStart: new Date(),
      },
    });
  }

  const check = await billing.check({ plans: [STUDIO_PLAN] });
  const planSummary = await getPlanSummary(session.shop);
  return { hasActivePayment: check.hasActivePayment, planSummary, cancelled: intent === "cancel" };
};

export default function BillingPage() {
  const { hasActivePayment, planSummary, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const data = fetcher.data || { hasActivePayment, planSummary };
  const isBusy = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data?.cancelled) {
      shopify.toast.show("Subscription cancelled — you're back on the free plan.");
    }
  }, [fetcher.data, shopify]);

  const cancel = () => fetcher.submit({ intent: "cancel" }, { method: "POST" });

  const currentPlan = data.planSummary?.plan || "free"; // "free" | "studio"

  // Same reasoning as Digital Unboxing's Billing page: a normal in-app
  // navigation to the upgrade route (no query string carried over from the
  // address bar — a stale id_token there causes a 401), which reads
  // Shopify's confirmation URL as plain loader data and hands it to App
  // Bridge's own shopify.open() to break out of the embedded iframe.
  const goToUpgrade = () => navigate(`/app/billing/upgrade?plan=studio`);

  return (
    <s-page heading="Billing">
      <s-section heading="Your plan">
        <s-stack direction="block" gap="base">
          <s-badge tone={currentPlan === "free" ? "neutral" : "success"}>
            {currentPlan === "studio" ? "Studio plan" : "Free plan"}
          </s-badge>

          {currentPlan === "studio" ? (
            <s-paragraph>
              {data.planSummary?.count ?? 0} case{data.planSummary?.count === 1 ? "" : "s"} started
              this month. Studio has no monthly cap.
            </s-paragraph>
          ) : (
            <s-paragraph>
              {data.planSummary?.count ?? 0} of {FREE_CASE_LIMIT} free cases used this month. Every
              case — kit pick, manual entry, or the shared link — works the same on the free plan;
              Studio just removes the monthly cap.
            </s-paragraph>
          )}

          {currentPlan === "studio" && (
            <s-button variant="tertiary" tone="critical" onClick={cancel} {...(isBusy ? { loading: true } : {})}>
              Cancel subscription
            </s-button>
          )}
        </s-stack>
      </s-section>

      {currentPlan === "free" && (
        <s-section heading="Upgrade">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text fontWeight="medium">Studio — ${STUDIO_PLAN_PRICE}/month</s-text>
              <s-text tone="subdued">Unlimited cases a month, no other changes to how Care works.</s-text>
              <s-box paddingBlockStart="tight">
                <s-button onClick={goToUpgrade}>Upgrade to Studio</s-button>
              </s-box>
            </s-stack>
          </s-box>
        </s-section>
      )}

      <s-section slot="aside" heading="Why this matters">
        <s-paragraph>
          The free plan is genuinely usable for a few requests a month — every case still gets the
          full branded flow. Studio is for shops with steady monthly volume who don't want to think
          about a cap.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
