import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateMerchantProfile, listCasesForMerchant, listCatalogue, createCareCase } from "../care.server";
import { sendCaseReceivedEmail } from "../email.server";
import { needsMerchantAction } from "../care-stages";
import styles from "../styles/care-admin.module.css";

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
  const content = (
    <>
      <span className={`${styles.stepNumber} ${done ? styles.stepDone : ""}`}>
        {done ? "✓" : number}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className={styles.stepAction}>{loading ? "Creating…" : done ? "Review" : ctaLabel}</span>
    </>
  );
  return href ? (
    <Link className={styles.step} to={href}>{content}</Link>
  ) : (
    <button className={styles.step} type="button" onClick={onClick} disabled={loading}>{content}</button>
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
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>{allDone ? "Set up" : "Start here"}</p>
          <h2>{allDone ? "Your customer care flow is ready" : "Three simple steps"}</h2>
        </div>
      </div>
      <div className={styles.stepList}>
        <Step
          done={hasBranding}
          number={1}
          title="Set up your branding"
          description="Name, colours, logo and support details."
          href="/app/branding"
          ctaLabel="Set up branding"
        />
        <Step
          done={hasCatalogue}
          number={2}
          title="Build your service catalogue"
          description="Add what customers can ask you to help with."
          href="/app/catalogue"
          ctaLabel="Add services"
        />
        <Step
          done={hasCase}
          number={3}
          title="Create your first case"
          description="See the full experience without using a real customer."
          onClick={onCreateDemoCase}
          ctaLabel="Create a demo case"
          loading={creatingDemo}
        />
      </div>
    </section>
  );
}

export default function Index() {
  const { merchant, cases, catalogue } = useLoaderData();
  const fetcher = useFetcher();
  const isCreatingDemo = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "create_test_case";
  const active = cases.filter((careCase) => !["completed", "declined"].includes(careCase.status));
  const needingAttention = active.filter(needsMerchantAction).length;
  const completed = cases.filter((careCase) => careCase.status === "completed").length;
  const ready = Boolean(merchant.brandName) && catalogue.length > 0 && cases.length > 0;

  return (
    <s-page heading={ready ? "Care" : "Set up Care"} inlineSize="large">
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Customer care</p>
            <h1>{ready ? "Everything that needs your attention" : "A calmer way to manage aftercare"}</h1>
            <p className={styles.lede}>
              Requests, quotes, approvals and progress in one clear place.
            </p>
          </div>
          <Link className={styles.primaryLink} to="/app/cases">Go to cases</Link>
        </header>

        <div className={styles.stats}>
          <div className={styles.stat}><strong>{needingAttention}</strong><span>Need your attention</span></div>
          <div className={styles.stat}><strong>{active.length}</strong><span>In progress</span></div>
          <div className={styles.stat}><strong>{completed}</strong><span>Completed</span></div>
        </div>

        <div className={styles.dashboardGrid}>
          <GetStartedSection
            merchant={merchant}
            catalogue={catalogue}
            cases={cases}
            onCreateDemoCase={() => fetcher.submit({ intent: "create_test_case" }, { method: "POST" })}
            creatingDemo={isCreatingDemo}
          />
          <aside className={`${styles.card} ${styles.quickLinks}`}>
            <p className={styles.eyebrow}>Set once</p>
            <h2>Your customer experience</h2>
            <Link to="/app/branding"><span>Branding & setup</span><small>{merchant.brandName || "Not set yet"}</small></Link>
            <Link to="/app/catalogue"><span>Services & pricing</span><small>{catalogue.length} service{catalogue.length === 1 ? "" : "s"}</small></Link>
            <Link to="/app/billing"><span>Plan & usage</span><small>View your allowance</small></Link>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
