import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateMerchantProfile, updateMerchantProfile } from "../care.server";
import styles from "../styles/care-admin.module.css";

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
  const [preview, setPreview] = useState({
    brandName: merchant.brandName || "Your studio",
    logoUrl: merchant.logoUrl || "",
    primaryColor: merchant.primaryColor || "#1a1a1a",
    accentColor: merchant.accentColor || "#8a7758",
    supportEmail: merchant.supportEmail || "",
  });

  const updatePreview = (field) => (event) => {
    setPreview((current) => ({ ...current, [field]: event.currentTarget.value }));
  };

  return (
    <s-page heading="Branding & setup" backAction={{ url: "/app" }} inlineSize="large">
      <div className={styles.shell}>
        <div className={styles.twoColumn}>
          <main className={styles.formColumn}>
            <div className={styles.formIntro}>
              <p className={styles.eyebrow}>Make it yours</p>
              <h1>Brand your customer care</h1>
              <p className={styles.lede}>See every choice on the customer preview as you work.</p>
            </div>
            <form
              className={styles.formPanel}
              onSubmit={(e) => {
                e.preventDefault();
                fetcher.submit(new FormData(e.currentTarget), { method: "POST" });
              }}
            >
              <div className={styles.formGrid}>
                <label className={styles.textField}>
                  <span>Brand or studio name</span>
                  <input name="brandName" value={preview.brandName} onChange={updatePreview("brandName")} />
                </label>
                <label className={styles.textField}>
                  <span>Logo URL <small>optional</small></span>
                  <input name="logoUrl" type="url" value={preview.logoUrl} onChange={updatePreview("logoUrl")} placeholder="https://…" />
                </label>
                <div className={styles.fieldGrid}>
                  <label className={styles.textField}>
                    <span>Primary colour</span>
                    <input name="primaryColor" value={preview.primaryColor} onChange={updatePreview("primaryColor")} />
                  </label>
                  <label className={styles.textField}>
                    <span>Accent colour</span>
                    <input name="accentColor" value={preview.accentColor} onChange={updatePreview("accentColor")} />
                  </label>
                </div>
                <label className={styles.textField}>
                  <span>Customer contact email <small>optional</small></span>
                  <input name="supportEmail" type="email" value={preview.supportEmail} onChange={updatePreview("supportEmail")} placeholder="hello@yourstudio.com" />
                </label>
                <div className={styles.formActions}>
                  <s-button type="submit" loading={isSaving || undefined}>{isSaving ? "Saving…" : "Save branding"}</s-button>
                  {justSaved ? <span className={styles.saved}>Saved</span> : null}
                </div>
              </div>
            </form>
          </main>

          <aside className={styles.previewColumn}>
            <p className={`${styles.eyebrow} ${styles.previewLabel}`}>What your customer sees</p>
            <div
              className={styles.customerPreview}
              style={{
                "--brand": preview.primaryColor || "#1a1a1a",
                "--accent": preview.accentColor || "#8a7758",
                "--ink": preview.primaryColor || "#1a1a1a",
              }}
            >
              <div className={styles.previewBrand}>
                {preview.logoUrl ? <img src={preview.logoUrl} alt="Brand logo preview" /> : preview.brandName}
              </div>
              <p className={styles.previewKicker}>Care request received</p>
              <h2>Hi Melinda,</h2>
              <p className={styles.previewCopy}>Your piece is safely with us. You can follow every step here.</p>
              <div className={styles.previewStatus}>
                <span>✓</span>
                <div><strong>Request received</strong><small>We have your details and will be in touch shortly.</small></div>
              </div>
              <div className={styles.previewStatus}>
                <span>2</span>
                <div><strong>Assessment</strong><small>We’ll inspect your piece and prepare the next step.</small></div>
              </div>
              <span className={styles.previewButton}>{preview.supportEmail ? "Contact us" : "View your request"}</span>
            </div>
            <p className={styles.previewNote}>This styling is used across customer pages and emails.</p>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
