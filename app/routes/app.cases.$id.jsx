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
          return { ok: true };
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
          return { ok: true };
    }

    if (intent === "internal_note") {
          await addInternalNote(careCase.id, formData.get("note"));
          return { ok: true };
    }

    return { ok: false };
};

export default function CaseDetail() {
    const { careCase } = useLoaderData();
    const fetcher = useFetcher();

  return (
        <s-page heading={`${careCase.productTitle || "Case"} - ${careCase.serviceName}`} backAction={{ url: "/app" }}>
                <s-section heading="Overview">
                        <s-stack direction="block" gap="tight">
                                  <s-text>Customer: {careCase.customerName} ({careCase.customerEmail})</s-text>
                          {careCase.shopifyOrderName && <s-text>Order: {careCase.shopifyOrderName}</s-text>
                          }
                                  <s-text>Status: {stageLabel(careCase.status)}</s-text>
                        
                          {careCase.issueDescription && <s-text>Issue: {careCase.issueDescription}</s-text>
                          }
                        </s-stack>
                </s-section>
        
              <s-section heading="Quote builder">
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
                                            <s-text-field name="note" label="Note to customer" defaultValue={careCase.quoteNote ?? ""} />
                                            <s-button type="submit">Send quote</s-button>
                                
                                </s-stack>
                      </form>
                {careCase.quoteTotal != null && (
                    <s-paragraph>
                                Current quote total: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}
                    </s-paragraph>
                  )}
              </s-section>
        
              <s-section heading="Advance stage">
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
                                            <s-button type="submit">
                                                          Advance to next stage
                                            </s-button>
                                
                                </s-stack>
                      </form>
                      <s-paragraph tone="subdued">Stages: {STAGES.map((s) => s.label).join(" -> ")}</s-paragraph>
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
                                            <s-button type="submit" variant="tertiary">Add note</s-button>
                                
                                </s-stack>
                      </form>
              </s-section>
        </s-page>
      );
}

export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};
