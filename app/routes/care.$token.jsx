import { useFetcher, useLoaderData } from "react-router";
import prisma from "../db.server";
import { getCaseByToken, approveQuote, declineQuote } from "../care.server";
import { stageLabel } from "../care-stages";
import { sendStageUpdateEmail } from "../email.server";

// Public, unauthenticated route — the token is the access control,
// same pattern as In the Making's /journey/:token.
export const loader = async ({ params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  return { careCase };
};

export const action = async ({ request, params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  const intent = formData.get("intent");
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const trackingUrl = `${appUrl}/care/${careCase.token}`;

  if (intent === "approve_quote" && careCase.status === "quote_sent") {
    const { case: updated } = await approveQuote(careCase.id);
    const merchant = await prisma.merchantProfile.findUnique({ where: { id: updated.merchantId } });
    await sendStageUpdateEmail({ careCase: updated, merchant, trackingUrl, note: "Thanks — we'll get started." });
    return { ok: true };
  }

  if (intent === "decline_quote" && careCase.status === "quote_sent") {
    await declineQuote(careCase.id);
    return { ok: true };
  }

  return { ok: false };
};

export default function CareTrackingPage() {
  const { careCase } = useLoaderData();
  const fetcher = useFetcher();
  const brand = careCase.merchant;
  const accent = brand?.accentColor || "#8a7758";
  const visibleUpdates = careCase.updates.filter((u) => u.visibleToCustomer);

  return (
    <div style={{ "--accent": accent }}>
      <style>{`
        .care-wrap {
          font-family: Georgia, 'Times New Roman', serif;
          max-width: 480px;
          margin: 0 auto;
          padding: 64px 24px 64px;
          color: #232320;
          background: #fffdfa;
        }
        .care-eyebrow {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          text-align: center;
          margin-bottom: 22px;
        }
        .care-hero { text-align: center; margin-bottom: 34px; }
        .care-hero img {
          width: 132px; height: 132px; object-fit: cover;
          border-radius: 2px; margin-bottom: 22px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }
        .care-hero h1 { font-weight: normal; font-size: 26px; margin: 0 0 6px; letter-spacing: 0.01em; }
        .care-hero p {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          color: #7d7a72; font-size: 13px; margin: 0;
        }
        .care-section-title { font-size: 20px; text-align: center; margin-bottom: 6px; }
        .care-section-status {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12.5px; color: #7d7a72;
          text-align: center; margin-bottom: 30px;
          display: flex; align-items: center; justify-content: center; gap: 7px;
        }
        .care-dot { width: 6px; height: 6px; border-radius: 50%; background: #9c9384; flex-shrink: 0; }
        .care-info {
          display: flex; align-items: center; gap: 14px;
          background: #faf8f4; border: 1px solid #e4e0d8;
          padding: 14px 16px; margin-bottom: 32px;
        }
        .care-info-icon {
          width: 34px; height: 34px; border: 1px solid var(--accent);
          display: flex; align-items: center; justify-content: center;
          font-size: 15px; color: var(--accent); flex-shrink: 0;
        }
        .care-info-text {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12.5px; color: #7d7a72; line-height: 1.5;
        }
        .care-info-text strong { color: #232320; font-weight: 600; }
        .care-quote {
          font-size: 14px; line-height: 1.7; color: #232320;
          background: #faf8f4; border: 1px solid #e4e0d8;
          padding: 22px 20px; margin-bottom: 32px;
        }
        .care-quote h3 { font-weight: normal; margin: 0 0 8px; font-size: 19px; }
        .care-quote p { margin: 0 0 4px; color: #565349; }
        .care-btn-row { display: flex; gap: 12px; margin-top: 18px; }
        .care-btn {
          flex: 1; box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 13px 18px; border: 1px solid var(--accent);
          color: #fff; background: var(--accent); text-align: center;
          cursor: pointer;
        }
        .care-btn.secondary {
          background: transparent; color: #7d7a72; border-color: #d9d4c9;
        }
        .care-btn:disabled { opacity: 0.6; cursor: default; }
        .care-declined {
          font-size: 14px; line-height: 1.7; color: #565349;
          background: #faf8f4; border: 1px solid #e4e0d8;
          padding: 20px; margin-bottom: 32px;
        }
        .care-updates-title {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
          color: #a39d90; margin-bottom: 16px;
        }
        .care-update {
          font-size: 14px; line-height: 1.65; color: #232320;
          background: #faf8f4; border-left: 2px solid var(--accent);
          padding: 12px 14px; margin-bottom: 12px;
        }
        .care-update-status { font-weight: bold; margin-bottom: 2px; }
        .care-update-meta {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px; color: #7d7a72; margin-top: 8px;
        }
        .care-foot {
          text-align: center; margin-top: 48px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px; color: #7d7a72; letter-spacing: 0.03em;
        }
        .care-foot .care-brand { color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; }
      `}</style>

      <div className="care-wrap">
        <div className="care-eyebrow">{brand?.brandName || "Care"}</div>

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

        {careCase.status === "quote_sent" && careCase.quoteTotal != null && (
          <div className="care-quote">
            <h3>
              Your quote: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}
            </h3>
            {careCase.quoteNote && <p>{careCase.quoteNote}</p>}
            <div className="care-btn-row">
              <button
                className="care-btn"
                disabled={fetcher.state !== "idle"}
                onClick={() => fetcher.submit({ intent: "approve_quote" }, { method: "POST" })}
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
                  <div className="care-update-meta">{new Date(u.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
                </div>
              ))}
          </div>
        )}

        <div className="care-foot">
          Powered by <span className="care-brand">{brand?.brandName || "Care"}</span>
        </div>
      </div>
    </div>
  );
}
