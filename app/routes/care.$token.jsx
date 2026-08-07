import { useFetcher, useLoaderData } from "react-router";
import prisma from "../db.server";
import { getCaseByToken, approveQuote, declineQuote } from "../care.server";
import { STAGES, stageIndex, stageLabel } from "../care-stages";
import { sendStageUpdateEmail } from "../email.server";

// Public, unauthenticated route — the token is the access control,
// same pattern as In the Making's /journey/:token.
export const loader = async ({ params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  return { careCase };
};

export const action = async ({ request, params }) => {
  const careCase = await getCaseByToken(params.token);
  if (!careCase) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  const intent = formData.get("intent");
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const trackingUrl = `${appUrl}/care/${careCase.token}`;

  if (intent === "approve_quote" && careCase.status === "quote_sent") {
    const { case: updated } = await approveQuote(careCase.id);
    const merchant = await prisma.merchantProfile.findUnique({ where: { id: updated.merchantId } });
    await sendStageUpdateEmail({ careCase: updated, merchant, trackingUrl, note: "Thanks — we'll get started." });
    return { ok: true };
  }

  if (intent === "decline_quote" && careCase.status === "quote_sent") {
    await declineQuote(careCase.id);
    return { ok: true };
  }

  return { ok: false };
};

export default function CareTrackingPage() {
  const { careCase } = useLoaderData();
  const fetcher = useFetcher();
  const brand = careCase.merchant;
  const currentIdx = stageIndex(careCase.status);

  const styles = {
    wrap: {
      fontFamily: "Georgia, 'Times New Roman', serif",
      maxWidth: 640,
      margin: "0 auto",
      padding: "48px 24px",
      color: "#1a1a1a",
    },
    brand: {
      fontSize: 13,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: brand?.accentColor || "#8a7758",
      marginBottom: 24,
    },
    stageRow: { display: "flex", flexDirection: "column", gap: 10, margin: "24px 0" },
    stage: (active, done) => ({
      padding: "10px 14px",
      borderLeft: `3px solid ${done || active ? (brand?.accentColor || "#8a7758") : "#ddd"}`,
      color: done || active ? "#1a1a1a" : "#999",
      fontWeight: active ? "bold" : "normal",
    }),
    button: {
      padding: "12px 24px",
      background: brand?.accentColor || "#8a7758",
      color: "#fff",
      border: "none",
      cursor: "pointer",
      fontSize: 14,
      marginRight: 12,
    },
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.brand}>{brand?.brandName || "Care"}</div>
      <h1 style={{ fontWeight: "normal" }}>{careCase.productTitle || "Your piece"}</h1>
      <p style={{ color: "#555" }}>{careCase.serviceName}</p>

      <div style={styles.stageRow}>
        {STAGES.map((s, i) => (
          <div key={s.key} style={styles.stage(i === currentIdx, i < currentIdx)}>
            {s.label}
          </div>
        ))}
      </div>

      {careCase.status === "quote_sent" && careCase.quoteTotal != null && (
        <div style={{ marginTop: 32, padding: 20, background: "#faf9f7" }}>
          <h3 style={{ fontWeight: "normal" }}>
            Your quote: {careCase.quoteCurrency} {careCase.quoteTotal.toFixed(2)}
          </h3>
          {careCase.quoteNote && <p>{careCase.quoteNote}</p>}
          <div style={{ marginTop: 16 }}>
            <button
              style={styles.button}
              onClick={() => fetcher.submit({ intent: "approve_quote" }, { method: "POST" })}
            >
              Approve quote
            </button>
            <button
              style={{ ...styles.button, background: "#999" }}
              onClick={() => fetcher.submit({ intent: "decline_quote" }, { method: "POST" })}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {careCase.status === "declined" && (
        <p style={{ marginTop: 32 }}>
          This request was declined. Reach out to us any time if you'd like to revisit it.
        </p>
      )}

      <div style={{ marginTop: 48 }}>
        <h3 style={{ fontWeight: "normal", fontSize: 15 }}>Updates</h3>
        {careCase.updates
          .filter((u) => u.visibleToCustomer)
          .map((u) => (
            <div key={u.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ fontSize: 13, color: "#999" }}>{new Date(u.createdAt).toLocaleString()}</div>
              {u.status && <div style={{ fontWeight: "bold" }}>{stageLabel(u.status)}</div>}
              {u.note && <div>{u.note}</div>}
            </div>
          ))}
      </div>
    </div>
  );
}
