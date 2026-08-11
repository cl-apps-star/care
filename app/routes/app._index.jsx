import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMerchantProfile,
  listCasesForMerchant,
  listCatalogue,
  createCareCase,
  advanceCase,
} from "../care.server";
import { stageLabel } from "../care-stages";
import {
  sendCaseReceivedEmail,
  sendStageUpdateEmail,
  sendReadyToReturnEmail,
  sendCareRequestInviteEmail,
} from "../email.server";
import { getRecentCoaKits } from "../coa-lookup.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchantProfile(session.shop);
  const [cases, catalogue, recentKits] = await Promise.all([
    listCasesForMerchant(merchant.id),
    listCatalogue(merchant.id),
    getRecentCoaKits(session.shop),
  ]);
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const requestLink = `${appUrl}/care/request?shop=${encodeURIComponent(session.shop)}`;
  return { merchant, cases, catalogue, requestLink, recentKits };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchantProfile(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const appUrl = process.env.SHOPIFY_APP_URL || "";

  if (intent === "create_test_case") {
    const careCase = await createCareCase(merchant.id, {
      customerName: "Demo Customer",
      customerEmail: session.email || "candicersalter@gmail.com",
      shopifyOrderName: "#DEMO-" + Math.floor(Math.random() * 9000 + 1000),
      productTitle: "Sample Piece",
      serviceName: "General repair",
      issueDescription: "This is a demo case — safe to ignore or delete.",
    });
    const trackingUrl = `${appUrl}/care/${careCase.token}`;
    await sendCaseReceivedEmail({ careCase, merchant, trackingUrl });
    return { ok: true };
  }

  // Merchant identifies a customer — either picking a recently-generated
  // COA kit, or typing in order/email by hand (see StartCaseSection below)
  // — and Care sends THAT customer a branded invite email with a link to
  // the public request form, pre-filled with what the merchant already
  // knows. No CareCase is created here; the case is created for real when
  // the customer actually submits the form themselves (care.request.jsx's
  // submit_request action) — same as the fully organic/shared-link path.
  if (intent === "send_request_email") {
    const customerName = (formData.get("customerName") || "").toString().trim();
    const customerEmail = (formData.get("customerEmail") || "").toString().trim();

    if (!customerEmail) {
      return { ok: false, error: "Customer email is required." };
    }

    const shopifyOrderName = (formData.get("shopifyOrderName") || "").toString().trim() || null;
    const productTitle = (formData.get("productTitle") || "").toString().trim() || null;

    const portalUrl = new URL("/care/request", appUrl);
    portalUrl.searchParams.set("shop", session.shop);
    portalUrl.searchParams.set("email", customerEmail);
    if (shopifyOrderName) portalUrl.searchParams.set("order", shopifyOrderName.replace(/^#/, ""));
    if (customerName) portalUrl.searchParams.set("name", customerName);
    if (productTitle) portalUrl.searchParams.set("productTitle", productTitle);

    await sendCareRequestInviteEmail({
      merchant,
      customerName,
      customerEmail,
      orderName: shopifyOrderName,
      productTitle,
      portalUrl: portalUrl.toString(),
    });

    return { ok: true, intent: "send_request_email" };
  }

  if (intent === "advance") {
    const caseId = formData.get("caseId");
    const note = formData.get("note") || undefined;
    const notify = formData.get("notify") === "on";
    const { case: updated } = await advanceCase(caseId, { note, notifyCustomer: notify });
    if (notify) {
      const trackingUrl = `${appUrl}/care/${updated.token}`;
      if (updated.status === "ready_to_return") {
        await sendReadyToReturnEmail({ careCase: updated, merchant, trackingUrl });
      } else {
        await sendStageUpdateEmail({ careCase: updated, merchant, trackingUrl, note });
      }
    }
    return { ok: true };
  }

  return { ok: false };
};

// Top-of-dashboard section for starting a new case. When Digital
// Unboxing & COA Kit is installed and has generated kits for this shop,
// shows a color-coded (bronze, matching the suite's accent) list of the
// last few — click one and it pre-fills a case form with that
// customer/order/item, still editable, before you pick a service and
// submit. When COA isn't installed or has zero kits yet, `recentKits` is
// null and this collapses straight to the same form, blank — no error
// state, no dead space either way.
// Same tinted-card pattern already used across the suite (Digital Unboxing &
// COA Kit, In the Making's maker profile page): a plain div with a tinted
// background and a colored left-border accent, so each section reads as its
// own distinct block at a glance. Polaris web components like s-box don't
// reliably apply arbitrary inline styles, which is why a plain div is used
// here instead.
const SECTION_TINTS = {
  kits: { background: "#FBF8F3", border: "#8a7758" }, // bronze — matches Digital Unboxing & COA Kit's own accent
  link: { background: "#F2F7F9", border: "#5b7a8a" }, // slate blue
  manual: { background: "#FBF3EF", border: "#9a6b56" }, // terracotta
  active: { background: "#F3F7F4", border: "#6b8a72" }, // sage
};

function TintedSection({ tint, children }) {
  const style = SECTION_TINTS[tint] || SECTION_TINTS.kits;
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

// Picking a recent COA kit and sending that customer an invite email. Fully
// separate from ManualEntrySection below — its own section, its own form,
// its own accent color — so there's no shared/ambiguous state between "I'm
// picking a kit" and "I'm typing in details by hand".
function RecentKitsSection({ recentKits }) {
  const fetcher = useFetcher();
  const [selectedKit, setSelectedKit] = useState(null);
  const isBusy = fetcher.state !== "idle";
  const justSent = fetcher.data?.ok && fetcher.data?.intent === "send_request_email";

  if (!recentKits || recentKits.length === 0) return null;

  return (
    <s-section heading="Start a case — from a recent COA kit">
      <TintedSection tint="kits">
        {justSent && (
          <s-banner tone="success">
            Sent! We've emailed them a link to fill in the rest of the details themselves.
          </s-banner>
        )}
        <s-paragraph>
          Recently generated Digital Unboxing Kits — pick one to email that customer a link to
          request a repair, cleaning, or return.
        </s-paragraph>
        <s-stack direction="block" gap="tight">
          {recentKits.map((kit) => (
            <s-box key={kit.certificateId} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-stack direction="block" gap="tight">
                  <s-text weight="bold">
                    {kit.productTitle || "Untitled piece"}
                    {kit.orderName ? ` — ${kit.orderName}` : ""}
                  </s-text>
                  <s-text tone="subdued">
                    {kit.customerName || "—"} · {kit.customerEmail || "—"}
                  </s-text>
                </s-stack>
                <s-button variant="secondary" onClick={() => setSelectedKit(kit)}>
                  Send them the form
                </s-button>
              </s-stack>
            </s-box>
          ))}
        </s-stack>

        {selectedKit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("intent", "send_request_email");
              fetcher.submit(fd, { method: "POST" });
              setSelectedKit(null);
              e.currentTarget.reset();
            }}
          >
            <input type="hidden" name="intent" value="send_request_email" />
            <input type="hidden" name="shopifyOrderName" value={selectedKit.orderName || ""} />
            <s-stack direction="block" gap="base">
              <s-banner tone="info">
                Sending to {selectedKit.customerName || "this customer"} about{" "}
                {selectedKit.productTitle || "this piece"}
                {selectedKit.orderName ? ` (${selectedKit.orderName})` : ""} —{" "}
                <s-link onClick={() => setSelectedKit(null)}>change</s-link>
              </s-banner>
              <s-text-field
                name="customerName"
                label="Customer name"
                defaultValue={selectedKit.customerName || ""}
              />
              <s-text-field
                name="customerEmail"
                label="Customer email"
                type="email"
                defaultValue={selectedKit.customerEmail || ""}
                required
              />
              <s-text-field
                name="productTitle"
                label="Item"
                defaultValue={selectedKit.productTitle || ""}
              />
              <s-box paddingBlockStart="tight">
                <s-button type="submit" {...(isBusy ? { loading: true } : {})}>
                  Send them the form
                </s-button>
                <s-button variant="tertiary" onClick={() => setSelectedKit(null)}>
                  Cancel
                </s-button>
              </s-box>
            </s-stack>
          </form>
        )}
      </TintedSection>
    </s-section>
  );
}

