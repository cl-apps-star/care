import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listEmailMessages } from "../emailDelivery.server";
import { reconcileEmailMessages } from "../emailReconciliation.server";

const labels = { sending: "Sending — confirmation pending", accepted: "Accepted by sending provider", delivered: "Accepted by receiving mail server", failed: "Failed", unknown: "Unconfirmed", complained: "Spam complaint", suppressed: "Blocked" };
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  return { emails: await listEmailMessages(session.shop) };
}
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  return reconcileEmailMessages({ shop: session.shop });
}
export default function EmailStatus() {
  const { emails } = useLoaderData();
  const fetcher = useFetcher();
  return <s-page heading="Email status">
    <s-section>
      <s-paragraph>These records show sending and receiving-server outcomes. They cannot confirm whether an email reached Inbox or Junk.</s-paragraph>
      <s-button {...(fetcher.state !== "idle" ? { disabled: true } : {})} onClick={() => fetcher.submit({}, { method: "POST" })}>Refresh pending emails</s-button>
      {fetcher.data?.errors ? <s-paragraph>Some provider checks failed. Please contact support before resending.</s-paragraph> : null}
      {!emails.length ? <s-paragraph>No email records yet. Recording starts with this release; earlier emails are not included.</s-paragraph> : null}
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        {emails.length ? <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead><tr><th>Sent at (UTC)</th><th>Email</th><th>Recipient</th><th>Status</th></tr></thead>
          <tbody>{emails.map(email => <tr key={email.id}>
            <td style={{ padding: "12px 8px", borderTop: "1px solid #ddd" }}>{new Date(email.createdAt).toISOString().slice(0,16).replace("T"," ")}</td>
            <td style={{ padding: "12px 8px", borderTop: "1px solid #ddd" }}>{email.subject}</td>
            <td style={{ padding: "12px 8px", borderTop: "1px solid #ddd" }}>{email.recipients.filter(r => r.role === "to").map(r => r.email).join(", ") || "No recipient"}</td>
            <td style={{ padding: "12px 8px", borderTop: "1px solid #ddd" }}><strong>{labels[email.status] || "Unconfirmed"}</strong>{email.reason ? <div>{email.reason}</div> : null}</td>
          </tr>)}</tbody>
        </table> : null}
      </div>
    </s-section>
  </s-page>;
}
