import { useEffect } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { STUDIO_PLAN } from "../planConstants";

// Separate route (rather than an action on app.billing.jsx) so the
// confirmation-URL redirect Shopify's billing.request() throws can be
// caught and handed to App Bridge cleanly — same pattern as Digital
// Unboxing's and In the Making's app.billing.upgrade.jsx, including the
// same history of why this can't just be a thrown redirect Response
// (React Router v7's single-fetch headers issue, shopify-app-js#1976).
export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const requestedPlan = url.searchParams.get("plan") === "studio" ? STUDIO_PLAN : null;
  if (!requestedPlan) {
    return { error: "Unknown plan." };
  }

  const isTestShop = session.shop.includes("cl-test-store") || process.env.NODE_ENV !== "production";

  // The return trip from Shopify's approval page must land back inside the
  // embedded admin wrapper, not the raw Railway URL directly.
  const returnUrl = `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing/callback`;

  try {
    await billing.request({
      plan: requestedPlan,
      returnUrl,
      isTest: isTestShop,
    });
    return {
      error:
        "Shopify didn't return a confirmation link for your plan change. Please go back and try again — if it keeps happening, contact support.",
    };
  } catch (error) {
    if (error instanceof Response) {
      const confirmationUrl = error.headers.get("location");
      if (confirmationUrl) {
        return { confirmationUrl };
      }
      throw error;
    }
    console.error("[BILLING] billing.request() failed:", error);
    return {
      error:
        "Something went wrong starting your upgrade. Please go back and try again — if it keeps happening, contact support.",
    };
  }
};

export default function BillingUpgradeStep() {
  const data = useLoaderData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (!data?.confirmationUrl) return;
    if (typeof shopify?.open === "function") {
      shopify.open(data.confirmationUrl, { target: "_top" });
    } else {
      window.top.location.href = data.confirmationUrl;
    }
  }, [data, shopify]);

  if (data?.confirmationUrl) {
    return (
      <div style={{ padding: 40, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", lineHeight: 1.6 }}>
        <p>Taking you to Shopify to confirm your upgrade…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", maxWidth: 480, lineHeight: 1.6 }}>
      <p>{data?.error || "Something went wrong."}</p>
      <a href="/app/billing">Back to Billing</a>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
