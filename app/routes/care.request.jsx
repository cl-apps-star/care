import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { loadRequestPageData, runRequestAction } from "../care-request.server";

// Public, unauthenticated route — the GENERIC customer-facing way to start
// a repair/return request: `${appUrl}/care/request?shop=<shop>`, shared
// wherever makes sense for the merchant (order confirmation email,
// thank-you page, product page, customer account). No login required, same
// access pattern as the tracking page at /care/:token.
//
// Personalized "start a case for THIS customer" invites sent from the
// dashboard use a different route — care.request.$token.jsx — which
// prefills from a stored CareInvite instead of query params (see that
// route and the CareInvite model in schema.prisma for why). This route
// still accepts old-style ?email=&name=&order=&productTitle= params for
// any invite links sent before that change, so they don't 404.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  return loadRequestPageData({
    shop,
    actionUrl: `/care/request?shop=${encodeURIComponent(shop || "")}`,
    prefillEmail: url.searchParams.get("email"),
    prefillOrder: url.searchParams.get("order"),
    prefillName: url.searchParams.get("name"),
    prefillProductTitle: url.searchParams.get("productTitle"),
  });
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const formData = await request.formData();
  return runRequestAction({ shop, formData });
};

function Shell({ brand, children }) {
  const accent = brand?.accentColor || "#8a7758";
  return (
    <div style={{ "--accent": accent }}>
      <style>{`
        .care-req-wrap {
          font-family: Georgia, 'Times New Roman', serif;
          max-width: 480px;
          margin: 0 auto;
          padding: 64px 24px 64px;
          color: #232320;
          background: #fffdfa;
        }
        .care-req-eyebrow {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          text-align: center;
          margin-bottom: 22px;
        }
        .care-req-wrap h1 { font-weight: normal; font-size: 24px; text-align: center; margin: 0 0 10px; }
        .care-req-wrap > p.care-req-intro {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          color: #7d7a72; font-size: 13.5px; line-height: 1.6;
          text-align: center; margin: 0 0 40px;
        }
        .care-field { display: block; margin-bottom: 22px; }
        .care-field-label {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
          color: #a39d90; margin-bottom: 8px;
        }
        .care-field input, .care-field select, .care-field textarea {
          display: block; width: 100%; box-sizing: border-box;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 15px; color: #232320;
          padding: 10px 2px; border: none; border-bottom: 1px solid #e4e0d8;
          background: transparent;
        }
        .care-field input:focus, .care-field select:focus, .care-field textarea:focus {
          outline: none; border-bottom-color: var(--accent);
        }
        .care-field textarea { min-height: 96px; font-family: Georgia, 'Times New Roman', serif; resize: vertical; }
        .care-req-note {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12.5px; color: #7d7a72; margin: -12px 0 22px;
        }
        .care-req-error {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 13px; color: #a4463a; margin: -6px 0 20px;
        }
        .care-req-btn {
          display: block; width: 100%; box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 14px 22px; border: 1px solid var(--accent);
          color: #fff; background: var(--accent); text-align: center;
          cursor: pointer; margin-top: 10px;
        }
        .care-req-btn:disabled { opacity: 0.6; cursor: default; }
        .care-req-link {
          display: inline-block; margin-top: 18px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12.5px; color: var(--accent); text-decoration: none;
          border-bottom: 1px solid var(--accent); padding-bottom: 1px;
        }
        .care-req-found {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12.5px; color: #7d7a72; margin: -8px 0 22px;
        }
      `}</style>
      <div className="care-req-wrap">
        <div className="care-req-eyebrow">{brand?.brandName || "CL Apps"}</div>
        {children}
      </div>
    </div>
  );
}

