import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateMerchantProfile, listCasesForMerchant, listCatalogue, createCareCase } from "../care.server";
import { sendCaseReceivedEmail } from "../email.server";

// Home is now just the overview: getting-started checklist + explainer.
// Everything about actually working cases (starting one, the active/
// completed lists) lives on its own page at /app/cases — see
// app.cases._index.jsx. Kept split so this page stays a quick "am I set
// up, what does this app do" landing rather than growing back into a
// long scroll of unrelated sections.
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

  // Only action this page needs — "try it" for step 3 of the checklist.
  // Everything else (sending a real customer their request link, advancing
  // a case) lives in app.cases._index.jsx and app.cases.$id.jsx now.
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

  return { ok: false };
};

// Same "Get started" checklist pattern as Digital Unboxing & COA Kit's
// dashboard — a numbered Step with a Done/Step N badge, a short
// description, and a CTA that either navigates (href) or fires an action
// in place (onClick, used for "create a demo case" so the merchant
// doesn't have to leave the page to try it).
function Step({ done, number, title, description, href, onClick, ctaLabel, loading }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone={done ? "success" : "neutral"}>{done ? "Done" : `Step ${number}`}</s-badge>
          <s-stack direction="block" gap="none">
            <s-text weight="bold">{title}</s-text>
            <s-text tone="subdued">{description}</s-text>
          </s-stack>
        </s-stack>
        {href ? (
          <s-button href={href} variant={done ? "tertiary" : "primary"}>
            {done ? "Review" : ctaLabel}
          </s-button>
        ) : (
          <s-button
            variant={done ? "tertiary" : "primary"}
            onClick={onClick}
            {...(loading ? { loading: true } : {})}
          >
            {done ? "Review" : ctaLabel}
          </s-button>
        )}
      </s-stack>
    </s-box>
  );
}

function InfoRow({ title, children }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="tight">
        <s-text weight="bold">{title}</s-text>
        <s-text tone="subdued">{children}</s-text>
      </s-stack>
    </s-box>
  );
}

// Collapses to a one-line "You're all set up" once every step is done,
// same behaviour as COA's — no point showing a three-step checklist
// forever once it's irrelevant.
function GetStartedSection({ merchant, catalogue, cases, onCreateDemoCase, creatingDemo }) {
  const hasBranding = Boolean(merchant.brandName);
  const hasCatalogue = catalogue.length > 0;
  const hasCase = cases.length > 0;
  const allDone = hasBranding && hasCatalogue && hasCase;

  return (
    <s-section heading={allDone ? "You're all set up" : "Three steps to get Care working for you"}>
      {!allDone && (
        <s-paragraph>
          This should take about five minutes. Once all three are done, customers can request
          repairs, cleaning, or returns themselves — branded to match your store, with quotes,
          tracking, and payment built in.
        </s-paragraph>
      )}
      <s-stack direction="block" gap="base">
        <Step
          done={hasBranding}
          number={1}
          title="Set up your branding"
          description="Your brand name, colours, and support email — this fills in your customer request form, tracking page, and every email automatically."
          href="/app/branding"
          ctaLabel="Set up branding"
        />
        <Step
          done={hasCatalogue}
          number={2}
          title="Build your service catalogue"
          description="Add the repairs, cleaning, or maintenance services you offer, so customers can pick one when they submit a request."
          href="/app/catalogue"
          ctaLabel="Add services"
        />
        <Step
          done={hasCase}
          number={3}
          title="Create your first case"
          description="Try it with a demo case — no real customer needed — to see the tracking page and emails a customer would get."
          onClick={onCreateDemoCase}
          ctaLabel="Create a demo case"
          loading={creatingDemo}
        />
      </s-stack>
    </s-section>
  );
}

export default function Index() {
  const { merchant, cases, catalogue } = useLoaderData();
  const fetcher = useFetcher();
  const isCreatingDemo = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "create_test_case";

  return (
    <s-page heading="Care">
      <s-button href="/app/cases" slot="primary-action">
        Go to cases
      </s-button>

      <GetStartedSection
        merchant={merchant}
        catalogue={catalogue}
        cases={cases}
        onCreateDemoCase={() => fetcher.submit({ intent: "create_test_case" }, { method: "POST" })}
        creatingDemo={isCreatingDemo}
      />

      <s-section heading="What this app does">
        <s-paragraph>
          Care turns ad-hoc repair, cleaning, and maintenance requests into a structured
          workflow. A customer submits a request (through your request link, or one you send
          them directly), you send them a quote, they approve and pay through a real Shopify
          order, and they can track progress the whole way through on a branded page — without a
          single back-and-forth email.
        </s-paragraph>
      </s-section>

      <s-section heading="Setting up & personalizing">
        <s-stack direction="block" gap="tight">
          <InfoRow title="Branding">
            Set this once: your brand name, colours, and support email. Support email also
            controls whether you get notified by email when a customer submits a new case —
            leave it blank and Care just won't send that alert.
          </InfoRow>
          <InfoRow title="Service catalogue">
            The list of services customers choose from on the request form — cleaning, repairs,
            resizing, restoration, whatever fits your business. Customers can also pick "Not
            sure — let us take a look" if nothing fits.
          </InfoRow>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
