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

  // Merchant-initiated case, either pre-filled from a recently-generated
  // COA kit (see StartCaseSection below) or entered fully by hand when
  // there's nothing to pick from — same handler either way, since the
  // kit click only pre-fills form fields client-side before submit.
  if (intent === "create_case") {
    const customerName = (formData.get("customerName") || "").toString().trim();
    const customerEmail = (formData.get("customerEmail") || "").toString().trim();

    if (!customerName || !customerEmail) {
      return { ok: false, error: "Customer name and email are required." };
    }

    const catalogueItemId = formData.get("catalogueItemId")?.toString() || null;
    const matchedService = catalogueItemId
      ? catalogue.find((item) => item.id === catalogueItemId)
      : null;
    const serviceName =
      matchedService?.name ||
      (formData.get("serviceName") || "").toString().trim() ||
      "Not sure — take a look";

    const careCase = await createCareCase(merchant.id, {
      customerName,
      customerEmail,
      shopifyOrderName: (formData.get("shopifyOrderName") || "").toString().trim() || null,
      productTitle: (formData.get("productTitle") || "").toString().trim() || null,
      productImageUrl: (formData.get("productImageUrl") || "").toString().trim() || null,
      catalogueItemId: catalogueItemId || null,
      serviceName,
      issueDescription: (formData.get("issueDescription") || "").toString().trim() || null,
    });

    const trackingUrl = `${appUrl}/care/${careCase.token}`;
    await sendCaseReceivedEmail({ careCase, merchant, trackingUrl });

    return { ok: true, intent: "create_case", caseId: careCase.id };
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
function StartCaseSection({ recentKits, catalogue }) {
  const fetcher = useFetcher();
  const [selectedKit, setSelectedKit] = useState(null);
  const [showManual, setShowManual] = useState(!recentKits || recentKits.length === 0);

  const isBusy = fetcher.state !== "idle";
  const hasKits = Boolean(recentKits && recentKits.length > 0);

  return (
    <s-section heading="Start a case">
      {hasKits && !showManual && (
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Recently generated Digital Unboxing Kits — click one to start a care case for that
            customer.
          </s-paragraph>
          <s-stack direction="block" gap="tight">
            {recentKits.map((kit) => (
              <s-box
                key={kit.certificateId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{ borderLeft: "4px solid #8a7758" }}
              >
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
                    Start a care case
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
          <s-button variant="tertiary" onClick={() => setShowManual(true)}>
            Or start a case manually
          </s-button>
        </s-stack>
      )}

      {(showManual || selectedKit) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("intent", "create_case");
            fetcher.submit(fd, { method: "POST" });
            setSelectedKit(null);
            setShowManual(!hasKits);
            e.currentTarget.reset();
          }}
        >
          <input type="hidden" name="intent" value="create_case" />
          <input type="hidden" name="shopifyOrderName" value={selectedKit?.orderName || ""} />
          <input type="hidden" name="productImageUrl" value={selectedKit?.productImageUrl || ""} />
          <s-stack direction="block" gap="base">
            {selectedKit && (
              <s-banner tone="info">
                Starting a case for {selectedKit.productTitle || "this piece"}
                {selectedKit.orderName ? ` (${selectedKit.orderName})` : ""} —{" "}
                <s-link onClick={() => setSelectedKit(null)}>change</s-link>
              </s-banner>
            )}
            <s-text-field
              name="customerName"
              label="Customer name"
              defaultValue={selectedKit?.customerName || ""}
              required
            />
            <s-text-field
              name="customerEmail"
              label="Customer email"
              type="email"
              defaultValue={selectedKit?.customerEmail || ""}
              required
            />
            {!selectedKit && (
              <>
                <s-text-field name="shopifyOrderName" label="Order number (optional)" />
                <s-text-field name="productTitle" label="Item (optional)" />
              </>
            )}
            {selectedKit && (
              <s-text-field name="productTitle" label="Item" defaultValue={selectedKit.productTitle || ""} />
            )}
            {catalogue.length > 0 ? (
              <s-select name="catalogueItemId" label="Service">
                <s-option value="">Not sure — take a look</s-option>
                {catalogue.map((item) => (
                  <s-option key={item.id} value={item.id}>
                    {item.name}
                  </s-option>
                ))}
              </s-select>
            ) : (
              <s-text-field name="serviceName" label="Service (optional)" />
            )}
            <s-text-field name="issueDescription" label="Notes (optional)" multiline={3} />
            <s-box paddingBlockStart="tight">
              <s-button type="submit" {...(isBusy ? { loading: true } : {})}>
                Create case & send email
              </s-button>
              {hasKits && (
                <s-button
                  variant="tertiary"
                  onClick={() => {
                    setSelectedKit(null);
                    setShowManual(false);
                  }}
                >
                  Cancel
                </s-button>
              )}
            </s-box>
          </s-stack>
        </form>
      )}
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

      <StartCaseSection recentKits={recentKits} catalogue={catalogue} />

      <s-section heading="Your customer request link">
        <s-paragraph>
          Share this link anywhere your customers need it — your order confirmation email, thank
          you page, or product page — so they can request a repair, cleaning, or return
          themselves. Every submission lands here as a new case.
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-text>{requestLink}</s-text>
        </s-box>
      </s-section>

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
        {active.length === 0 && (
          <s-paragraph>
            No requests yet — once a customer submits one, it'll show up here. Try the demo case
            button above to see how it works.
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
