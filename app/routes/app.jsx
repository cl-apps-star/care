import { Link, NavLink, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isLocalCarePreview } from "../localPreview.server";
import suiteStyles from "../styles/suite.css?url";
import careStyles from "../styles/suite-care.css?url";

export const links = () => [{ rel: "stylesheet", href: suiteStyles }, { rel: "stylesheet", href: careStyles }];
function PreviewProvider({ children }) { return children; }

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const merchant = await db.merchantProfile.findUnique({ where: { shop: session.shop } });

    // eslint-disable-next-line no-undef
    return { apiKey: process.env.SHOPIFY_API_KEY || "", brandName: merchant?.brandName || "Your studio", preview: isLocalCarePreview() };
};

export default function App() {
    const { apiKey, brandName, preview } = useLoaderData();
    const Provider = preview ? PreviewProvider : AppProvider;

  return (
        <Provider embedded apiKey={apiKey}>
                {!preview && <s-app-nav>
                        <s-link href="/app">Home</s-link>
                        <s-link href="/app/cases">Cases</s-link>
                        <s-link href="/app/catalogue">Services & pricing</s-link>
                        <s-link href="/app/branding">Branding & setup</s-link>
                        <s-link href="/app/billing">Billing</s-link>
                  <s-link href="/app/email-status">Email status</s-link>
                </s-app-nav>}
              <div className="cl-suite care-suite">
                <header className="suite-topbar">
                  <Link to="/app" className="suite-brand"><span className="suite-mark">C</span><span>Care<small>BY CL APPS</small></span></Link>
                  <span className="suite-store">{brandName}</span>
                </header>
                <nav className="suite-nav" aria-label="Care navigation">
                  <NavLink to="/app" end>Home</NavLink>
                  <NavLink to="/app/cases">Cases</NavLink>
                  <NavLink to="/app/catalogue">Services &amp; pricing</NavLink>
                  <NavLink to="/app/branding">Branding &amp; setup</NavLink>
                  <NavLink to="/app/billing">Billing</NavLink>
                  <NavLink to="/app/email-status">Email status</NavLink>
                </nav>
                {preview && <div className="suite-demo">LOCAL PREVIEW · Fictional studio. Customer emails and Shopify changes are disabled.</div>}
                <div className="care-suite-content"><Outlet /></div>
                <footer className="suite-footer"><span>CL Apps · Crafted Lifecycle</span><span><a href="mailto:hello@cl-apps.net">Founder support</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></span></footer>
              </div>
        </Provider>
      );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
    return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};