// Typing in a customer's order number / email by hand — a completely
// separate path from RecentKitsSection above, its own section and its own
// accent color, for the case where there's no COA kit to pick from (or the
// merchant just prefers to type it in).
function ManualEntrySection() {
  const fetcher = useFetcher();
  const isBusy = fetcher.state !== "idle";
  const justSent = fetcher.data?.ok && fetcher.data?.intent === "send_request_email";
  const [formKey, setFormKey] = useState(0);

  return (
    <s-section heading="Start a case — enter details manually">
      <TintedSection tint="manual">
        {justSent && (
          <s-banner tone="success">
            Sent! We've emailed them a link to fill in the rest of the details themselves.
          </s-banner>
        )}
        <s-paragraph>
          No COA kit for this customer, or starting from an order number instead? Enter what you
          know below and we'll email them a link to fill in the rest.
        </s-paragraph>
        <form
          key={formKey}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("intent", "send_request_email");
            fetcher.submit(fd, { method: "POST" });
            setFormKey((k) => k + 1);
          }}
        >
          <input type="hidden" name="intent" value="send_request_email" />
          <s-stack direction="block" gap="base">
            <s-text-field name="customerName" label="Customer name" />
            <s-text-field name="customerEmail" label="Customer email" type="email" required />
            <s-text-field name="shopifyOrderName" label="Order number (optional)" />
            <s-text-field name="productTitle" label="Item (optional)" />
            <s-box paddingBlockStart="tight">
              <s-button type="submit" {...(isBusy ? { loading: true } : {})}>
                Send them the form
              </s-button>
            </s-box>
          </s-stack>
        </form>
      </TintedSection>
    </s-section>
  );
}

