// Thin, provider-agnostic sending layer — same file, same behavior, as the
// one in the Digital Unboxing & COA Kit app, so all three apps in the suite
// send through an identical path. Every Care email is built exactly once
// (same HTML, same plain text, same subject, same From name) in
// email.server.js. This file is the only place that knows there are two
// possible providers behind that single send.
//
// Selection is one server-side env var, EMAIL_PROVIDER ("resend" or
// "postmark"). It defaults to "resend", so nothing changes for real
// customer traffic until it's explicitly switched on Railway.
//
// Deliberately no auto-fallback from one provider to the other: if a send
// fails, it's reported as failed and stops there. Silently retrying on a
// second provider risks a duplicate email reaching the customer if the
// first attempt actually went out but the success response never made it
// back (a timeout, a dropped connection, etc).

async function sendViaResend({ from, to, replyTo, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "RESEND_API_KEY not set." };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from,
    to,
    replyTo,
    subject,
    html,
    text,
  });

  if (error) {
    return {
      skipped: true,
      reason: error.message || "Resend rejected the email.",
    };
  }

  return { skipped: false, provider: "resend", providerMessageId: data?.id };
}

async function sendViaPostmark({ from, to, replyTo, subject, html, text }) {
  if (!process.env.POSTMARK_API_KEY) {
    return { skipped: true, reason: "POSTMARK_API_KEY not set." };
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_API_KEY,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      ReplyTo: replyTo,
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      // Postmark keeps transactional mail on its own reputation track,
      // separate from broadcast/marketing sends — this must be a
      // "Transactional" stream (default server stream ID is "outbound").
      // Overridable via env in case the Postmark server is set up with a
      // differently-named stream.
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
    }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result || result.ErrorCode) {
    return {
      skipped: true,
      reason:
        result?.Message || `Postmark rejected the email (HTTP ${response.status}).`,
    };
  }

  return {
    skipped: false,
    provider: "postmark",
    providerMessageId: result.MessageID,
  };
}

// Normalized result shape from either path:
//   success -> { skipped: false, provider, providerMessageId }
//   failure -> { skipped: true, reason }
export async function sendTransactionalEmail({ from, to, replyTo, subject, html, text }) {
  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();

  if (provider === "postmark") {
    return sendViaPostmark({ from, to, replyTo, subject, html, text });
  }

  if (provider !== "resend") {
    // Unknown value in EMAIL_PROVIDER (typo, leftover from testing, etc) —
    // fail loudly instead of silently guessing which provider was meant.
    return {
      skipped: true,
      reason: `Unknown EMAIL_PROVIDER "${provider}" — expected "resend" or "postmark".`,
    };
  }

  return sendViaResend({ from, to, replyTo, subject, html, text });
}
