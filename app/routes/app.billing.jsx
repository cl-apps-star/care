import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanSummary } from "../plan.server";
import { FREE_CASE_LIMIT, STUDIO_PLAN, STUDIO_PLAN_PRICE } from "../planConstants";
import styles from "../styles/care-admin.module.css";

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
    <s-page heading="Billing" inlineSize="large">
      <div className={`${styles.shell} ${styles.billingShell}`}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Plan & usage</p>
            <h1>Choose the pace that fits</h1>
            <p className={styles.lede}>Every plan includes the full branded customer experience.</p>
          </div>
        </header>

        <section className={styles.currentPlan}>
          <div>
            <span className={styles.currentPlanLabel}>Your plan</span>
            <h2>{currentPlan === "studio" ? "Studio" : "Free"}</h2>
            <p>{currentPlan === "studio" ? "Unlimited cases, with every Care feature included." : `${data.planSummary?.count ?? 0} of ${FREE_CASE_LIMIT} cases used this month.`}</p>
          </div>
          <div className={styles.usageMark}>
            <strong>{currentPlan === "studio" ? "∞" : Math.max(0, FREE_CASE_LIMIT - (data.planSummary?.count ?? 0))}</strong>
            <span>{currentPlan === "studio" ? "unlimited" : "remaining"}</span>
          </div>
        </section>

        {currentPlan === "free" ? (
          <section className={styles.planSection}>
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>More room</p>
              <h2>Studio</h2>
              <p>Upgrade when customer care becomes a regular part of your month.</p>
            </div>
            <article className={styles.planCard}>
              <div className={styles.planName}>
                <h3>Studio</h3>
                <p><strong>${STUDIO_PLAN_PRICE}</strong><span>/month</span></p>
              </div>
              <p>Unlimited cases. No change to your branding, workflow or customer experience.</p>
              <button type="button" onClick={goToUpgrade}>Upgrade to Studio</button>
            </article>
          </section>
        ) : hasActivePayment ? (
          <div className={styles.cancelRow}>
            <span>You can return to the free plan at any time.</span>
            <button type="button" onClick={cancel} disabled={isBusy}>{isBusy ? "Cancelling…" : "Cancel subscription"}</button>
          </div>
        ) : null}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
