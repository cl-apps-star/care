// Public, unauthenticated privacy policy page — required as a "Resources"
// link on the App Store listing for any app that touches customer data
// (Care does: name, email, order info, service requests, photos). This is
// a starting draft describing what Care actually does in code today; it
// has NOT been reviewed by a lawyer and should be before submission if
// Candice wants a policy she can stand behind legally rather than just
// technically accurate.
export default function PrivacyPolicy() {
  return (
    <div
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: "56px 24px",
        color: "#232320",
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontWeight: "normal" }}>Care — Privacy Policy</h1>
      <p style={{ color: "#7a7a73", fontSize: 13 }}>Last updated: August 2026</p>

      <p>
        Care is a Shopify app that lets merchants track repair, cleaning, and return requests for
        their customers. This page explains what information Care collects, why, and how it's
        handled.
      </p>

      <h2 style={{ fontWeight: "normal", fontSize: 20 }}>What we collect</h2>
      <p>When a customer submits a service request through Care, we collect:</p>
      <ul>
        <li>Name and email address</li>
        <li>Order number and product details, where provided</li>
        <li>A description of the issue or service needed</li>
        <li>An optional photo of the item</li>
      </ul>
      <p>
        We also store the merchant's own branding details (shop name, logo, colors, support email)
        and the service catalogue they define.
      </p>

      <h2 style={{ fontWeight: "normal", fontSize: 20 }}>How it's used</h2>
      <p>
        This information is used solely to operate the service request: showing the merchant the
        request, generating a branded tracking page for the customer, and sending status update
        emails as the request moves through the merchant's workflow. We do not sell customer data,
        and we do not use it for advertising.
      </p>

      <h2 style={{ fontWeight: "normal", fontSize: 20 }}>Who can see it</h2>
      <p>
        A customer's request is visible to the merchant who received it, and to the customer
        themselves via a private, unguessable tracking link. Care does not share data between
        different merchants' shops.
      </p>

      <h2 style={{ fontWeight: "normal", fontSize: 20 }}>Data retention &amp; deletion</h2>
      <p>
        Data is retained for as long as the merchant's shop has Care installed, so historical
        cases remain visible to them. If a shop uninstalls Care, or a customer requests deletion of
        their data, we honor Shopify's mandatory compliance webhooks (customer data request,
        customer redact, shop redact) to fulfill that request.
      </p>

      <h2 style={{ fontWeight: "normal", fontSize: 20 }}>Contact</h2>
      <p>
        Questions about this policy or a specific request can be sent to{" "}
        <a href="mailto:hello@cl-apps.net">hello@cl-apps.net</a>.
      </p>
    </div>
  );
}
