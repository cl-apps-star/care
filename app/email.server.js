import { Resend } from "resend";
import { stageLabel } from "./care-stages";

// Same domain / provider as Reveal and In the Making - keep sender
// addresses distinct per app so replies route sensibly.
// Reveal:        certificates@cl-apps.net
// In the Making: updates@cl-apps.net
// Care:          care@cl-apps.net
const FROM_ADDRESS = "Care <care@cl-apps.net>";

function getResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
          console.warn("[email.server] RESEND_API_KEY not set - skipping send");
          return null;
    }
    return new Resend(apiKey);
}

function brandBlock(merchant) {
    const name = merchant?.brandName || "Our studio";
    const accent = merchant?.accentColor || "#8a7758";
    return { name, accent, logoUrl: merchant?.logoUrl || null };
}

function baseTemplate({ merchant, title, bodyHtml, ctaLabel, ctaUrl }) {
    const brand = brandBlock(merchant);
    return `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color:#1a1a1a;">
          ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${brand.name}" style="max-height:48px;margin-bottom:24px;" />` : `<div style="font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${brand.accent};margin-bottom:24px;">${brand.name}</div>`}
              <h1 style="font-size:20px;font-weight:normal;margin-bottom:16px;">${title}</h1>
                  <div style="font-size:15px;line-height:1.6;color:#333;">${bodyHtml}</div>
                      ${ctaUrl ? `<div style="margin-top:28px;"><a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:${brand.accent};color:#fff;text-decoration:none;font-size:14px;">${ctaLabel || "View update"}</a></div>` : ""}
                          <div style="margin-top:40px;font-size:12px;color:#999;">Sent by ${brand.name} via Care.</div>
                            </div>`;
}

async function send({ to, subject, html }) {
    const resend = getResend();
    if (!resend) return { skipped: true };
    return resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
}

export async function sendCaseReceivedEmail({ careCase, merchant, trackingUrl }) {
    const html = baseTemplate({
          merchant,
          title: `We've received your ${careCase.serviceName} request`,
          bodyHtml: `<p>Hi ${careCase.customerName},</p><p>Thanks for reaching out about <strong>${careCase.productTitle || "your piece"}</strong>. We've logged your request and will be in touch with next steps shortly.</p>`,
          ctaLabel: "Track your request",
          ctaUrl: trackingUrl,
    });
    return send({ to: careCase.customerEmail, subject: `We've received your care request`, html });
}

export async function sendQuoteEmail({ careCase, merchant, trackingUrl }) {
    const total = careCase.quoteTotal != null ? `${careCase.quoteCurrency || "GBP"} ${careCase.quoteTotal.toFixed(2)}` : "";
    const html = baseTemplate({
          merchant,
          title: `Your quote is ready`,
          bodyHtml: `<p>Hi ${careCase.customerName},</p><p>We've assessed <strong>${careCase.productTitle || "your piece"}</strong> and prepared a quote${total ? `: <strong>${total}</strong>` : ""}.</p>${careCase.quoteNote ? `<p>${careCase.quoteNote}</p>` : ""}<p>Review and approve below.</p>`,
          ctaLabel: "Review your quote",
          ctaUrl: trackingUrl,
    });
    return send({ to: careCase.customerEmail, subject: `Your quote is ready`, html });
}

export async function sendStageUpdateEmail({ careCase, merchant, trackingUrl, note }) {
    const label = stageLabel(careCase.status);
    const html = baseTemplate({
          merchant,
          title: `Update: ${label}`,
          bodyHtml: `<p>Hi ${careCase.customerName},</p><p>Your ${careCase.serviceName.toLowerCase()} for <strong>${careCase.productTitle || "your piece"}</strong> has moved to: <strong>${label}</strong>.</p>${note ? `<p>${note}</p>` : ""}`,
          ctaLabel: "View progress",
          ctaUrl: trackingUrl,
    });
    return send({ to: careCase.customerEmail, subject: `Update on your care request: ${label}`, html });
}

export async function sendReadyToReturnEmail({ careCase, merchant, trackingUrl }) {
    const html = baseTemplate({
          merchant,
          title: `Your piece is ready`,
          bodyHtml: `<p>Hi ${careCase.customerName},</p><p><strong>${careCase.productTitle || "Your piece"}</strong> has completed ${careCase.serviceName.toLowerCase()} and is ready to return to you.</p>`,
          ctaLabel: "View details",
          ctaUrl: trackingUrl,
    });
    return send({ to: careCase.customerEmail, subject: `Your piece is ready`, html });
}
