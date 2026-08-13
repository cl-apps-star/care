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
import { STAGES, stageLabel } from "../care-stages";
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
                  tax: formData.get("tax") || 0,
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

export default function CaseDetail() {
    const { careCase } = useLoaderData();
    const fetcher = useFetcher();

  // One fetcher, three forms — pendingIntent/resultIntent tell each form
  // whether IT is the one currently submitting or the one that just
  // finished, so "Send quote" doesn't show a spinner while "Add note" is
  // actually the thing in flight, and the success banner lands under the
  // right section instead of floating ambiguously at the top of the page.
  const pendingIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const resultIntent = fetcher.state === "idle" && fetcher.data?.ok ? fetcher.data?.intent : null;

  return (
        <s-page heading={`${careCase.productTitle || "Case"} - ${careCase.serviceName}`} backAction={{ url: "/app/cases" }}>
                <s-section heading="Overview">
                        <TintedSection tint="overview">
                          <OverviewRow label="Customer">{careCase.customerName} ({careCase.customerEmail})</OverviewRow>
                          {careCase.shopifyOrderName && (
                            <OverviewRow label="Order">{careCase.shopifyOrderName}</OverviewRow>
                          )}
                          <OverviewRow label="Status">{stageLabel(careCase.status)}</OverviewRow>
                          {careCase.issueDescription && (
                            <OverviewRow label="Issue">{careCase.issueDescription}</OverviewRow>
                          )}
                        </TintedSection>
                </s-section>

              <s-section heading="Quote builder">
                <TintedSection tint="quote">
                      {resultIntent === "set_and_send_quote" && (
                        <s-banner tone="success">
                          <s-paragraph>Quote sent to the customer.</s-paragraph>
                        </s-banner>
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
                                            <s-text-field name="tax" label="Tax" type="number" step="0.01" defaultValue={careCase.quoteTax ?? ""} />
                                            <s-text-area name="note" label="Note to customer" rows={4} defaultValue={careCase.quoteNote ?? ""} />
                                            <s-button type="submit" loading={pendingIntent === "set_and_send_quote" || undefined}>
                                              {pendingIntent === "set_and_send_quote" ? "Sending…" : "Send quote"}
                                            </s-button>

                                </s-stack>
                      </form>
                {careCase.quoteTotal != null && (
                    <s-paragraph>
                                Current quote total: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}
                    </s-paragraph>
                  )}
                </TintedSection>
              </s-section>

              <s-section heading="Advance stage">
                <TintedSection tint="advance">
                      {resultIntent === "advance" && (
                        <s-banner tone="success">
                          <s-paragraph>
                            Moved to {stageLabel(fetcher.data?.newStatus)}
                            {fetcher.data?.newStatus ? "." : " the next stage."}
                          </s-paragraph>
                        </s-banner>
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
                                            <s-text-field name="note" label="Update note (optional)" />
                                            <s-checkbox name="notify" label="Notify customer" defaultChecked />
                                            <s-button type="submit" loading={pendingIntent === "advance" || undefined}>
                                                          {pendingIntent === "advance" ? "Advancing…" : "Advance to next stage"}
                                            </s-button>

                                </s-stack>
                      </form>
                      <s-paragraph tone="subdued">Stages: {STAGES.map((s) => s.label).join(" -> ")}</s-paragraph>
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
