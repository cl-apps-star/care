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

  return (
        <s-page heading="Branding" backAction={{ url: "/app" }}>
                <s-section heading="How your Care pages and emails look">
                        <s-paragraph>
                                  This controls the branding on the customer-facing tracking page and
                                  emails - same idea as the branding settings in Reveal and In the
                                  Making, kept separately per app until the shared branding layer
                                  exists.
                        </s-paragraph>
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
                                              <s-button type="submit">Save</s-button>
                                  </s-stack>
                        </form>      </s-section>
        </s-page>
      );
}

export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};
</s-section>
