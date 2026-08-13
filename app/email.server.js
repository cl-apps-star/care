import { stageLabel } from "./care-stages";
import { sendTransactionalEmail } from "./emailProviders.server";

// Same domain / provider as Reveal and In the Making - keep sender
// addresses distinct per app so replies route sensibly.
// Reveal:        certificates@cl-apps.net
// In the Making: updates@cl-apps.net
// Care:          care@cl-apps.net
const REPLY_TO = "hello@cl-apps.net";

function brandBlock(merchant) {
  const name = (merchant?.brandName || "Our studio").trim();
  const accent = merchant?.accentColor || "#8a7758";
  return { name, accent, logoUrl: merchant?.logoUrl || null };
}

// Plain-text counterpart to the HTML email below — some clients (and most
// spam filters) treat HTML-only mail with real suspicion. Mirrors the same
// content in the same order: wordmark, meta line, greeting, body
// paragraphs, link. Kept in one place so the two versions can't drift, same
// pattern as the COA Kit app's buildPlainTextEmail.
// Paragraphs are authored with light inline HTML (just <strong> for
// emphasis, e.g. around a product name) since they're used directly in the
// HTML email body. The plain-text version needs the same words without the
// markup leaking through as literal "<strong>" text.
function stripInlineTags(value) {
  return value.replace(/<\/?[a-z][^>]*>/gi, "");
}

function buildPlainTextEmail({ brandName, metaLine, greeting, paragraphs, ctaLabel, ctaUrl }) {
  const lines = [
    brandName.toUpperCase(),
    metaLine || null,
    "",
    greeting,
    "",
    ...paragraphs.map(stripInlineTags).flatMap((p) => [p, ""]),
  ];

  if (ctaUrl) {
    lines.push(`${ctaLabel || "View update"}:`, ctaUrl);
  }

  return lines
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Same visual language as the Digital Unboxing & COA Kit app's certificate
// email: 440px table, Georgia serif, uppercase letterspaced brand mark in
// the merchant's accent color, italic greeting, quiet body paragraphs, and
// a bordered (not filled) accent-color button with a plain-text link
// fallback underneath. One shared builder so every Care email — case
// received, quote ready, stage update, ready to return — reads as the same
// considered series instead of four different-looking templates.
function renderCareEmail({
  merchant,
  preheader,
  metaLine,
  greeting,
  paragraphs,
  ctaLabel,
  ctaUrl,
}) {
  const brand = brandBlock(merchant);

  const bodyRows = paragraphs
    .map(
      (p, i) => `
              <tr>
                <td style="font-size:15.5px; line-height:1.85; color:#3a3a36; ${i === 0 ? "" : "padding-top:22px;"}">
                  ${p}
                </td>
              </tr>`,
    )
    .join("");

  const html = `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#ffffff;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        ${preheader}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
        <tr>
          <td align="center" style="padding:64px 24px;">
            <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px; font-family:Georgia,'Times New Roman',serif; color:#232320;">

              <tr>
                <td align="center" style="padding-bottom:${metaLine ? "8" : "40"}px;">
                  ${
                    brand.logoUrl
                      ? `<img src="${brand.logoUrl}" alt="${brand.name}" width="320" style="display:block; height:auto; max-height:128px; width:auto; max-width:320px; margin:0 auto 14px auto;" />`
                      : ""
                  }
                  <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; letter-spacing:3.5px; color:${brand.accent};">
                    ${brand.name.toUpperCase()}
                  </div>
                </td>
              </tr>

              ${
                metaLine
                  ? `<tr>
                      <td align="center" style="padding-bottom:32px;">
                        <div style="font-family:Helvetica,Arial,sans-serif; font-size:9.5px; letter-spacing:1.5px; color:#9a9a92;">
                          ${metaLine}
                        </div>
                      </td>
                    </tr>`
                  : ""
              }

              <tr>
                <td style="font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:18px; color:#232320; padding-bottom:18px;">
                  ${greeting}
                </td>
              </tr>

              ${bodyRows}

              ${
                ctaUrl
                  ? `<tr>
                      <td align="center" style="padding:44px 0 4px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" style="border:1px solid ${brand.accent};">
                              <a href="${ctaUrl}" target="_blank" style="display:inline-block; font-family:Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; color:${brand.accent}; text-decoration:none; padding:16px 40px; text-transform:uppercase;">${ctaLabel || "View"}</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding:14px 12px 0 12px;">
                        <a href="${ctaUrl}" target="_blank" style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#9a9a92; word-break:break-all;">${ctaUrl}</a>
                      </td>
                    </tr>`
                  : ""
              }

              <tr>
                <td align="center" style="padding-top:40px;">
                  <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#b3b3ac;">
                    Sent by ${brand.name} via Care.
                  </div>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const text = buildPlainTextEmail({
    brandName: brand.name,
    metaLine,
    greeting,
    paragraphs,
    ctaLabel,
    ctaUrl,
  });

  return { html, text, fromName: brand.name };
}

async function send({ fromName, to, subject, html, text }) {
  if (!to) {
    return { skipped: true, reason: "No customer email on file." };
  }
  return sendTransactionalEmail({
    from: `${fromName} <care@cl-apps.net>`,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
    text,
  });
}

function greetingFor(customerName) {
  const firstName = (customerName || "").trim().split(/\s+/)[0];
  return firstName ? `${firstName},` : "Hello,";
}

export async function sendCaseReceivedEmail({ careCase, merchant, trackingUrl }) {
  const piece = careCase.productTitle || "your piece";
  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `We've received your ${careCase.serviceName} request for ${piece}.`,
    metaLine: careCase.shopifyOrderName ? `ORDER ${careCase.shopifyOrderName}` : null,
    greeting: greetingFor(careCase.customerName),
    paragraphs: [
      `Thanks for reaching out about <strong>${piece}</strong>.`,
      `We've logged your ${careCase.serviceName.toLowerCase()} request and will be in touch with next steps shortly.`,
    ],
    ctaLabel: "Track your request",
    ctaUrl: trackingUrl,
  });
  return send({
    fromName,
    to: careCase.customerEmail,
    subject: `We've received your care request`,
    html,
    text,
  });
}

