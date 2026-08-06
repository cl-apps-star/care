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

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const merchant = await getOrCreateMerchantProfile(session.shop);
    const [cases, catalogue] = await Promise.all([
          listCasesForMerchant(merchant.id),
          listCatalogue(merchant.id),
        ]);
    return { merchant, cases, catalogue };
};

export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const merchant = await getOrCreateMerchantProfile(session.shop);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const appUrl = process.env.SHOPIFY_APP_URL || "";
  
    if (intent === "create_test_case") {
          const careCase = await createCareCase(merchant.id, {
                  customerName: "Test Customer",
                  customerEmail: session.email || "candicersalter@gmail.com",
                  shopifyOrderName: "#TEST-" + Math.floor(Math.random() * 9000 + 1000),
                  productTitle: "Sample Piece",
                  serviceName: "General repair",
          });
          const trackingUrl = `${appUrl}/care/${careCase.token}`;
          await sendCaseReceivedEmail({ careCase, merchant, trackingUrl });
          return { ok: true };
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

export default function Index() {
    const { merchant, cases, catalogue } = useLoaderData();
    const fetcher = useFetcher();
  
    const active = cases.filter((c) => c.status !== "completed" && c.status !== "declined");
    const completed = cases.filter((c) => c.status === "completed");
  
    return (
          <s-page heading="Care">
                <s-button
                          slot="primary-action"
                          onClick={() => fetcher.submit({ intent: "create_test_case" }, { method: "POST" })}
                        >
                        Create a test case
                </s-button>
          
            {catalogue.length === 0 && (
                    <s-section heading="Set up your service catalogue">
                              <s-paragraph>
                                          You haven't added any services yet - cleaning, repairs, resizing,
                                          restoration. Go to{" "}
                                          <s-link href="/app/catalogue">Service catalogue</s-link> to add
                                          your first one before customers can request service.
                              </s-paragraph>
                    </s-section>
                  )}
          
                <s-section heading={`Active cases (${active.length})`}>
                  {active.length === 0 && (
                      <s-paragraph>No active service cases yet.</s-paragraph>
                    )}
                        <s-stack direction="block" gap="base">
                          {active.map((c) => (
                        <s-box key={c.id} padding="base" borderWidth="base" borderRadius="base">
                                      <s-stack direction="inline" gap="base" alignItems="center">
                                                      <s-stack direction="block" gap="tight">
                                                                        <s-text weight="bold">
                                                                          {c.productTitle || "Untitled piece"} - {c.serviceName}
                                                                        </s-text>
                                                                        <s-text tone="subdued">
                                                                          {c.customerName} - {c.customerEmail}
                                                                          {c.shopifyOrderName ? ` - ${c.shopifyOrderName}` : ""}
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
                  {completed.length === 0 && <s-paragraph>Nothing completed yet.</s-paragraph>}
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
</s-page>·
