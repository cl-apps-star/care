import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateMerchantProfile, updateMerchantProfile } from "../care.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchantProfile(session.shop);
  return { merchant };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  await updateMerchantProfile(session.shop, {
    brandName: formData.get("brandName") || null,
    logoUrl: formData.get("logoUrl") || null,
    primaryColor: formData.get("primaryColor") || undefined,
    accentColor: formData.get("accentColor") || undefined,
    supportEmail: formData.get("supportEmail") || null,
  });
  return { ok: true };
};

export default function Branding() {
  const { merchant } = useLoaderData();
  const fetcher = useFetcher();
  const isSaving = fetcher.state !== "idle";
  // Save genuinely worked before this fix too — it just never told the
  // merchant it had. Clicking Save silently updated the database with no
  // banner, no button state change, nothing, so it looked broken even
  // though it wasn't. This surfaces the real fetcher result.
  const justSaved = fetcher.data?.ok === true;

  return (
    <s-page heading="Branding" backAction={{ url: "/app" }}>
      <s-section heading="How your customer pages and emails look">
        <s-paragraph>
          This shows up on your customer request form, tracking page, and every email your
          customers get about their case — so it's worth matching your store's look and feel.
        </s-paragraph>
        {justSaved && (
          <s-banner tone="success">
            <s-paragraph>Branding saved.</s-paragraph>
          </s-banner>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetcher.submit(new FormData(e.currentTarget), { method: "POST" });
          }}
        >
          <s-stack direction="block" gap="base">
            <s-text-field name="brandName" label="Brand / studio name" defaultValue={merchant.brandName ?? ""} />
            <s-text-field name="logoUrl" label="Logo URL" defaultValue={merchant.logoUrl ?? ""} />
            <s-text-field name="primaryColor" label="Primary colour" defaultValue={merchant.primaryColor ?? ""} />
            <s-text-field name="accentColor" label="Accent colour" defaultValue={merchant.accentColor ?? ""} />
            <s-text-field name="supportEmail" label="Support email" defaultValue={merchant.supportEmail ?? ""} />
            <s-button type="submit" loading={isSaving || undefined}>
              {isSaving ? "Saving…" : "Save"}
            </s-button>
          </s-stack>
        </form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