// Sent when a merchant identifies a customer on the dashboard (picking a
// recently-generated COA kit, or typing in order/email by hand) and wants
// to invite that specific customer to submit a care request themselves —
// same premium branded look as every other Care email, matching COA's and
// In the Making's "here's your personal link" pattern. No CareCase exists
// yet at send time; `portalUrl` points at the public /care/request form,
// pre-filled with this customer's order/email/name/item via query params
// (see care.request.jsx's loader) so they land straight on the "describe
// the issue" step instead of re-typing what the merchant already knows.
export async function sendCareRequestInviteEmail({
  merchant,
  customerName,
  customerEmail,
  orderName,
  productTitle,
  portalUrl,
}) {
  const piece = productTitle || "your piece";
  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `Let us know if ${piece} ever needs a repair, cleaning, or return.`,
    metaLine: orderName ? `ORDER ${orderName}` : null,
    greeting: greetingFor(customerName),
    paragraphs: [
      `If <strong>${piece}</strong> ever needs a repair, cleaning, or return, we're here to help.`,
      `Tap below to tell us what's going on — it only takes a minute, and we'll follow up with a quote and next steps.`,
    ],
    ctaLabel: "Start your request",
    ctaUrl: portalUrl,
  });
  return send({
    fromName,
    to: customerEmail,
    subject: `Need a repair or return on ${piece}?`,
    html,
    text,
  });
}