export default function CareRequestPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (data.error === "missing_shop") {
    return (
      <Shell brand={null}>
        <h1>This link is missing some information</h1>
        <p className="care-req-intro">Please use the exact link your retailer shared with you, or contact them directly.</p>
      </Shell>
    );
  }

  if (data.error === "not_found") {
    return (
      <Shell brand={null}>
        <h1>We couldn't find this page</h1>
        <p className="care-req-intro">Please double-check the link, or contact the retailer directly.</p>
      </Shell>
    );
  }

  const { merchant, catalogue, actionUrl } = data;

  if (actionData?.step === "done") {
    return (
      <Shell brand={merchant}>
        <h1>Thanks — we've got your request</h1>
        <p className="care-req-intro">
          We've sent a confirmation to <strong>{actionData.customerEmail}</strong> with a link to
          track progress. We'll be in touch with next steps shortly.
        </p>
        <div style={{ textAlign: "center" }}>
          <a href={actionData.trackingUrl} className="care-req-link">
            Track your request now →
          </a>
        </div>
      </Shell>
    );
  }

  // A real form submission (actionData present) always wins over the
  // loader's prefill — the prefill only matters for the very first render
  // of a personalized invite link.
  const fromAction = actionData?.step === "details";
  const prefill = !actionData ? data.prefill : null;
  const showDetails = fromAction || Boolean(prefill);
  const lookup = fromAction ? actionData.lookup : prefill?.lookup || null;
  const orderNumber = fromAction ? actionData.orderNumber : prefill?.orderNumber || "";
  const email = fromAction ? actionData.email : prefill?.email || "";
  const prefillName = prefill?.name || "";
  const prefillProductTitle = prefill?.productTitle || "";

  return (
    <Shell brand={merchant}>
      <h1>Request a repair or return</h1>
      <p className="care-req-intro">
        Tell us a little about your piece and what's going on — we'll follow up with a quote and
        next steps.
      </p>

      {!showDetails && (
        <Form method="post" action={actionUrl}>
          <input type="hidden" name="intent" value="lookup_order" />
          <label className="care-field">
            <span className="care-field-label">Order number</span>
            <input name="orderNumber" placeholder="e.g. 1003" />
          </label>
          <label className="care-field">
            <span className="care-field-label">Email used at checkout</span>
            <input type="email" name="email" required />
          </label>
          <p className="care-req-note">
            Don't have your order number handy? Leave it blank and continue — you'll be able to
            describe your item instead.
          </p>
          <button type="submit" className="care-req-btn" disabled={submitting}>
            {submitting ? "Looking up your order…" : "Continue"}
          </button>
        </Form>
      )}

      {showDetails && (
        <Form method="post" action={actionUrl} encType="multipart/form-data">
          <input type="hidden" name="intent" value="submit_request" />
          <input type="hidden" name="orderNumber" value={orderNumber} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="lookupJson" value={JSON.stringify(lookup || {})} />

          {lookup?.found ? (
            <>
              <input type="hidden" name="shopifyOrderId" value={lookup.shopifyOrderId} />
              <input type="hidden" name="shopifyOrderName" value={lookup.shopifyOrderName} />
              <input type="hidden" name="lineItemsJson" value={JSON.stringify(lookup.lineItems)} />
              <p className="care-req-found">Found order {lookup.shopifyOrderName}.</p>
              {lookup.lineItems.length > 1 ? (
                <label className="care-field">
                  <span className="care-field-label">Which item is this about?</span>
                  <select name="selectedLineItem" defaultValue="0">
                    {lookup.lineItems.map((li, i) => (
                      <option key={i} value={i}>
                        {li.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="selectedLineItem" value="0" />
              )}
            </>
          ) : (
            <>
              {lookup?.reason === "not_found" || lookup?.reason === "email_mismatch" ? (
                <p className="care-req-found">
                  We couldn't match that to an order — no problem, just tell us about your item
                  below.
                </p>
              ) : null}
              <label className="care-field">
                <span className="care-field-label">What's the item?</span>
                <input
                  name="productTitle"
                  placeholder="e.g. Gold signet ring"
                  defaultValue={prefillProductTitle}
                  required
                />
              </label>
            </>
          )}

          <label className="care-field">
            <span className="care-field-label">Your name</span>
            <input name="name" defaultValue={prefillName} required />
          </label>

          <label className="care-field">
            <span className="care-field-label">What service do you need?</span>
            <select name="catalogueItemId" defaultValue="">
              <option value="">Not sure — let us take a look</option>
              {catalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {catalogue.length === 0 && (
            <p className="care-req-note">
              This retailer hasn't listed specific services yet — that's fine, just describe what
              you need below.
            </p>
          )}

          <label className="care-field">
            <span className="care-field-label">Describe the issue</span>
            <textarea name="issueDescription" required />
          </label>

          <label className="care-field">
            <span className="care-field-label">Add a photo (optional)</span>
            <input type="file" name="photo" accept="image/*" />
          </label>

          {actionData?.formError && <p className="care-req-error">{actionData.formError}</p>}

          <button type="submit" className="care-req-btn" disabled={submitting}>
            {submitting ? "Sending…" : "Submit request"}
          </button>
        </Form>
      )}
    </Shell>
  );
}