export default function Index() {
  const { merchant, cases, catalogue, requestLink, recentKits } = useLoaderData();
  const fetcher = useFetcher();

  const active = cases.filter((c) => c.status !== "completed" && c.status !== "declined");
  const completed = cases.filter((c) => c.status === "completed");

  return (
    <s-page heading="Care">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({ intent: "create_test_case" }, { method: "POST" })}
      >
        Create a demo case
      </s-button>

      <RecentKitsSection recentKits={recentKits} />

      <s-section heading="Your customer request link">
        <TintedSection tint="link">
          <s-paragraph>
            Share this link anywhere your customers need it — your order confirmation email,
            thank you page, or product page — so they can request a repair, cleaning, or return
            themselves. Every submission lands here as a new case.
          </s-paragraph>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>{requestLink}</s-text>
          </s-box>
        </TintedSection>
      </s-section>

      <ManualEntrySection />

      {catalogue.length === 0 && (
        <s-section heading="Set up your service catalogue">
          <s-paragraph>
            Add the services you offer — cleaning, repairs, resizing, restoration, whatever fits
            your business — so customers can pick one when they submit a request. Head to{" "}
            <s-link href="/app/catalogue">Service catalogue</s-link> to add your first one.
          </s-paragraph>
        </s-section>
      )}

      <s-section heading={`Active cases (${active.length})`}>
        <TintedSection tint="active">
          {active.length === 0 && (
            <s-paragraph>
              No requests yet — once a customer submits one, it'll show up here. Try the demo
              case button above to see how it works.
            </s-paragraph>
          )}
          <s-stack direction="block" gap="base">
            {active.map((c) => (
              <s-box key={c.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-stack direction="block" gap="tight">
                    <s-text weight="bold">
                      {c.productTitle || "Untitled piece"} — {c.serviceName}
                    </s-text>
                    <s-text tone="subdued">
                      {c.customerName} · {c.customerEmail}
                      {c.shopifyOrderName ? ` · ${c.shopifyOrderName}` : ""}
                    </s-text>
                    <s-badge>{stageLabel(c.status)}</s-badge>
                  </s-stack>
                  <s-link href={`/app/cases/${c.id}`}>Open</s-link>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </TintedSection>
      </s-section>

      <s-section heading={`Completed (${completed.length})`}>
        {completed.length === 0 && (
          <s-paragraph>Completed cases will show up here once you close one out.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Service catalogue">
        <s-paragraph>{catalogue.length} active service(s).</s-paragraph>
        <s-link href="/app/catalogue">Manage catalogue</s-link>
      </s-section>

      <s-section slot="aside" heading="Branding">
        <s-paragraph>{merchant.brandName || "Not set yet"}</s-paragraph>
        <s-link href="/app/branding">Edit branding</s-link>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