// Sent to the MERCHANT's own inbox the moment a customer submits a request —
// every other function in this file emails the customer; this is the one
// exception. Without it, the only way to notice a new case came in was to
// have the Care dashboard open. Uses the merchant's Branding → "Support
// email" field, since that's the only merchant-owned email address Care
// stores (see app.branding.jsx / MerchantProfile.supportEmail). Skips
// quietly — not an error — if that field is still blank, same tolerant
// pattern as `send()` skipping a customer email; logs a console warning
// either way so a missing notification is diagnosable in Railway logs
// instead of just silently never arriving.
export async function sendNewCaseAlertEmail({ careCase, merchant, adminUrl }) {
  if (!merchant?.supportEmail) {
    console.warn(
      `[CARE] Skipped new-case alert for shop ${merchant?.shop} — no support email set in Branding.`,
    );
    return { skipped: true, reason: "Merchant has no support email set in Branding." };
  }
  const piece = careCase.productTitle || "an item";
  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `${careCase.customerName || "A customer"} just submitted a ${careCase.serviceName.toLowerCase()} request.`,
    metaLine: careCase.shopifyOrderName ? `ORDER ${careCase.shopifyOrderName}` : null,
    greeting: "Hi,",
    paragraphs: [
      `<strong>${careCase.customerName || "A customer"}</strong> (${careCase.customerEmail}) just submitted a ${careCase.serviceName.toLowerCase()} request for <strong>${piece}</strong>.`,
      careCase.issueDescription
        ? `They described the issue as: &ldquo;${careCase.issueDescription}&rdquo;`
        : `No issue description was given — take a look at the case for details.`,
    ],
    ctaLabel: "View the case",
    ctaUrl: adminUrl,
  });
  const result = await send({
    fromName,
    to: merchant.supportEmail,
    subject: `New care request from ${careCase.customerName || "a customer"}`,
    html,
    text,
  });
  console.log(`[CARE] New-case alert sent to ${merchant.supportEmail} for case ${careCase.id}.`);
  return result;
}

export async function sendQuoteEmail({ careCase, merchant, trackingUrl }) {
  const total =
    careCase.quoteTotal != null
      ? `${careCase.quoteCurrency || "GBP"} ${careCase.quoteTotal.toFixed(2)}`
      : "";
  const piece = careCase.productTitle || "your piece";
  const paragraphs = [
    `We've assessed <strong>${piece}</strong> and prepared a quote${total ? `: <strong>${total}</strong>` : ""}.`,
  ];
  if (careCase.quoteNote) paragraphs.push(careCase.quoteNote);
  paragraphs.push("Review and approve below.");

  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `Your quote for ${piece} is ready.`,
    metaLine: careCase.shopifyOrderName ? `ORDER ${careCase.shopifyOrderName}` : null,
    greeting: greetingFor(careCase.customerName),
    paragraphs,
    ctaLabel: "Review your quote",
    ctaUrl: trackingUrl,
  });
  return send({
    fromName,
    to: careCase.customerEmail,
    subject: `Your quote is ready`,
    html,
    text,
  });
}

export async function sendStageUpdateEmail({ careCase, merchant, trackingUrl, note }) {
  const label = stageLabel(careCase.status);
  const piece = careCase.productTitle || "your piece";
  const paragraphs = [
    `Your ${careCase.serviceName.toLowerCase()} for <strong>${piece}</strong> has moved to: <strong>${label}</strong>.`,
  ];
  if (note) paragraphs.push(note);

  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `An update on ${piece} — ${label}.`,
    metaLine: careCase.shopifyOrderName ? `ORDER ${careCase.shopifyOrderName}` : null,
    greeting: greetingFor(careCase.customerName),
    paragraphs,
    ctaLabel: "View progress",
    ctaUrl: trackingUrl,
  });
  return send({
    fromName,
    to: careCase.customerEmail,
    subject: `Update on your care request: ${label}`,
    html,
    text,
  });
}

export async function sendReadyToReturnEmail({ careCase, merchant, trackingUrl }) {
  const piece = careCase.productTitle || "Your piece";
  const { html, text, fromName } = renderCareEmail({
    merchant,
    preheader: `${piece} is ready to return to you.`,
    metaLine: careCase.shopifyOrderName ? `ORDER ${careCase.shopifyOrderName}` : null,
    greeting: greetingFor(careCase.customerName),
    paragraphs: [
      `<strong>${piece}</strong> has completed ${careCase.serviceName.toLowerCase()} and is ready to return to you.`,
    ],
    ctaLabel: "View details",
    ctaUrl: trackingUrl,
  });
  return send({
    fromName,
    to: careCase.customerEmail,
    subject: `Your piece is ready`,
    html,
    text,
  });
}
