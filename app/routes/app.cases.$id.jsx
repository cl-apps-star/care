import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
    getOrCreateMerchantProfile,
    getCaseById,
    setQuote,
    sendQuote,
    advanceCase,
    addInternalNote,
} from "../care.server";
import { STAGES, stageLabel, statusTone, nextStage, needsMerchantAction } from "../care-stages";
import { sendQuoteEmail, sendStageUpdateEmail, sendReadyToReturnEmail } from "../email.server";

// Same tinted-card pattern used on the dashboard (app._index.jsx's
// SECTION_TINTS/TintedSection) — duplicated here rather than shared from a
// common module to keep this route's edit self-contained. Overview gets the
// same "link" slate blue used for the dashboard's info sections; Quote
// builder gets terracotta (an action the merchant needs to take); Advance
// stage gets sage (progress/forward motion) — so this page reads as the
// same considered system as the rest of the app instead of a wall of plain
// text sections.
const SECTION_TINTS = {
  overview: { background: "#F2F7F9", border: "#5b7a8a" }, // slate blue
  quote: { background: "#FBF3EF", border: "#9a6b56" }, // terracotta
  advance: { background: "#F3F7F4", border: "#6b8a72" }, // sage
};

function TintedSection({ tint, children }) {
  const style = SECTION_TINTS[tint] || SECTION_TINTS.overview;
  return (
    <div
      style={{
        background: style.background,
        border: `1px solid ${style.border}33`,
        borderLeft: `5px solid ${style.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <s-stack direction="block" gap="base">
        {children}
      </s-stack>
    </div>
  );
}

function OverviewRow({ label, children }) {
  return (
    <s-stack direction="inline" gap="tight" alignItems="baseline">
      <s-text weight="bold">{label}:</s-text>
      <s-text>{children}</s-text>
    </s-stack>
  );
}

// Status used to be a small plain-text line buried in the Overview card —
// easy to miss, and even once you saw it, "Approved" alone doesn't say
// whether that means "waiting on the customer" or "you need to do
// something now". This gives a one-line plain-English answer to "what's
// actually going on, and is there anything I need to do right now" — shown
// in a prominent banner at the very top of the page, above every section,
// so the merchant doesn't have to read the whole page to find out.
function statusGuidance(careCase) {
  switch (careCase.status) {
    case "request_received":
      return "New request — take a look and move it to Awaiting item or Assessment when you're ready.";
    case "awaiting_item":
      return "Waiting on the customer to send the item back to you.";
    case "item_received":
      return "Item has arrived — assess it and build a quote when you're ready.";
    case "assessment":
      return "You're assessing the item. Build and send a quote below when it's ready.";
    case "quote_sent":
      return "Waiting on the customer to approve or decline the quote you sent.";
    case "approved":
      return careCase.paymentStatus === "paid"
        ? "Customer approved and paid — get started on the work."
        : "Customer approved the quote. Payment is still outstanding, but you can start the work whenever suits.";
    case "in_service":
      return "Work is in progress.";
    case "quality_check":
      return "In quality check before it goes back to the customer.";
    case "ready_to_return":
      return "Ready to send back — advance to Completed once it's on its way.";
    case "completed":
      return "This case is done.";
    case "declined":
      return "Customer declined the quote. Nothing further needed unless they reach back out.";
    default:
      return null;
  }
}

export const loader = async ({ request, params }) => {
    const { session } = await authenticate.admin(request);
    const merchant = await getOrCreateMerchantProfile(session.shop);
    const careCase = await getCaseById(params.id, merchant.id);
    if (!careCase) throw new Response("Not found", { status: 404 });
    return { merchant, careCase };
};

export const action = async ({ request, params }) => {
    const { session } = await authenticate.admin(request);
    const merchant = await getOrCreateMerchantProfile(session.shop);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const appUrl = process.env.SHOPIFY_APP_URL || "";

    const careCase = await getCaseById(params.id, merchant.id);
    if (!careCase) throw new Response("Not found", { status: 404 });
    const trackingUrl = `${appUrl}/care/${careCase.token}`;

    // Every branch echoes back its own `intent` alongside `ok` — the page
    // shares one fetcher across three separate forms (quote, advance,
    // internal note), so the UI needs to know WHICH action just finished
    // to show the right success banner in the right section, not just
    // that "something" succeeded.
    if (intent === "set_and_send_quote") {
          await setQuote(careCase.id, {
                  labourCost: formData.get("labourCost") || 0,
                  partsCost: formData.get("partsCost") || 0,
                  shippingCost: formData.get("shippingCost") || 0,
                  taxPercent: formData.get("taxPercent") || 0,
                  note: formData.get("note") || undefined,
          });
          const { case: updated } = await sendQuote(careCase.id);
          await sendQuoteEmail({ careCase: updated, merchant, trackingUrl });
          return { ok: true, intent: "set_and_send_quote" };
    }

    if (intent === "advance") {
          const note = formData.get("note") || undefined;
          const notify = formData.get("notify") === "on";
          const { case: updated } = await advanceCase(careCase.id, { note, notifyCustomer: notify });
          if (notify) {
                  if (updated.status === "ready_to_return") {
                            await sendReadyToReturnEmail({ careCase: updated, merchant, trackingUrl });
                  } else {
                            await sendStageUpdateEmail({ careCase: updated, merchant, trackingUrl, note });
                  }
          }
          return { ok: true, intent: "advance", newStatus: updated.status };
    }

    if (intent === "internal_note") {
          await addInternalNote(careCase.id, formData.get("note"));
          return { ok: true, intent: "internal_note" };
    }

    return { ok: false };
};

// Customer-uploaded photos are stored as a JSON-stringified array of data
// URLs on careCase.photos (see createCareCase in care.server.js and the
// photo-upload handling in care-request.server.js's submit_request action)
// — but this page never actually rendered them, so a photo the customer
// attached to their request just silently never showed up anywhere the
// merchant could see it. Parsing defensively since a malformed/legacy
// value here shouldn't take down the whole page.
function parsePhotos(photosJson) {
  if (!photosJson) return [];
  try {
    const parsed = JSON.parse(photosJson);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export default function CaseDetail() {
    const { careCase } = useLoaderData();
    const fetcher = useFetcher();
    const photos = parsePhotos(careCase.photos);

  // One fetcher, three forms — pendingIntent/resultIntent tell each form
  // whether IT is the one currently submitting or the one that just
  // finished, so "Send quote" doesn't show a spinner while "Add note" is
  // actually the thing in flight, and the success banner lands under the
  // right section instead of floating ambiguously at the top of the page.
  const pendingIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const resultIntent = fetcher.state === "idle" && fetcher.data?.ok ? fetcher.data?.intent : null;

  const nextStageEntry = nextStage(careCase.status);
  const needsAction = needsMerchantAction(careCase);
  const quoteAlreadySent = careCase.quoteSentAt != null;

  return (
        <s-page heading={`${careCase.productTitle || "Case"} - ${careCase.serviceName}`} backAction={{ url: "/app/cases" }}>
                {/* One glance, top of page, answers "what's going on and is
                    there anything I need to do" — the tone (color) and the
                    "Needs you" flag do the same job as scanning the whole
                    page used to. Everything below this is detail/action,
                    not the first thing the merchant has to parse. */}
                <s-banner tone={statusTone(careCase.status)}>
                  <s-stack direction="inline" gap="tight" alignItems="center">
                    <s-badge tone={statusTone(careCase.status)}>{stageLabel(careCase.status)}</s-badge>
                    {needsAction && <s-badge tone="critical">Needs you</s-badge>}
                  </s-stack>
                  <s-paragraph>{statusGuidance(careCase)}</s-paragraph>
                </s-banner>

                <s-section heading="Overview">
                        <TintedSection tint="overview">
                          <OverviewRow label="Customer">{careCase.customerName} ({careCase.customerEmail})</OverviewRow>
                          {careCase.shopifyOrderName && (
                            <OverviewRow label="Order">{careCase.shopifyOrderName}</OverviewRow>
                          )}
                          {careCase.issueDescription && (
                            <OverviewRow label="Issue">{careCase.issueDescription}</OverviewRow>
                          )}
                          {photos.length > 0 && (
                            <s-stack direction="block" gap="tight">
                              <s-text weight="bold">Photo{photos.length > 1 ? "s" : ""}:</s-text>
                              <s-stack direction="inline" gap="tight">
                                {photos.map((src, i) => (
                                  <a key={i} href={src} target="_blank" rel="noreferrer">
                                    <img
                                      src={src}
                                      alt={`Customer photo ${i + 1}`}
                                      style={{
                                        width: 96,
                                        height: 96,
                                        objectFit: "cover",
                                        borderRadius: 6,
                                        border: "1px solid #5b7a8a55",
                                      }}
                                    />
                                  </a>
                                ))}
                              </s-stack>
                            </s-stack>
                          )}
                        </TintedSection>
                </s-section>

              <s-section heading={quoteAlreadySent ? "Quote builder — sent" : "Quote builder"}>
                <TintedSection tint="quote">
                      {resultIntent === "set_and_send_quote" && (
                        <s-banner tone="success">
                          <s-paragraph>Quote sent to the customer.</s-paragraph>
                        </s-banner>
                      )}
                      {quoteAlreadySent && !resultIntent && (
                        <s-paragraph tone="subdued">
                          Already sent to the customer — change any field and send again to update it (this re-sends the quote email).
                        </s-paragraph>
                      )}
                      <form
                                  onSubmit={(e) => {
                                                e.preventDefault();
                                                const fd = new FormData(e.currentTarget);
                                                fd.set("intent", "set_and_send_quote");
                                                fetcher.submit(fd, { method: "POST" });
                                  }}
                                >
                                <s-stack direction="block" gap="base">
                                            <s-text-field name="labourCost" label="Labour cost" type="number" step="0.01" defaultValue={careCase.quoteLabourCost ?? ""} />
                                            <s-text-field name="partsCost" label="Parts cost" type="number" step="0.01" defaultValue={careCase.quotePartsCost ?? ""} />
                                            <s-text-field name="shippingCost" label="Return shipping" type="number" step="0.01" defaultValue={careCase.quoteShippingCost ?? ""} />
                                            <s-text-field name="taxPercent" label="Tax (%)" type="number" step="0.01" defaultValue={careCase.quoteTaxPercent ?? ""} />
                                            <s-text-area name="note" label="Note to customer" rows={4} defaultValue={careCase.quoteNote ?? ""} />
                                            <s-button type="submit" loading={pendingIntent === "set_and_send_quote" || undefined}>
                                              {pendingIntent === "set_and_send_quote"
                                                ? "Sending…"
                                                : quoteAlreadySent
                                                ? "Update & resend quote"
                                                : "Send quote"}
                                            </s-button>

                                </s-stack>
                      </form>
                {careCase.quoteTotal != null && (
                    <s-paragraph>
                                Current quote total: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}
                                {careCase.quoteTaxPercent ? ` (includes ${careCase.quoteCurrency} ${careCase.quoteTax.toFixed(2)} tax at ${careCase.quoteTaxPercent}%)` : ""}
                    </s-paragraph>
                  )}
                </TintedSection>
              </s-section>

              <s-section heading={nextStageEntry ? `Next step: ${nextStageEntry.label}` : "Advance stage"}>
                <TintedSection tint="advance">
                      {resultIntent === "advance" && (
                        <s-banner tone="success">
                          <s-paragraph>
                            Moved to {stageLabel(fetcher.data?.newStatus)}
                            {fetcher.data?.newStatus ? "." : " the next stage."}
                          </s-paragraph>
                        </s-banner>
                      )}
                      {!nextStageEntry && (
                        <s-paragraph tone="subdued">This case is at its final stage.</s-paragraph>
                      )}
                      <form
                                  onSubmit={(e) => {
                                                e.preventDefault();
                                                const fd = new FormData(e.currentTarget);
                                                fd.set("intent", "advance");
                                                fetcher.submit(fd, { method: "POST" });
                                                e.currentTarget.reset();
                                  }}
                                >
                                <s-stack direction="block" gap="base">
                                            {nextStageEntry && (
                                              <s-text-field name="note" label="Update note (optional)" />
                                            )}
                                            {nextStageEntry && (
                                              <s-checkbox name="notify" label="Notify customer" defaultChecked />
                                            )}
                                            {nextStageEntry && (
                                              <s-button type="submit" loading={pendingIntent === "advance" || undefined}>
                                                {pendingIntent === "advance" ? "Advancing…" : `Advance to "${nextStageEntry.label}"`}
                                              </s-button>
                                            )}

                                </s-stack>
                      </form>
                      <s-paragraph tone="subdued">All stages: {STAGES.map((s) => s.label).join(" → ")}</s-paragraph>
                </TintedSection>
              </s-section>
        
              <s-section heading="Timeline">
                      <s-stack direction="block" gap="tight">
                        {careCase.updates.map((u) => (
                      <s-box key={u.id} padding="tight">
                                    <s-text weight={u.status ? "bold" : "regular"}>
                                      {u.status ? stageLabel(u.status) : "Note"} - {new Date(u.createdAt).toLocaleString()}
                                      {!u.visibleToCustomer ? " (internal)" : ""}
                                    </s-text>
                        {u.note && <s-text tone="subdued">{u.note}</s-text>
                        }
                      </s-box>
                    ))}
                      </s-stack>
              </s-section>
        
              <s-section slot="aside" heading="Internal note">
                      {resultIntent === "internal_note" && (
                        <s-banner tone="success">
                          <s-paragraph>Note added.</s-paragraph>
                        </s-banner>
                      )}
                      <form
                                  onSubmit={(e) => {
                                                e.preventDefault();
                                                const fd = new FormData(e.currentTarget);
                                                fd.set("intent", "internal_note");
                                                fetcher.submit(fd, { method: "POST" });
                                                e.currentTarget.reset();
                                  }}
                                >
                                <s-stack direction="block" gap="base">
                                            <s-text-field name="note" label="Note (not shown to customer)" />
                                            <s-button type="submit" variant="tertiary" loading={pendingIntent === "internal_note" || undefined}>
                                              {pendingIntent === "internal_note" ? "Adding…" : "Add note"}
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
