import customerCareStyles from "../styles/customer-care.css?url";
export const links = () => [{ rel: "stylesheet", href: customerCareStyles }];
import { useFetcher, useLoaderData } from "react-router";
import prisma from "../db.server";
import { getCaseByToken, approveQuote, declineQuote } from "../care.server";
import { stageLabel } from "../care-stages";
import { sendStageUpdateEmail, sendQuoteApprovedAlertEmail } from "../email.server";
import { publicOrigin } from "../publicOrigin.server";
import { quoteFingerprint } from "../quoteFingerprint.server";
import { displayCareDate } from "../displayDate";

// Public, unauthenticated route — the token is the access control,
// same pattern as In the Making's /journey/:token.
export const loader = async ({ params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  // Public bearer links expose only customer-facing fields, including in loader JSON.
  const fields = ["id", "token", "productTitle", "productImageUrl", "serviceName", "shopifyOrderName", "status", "issueDescription", "quoteCurrency", "quoteLabourCost", "quotePartsCost", "quoteShippingCost", "quoteTax", "quoteTaxPercent", "quoteTotal", "quoteNote"];
  const publicCase = Object.fromEntries(fields.map(key => [key, careCase[key]]));
  publicCase.updates = careCase.updates.map(({ id, status, note, media, createdAt, visibleToCustomer }) => ({ id, status, note, media, createdAt, visibleToCustomer }));
  const brandFields = ["brandName", "primaryColor", "accentColor", "logoUrl", "supportEmail"];
  publicCase.merchant = Object.fromEntries(brandFields.map(key => [key, careCase.merchant[key]]));
  publicCase.quoteFingerprint = quoteFingerprint(careCase);
  return { careCase: publicCase };
};

export const action = async ({ request, params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  const intent = formData.get("intent");
  const appUrl = publicOrigin(request.url);
  const trackingUrl = `${appUrl}/care/${careCase.token}`;

  if (intent === "approve_quote" && careCase.status === "quote_sent") {
    const expected = String(formData.get("quoteFingerprint") || "");
    if (!expected || expected !== quoteFingerprint(careCase)) return { ok: false, error: "This quote has changed. Reload and review it before approving." };
    let outcome;
    try { outcome = await approveQuote(careCase.id, expected); }
    catch { return { ok: false, error: "This quote has changed. Reload and review it before approving." }; }
    const { case: updated, update } = outcome;
    const merchant = await prisma.merchantProfile.findUnique({ where: { id: updated.merchantId } });

    await sendStageUpdateEmail({
      careCase: updated,
      updateId: update?.id,
      merchant,
      trackingUrl,
      note: "Thanks — we'll get started.",
    });

    // Let the merchant know too — approving a quote is the signal to
    // actually start the work, and without this the only way to notice was
    // to have the Care dashboard open (same gap sendNewCaseAlertEmail
    // closes for new requests). A failure here shouldn't block the
    // approval the customer just completed.
    const adminUrl = `https://${merchant.shop}/admin/apps/${process.env.SHOPIFY_API_KEY || ""}/app/cases/${updated.id}`;
    try {
      await sendQuoteApprovedAlertEmail({ careCase: updated, merchant, adminUrl });
    } catch (err) {
      console.error(`[CARE] Failed to send quote-approved alert for case ${updated.id}:`, err);
    }

    return { ok: true };
  }

  if (intent === "decline_quote" && careCase.status === "quote_sent") {
    await declineQuote(careCase.id);
    return { ok: true };
  }

  return { ok: false };
};

// Line-item breakdown of the quote — only shows costs the merchant actually
// entered in the Quote builder; anything left blank (or 0) is skipped
// entirely rather than showing as a zero line, per the merchant's request.
// Shows the customer the same itemized costs the merchant entered in the
// quote builder before they approve or decline the work.
function QuoteBreakdown({ careCase }) {
  const currency = careCase.quoteCurrency || "GBP";
  const rows = [
    { label: "Labour", value: careCase.quoteLabourCost },
    { label: "Materials", value: careCase.quotePartsCost },
    { label: "Shipping", value: careCase.quoteShippingCost },
    {
      label: careCase.quoteTaxPercent ? `Tax (${careCase.quoteTaxPercent}%)` : "Tax",
      value: careCase.quoteTax,
    },
  ].filter((r) => Number(r.value || 0) > 0);

  // Nothing to break down (e.g. the merchant only ever set a flat total) —
  // skip the section rather than show an empty box.
  if (rows.length === 0) return null;

  return (
    <div className="care-quote-breakdown">
      {rows.map((r) => (
        <div className="care-quote-row" key={r.label}>
          <span>{r.label}</span>
          <span>{currency} {Number(r.value).toFixed(2)}</span>
        </div>
      ))}
      {careCase.quoteTotal != null && (
        <div className="care-quote-row total">
          <span>Total</span>
          <span>{currency} {careCase.quoteTotal.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

export default function CareTrackingPage() {
  const { careCase } = useLoaderData();
  const fetcher = useFetcher();
  const brand = careCase.merchant;
  const accent = brand?.accentColor || "#8a7758";
  const visibleUpdates = careCase.updates.filter((u) => u.visibleToCustomer);

  return (
    <div style={{ "--accent": accent }}>

      <div className="care-wrap">
        <div className="care-eyebrow">{brand?.brandName || "CL Apps"}</div>

        <div className="care-hero">
          {careCase.productImageUrl && <img src={careCase.productImageUrl} alt={careCase.productTitle || ""} />}
          <h1>{careCase.productTitle || "Your piece"}</h1>
          <p>{careCase.shopifyOrderName || careCase.serviceName}</p>
        </div>

        <div className="care-section-title">Care &amp; Repairs</div>
        <div className="care-section-status">
          <span className="care-dot" />
          {stageLabel(careCase.status)}
        </div>

        <div className="care-info">
          <div className="care-info-icon">✦</div>
          <div className="care-info-text">
            <strong>{careCase.serviceName}</strong>
            {careCase.issueDescription ? <><br />{careCase.issueDescription}</> : null}
          </div>
        </div>

        {careCase.status === "quote_sent" && (
          <div className="care-quote">
            <h3>
              {careCase.quoteTotal != null
                ? <>Your quote: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}</>
                : "Your quote is ready to review"}
            </h3>
            {careCase.quoteNote && <p>{careCase.quoteNote}</p>}
            <QuoteBreakdown careCase={careCase} />
            {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
            <div className="care-btn-row">
              <button
                className="care-btn"
                disabled={fetcher.state !== "idle"}
                onClick={() => fetcher.submit({ intent: "approve_quote", quoteFingerprint: careCase.quoteFingerprint }, { method: "POST" })}
              >
                Approve quote
              </button>
              <button
                className="care-btn secondary"
                disabled={fetcher.state !== "idle"}
                onClick={() => fetcher.submit({ intent: "decline_quote" }, { method: "POST" })}
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {careCase.status === "declined" && (
          <div className="care-declined">
            This request was declined. Reach out to us any time if you'd like to revisit it.
          </div>
        )}

        {visibleUpdates.length > 0 && (
          <div>
            <div className="care-updates-title">Updates</div>
            {visibleUpdates
              .slice()
              .reverse()
              .map((u) => (
                <div key={u.id} className="care-update">
                  {u.status && <div className="care-update-status">{stageLabel(u.status)}</div>}
                  {u.note && <div>{u.note}</div>}
                  <div className="care-update-meta">{displayCareDate(u.createdAt)}</div>
                </div>
              ))}
          </div>
        )}

        <div className="care-foot">
          Powered by <span className="care-brand">{brand?.brandName || "CL Apps"}</span>
        </div>
      </div>
    </div>
  );
}
