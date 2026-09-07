// Network transport only. Application senders use emailProviders.server to record first.
async function sendViaResend({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "RESEND_API_KEY not set." };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from,
    to,
    replyTo,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject,
    html,
    text,
    tags: metadata ? [{ name: "emailRecordId", value: metadata.emailRecordId }] : undefined,
  });

  if (error) {
    return {
      skipped: true,
      status: !error.statusCode || error.statusCode >= 500 ? "unknown" : "failed",
      reason: error.message || "Resend acceptance could not be confirmed.",
    };
  }

  if (!data?.id) {
    return { skipped: true, status: "unknown", reason: "Email acceptance could not be confirmed. Check the provider before sending again." };
  }
  return { skipped: false, provider: "resend", providerMessageId: data.id };
}

async function sendViaPostmark({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  if (!process.env.POSTMARK_API_KEY) {
    return { skipped: true, reason: "POSTMARK_API_KEY not set." };
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_API_KEY,
    },
    body: JSON.stringify({
      From: from,
      To: Array.isArray(to) ? to.join(",") : to,
      ReplyTo: replyTo,
      ...(cc ? { Cc: Array.isArray(cc) ? cc.join(",") : cc } : {}),
      ...(bcc ? { Bcc: Array.isArray(bcc) ? bcc.join(",") : bcc } : {}),
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      Metadata: metadata,
      // Postmark keeps transactional mail on its own reputation track,
      // separate from broadcast/marketing sends — this must be a
      // "Transactional" stream (default server stream ID is "outbound").
      // Overridable via env in case the Postmark server is set up with a
      // differently-named stream.
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
    }),
  });

  const result = await response.json().catch(() => null);

  if (response.status >= 500 || !result) {
    return { skipped: true, status: "unknown", reason: "Postmark acceptance is unconfirmed. Check the provider before sending again." };
  }

  if (!response.ok || result.ErrorCode) {
    return {
      skipped: true,
      reason:
        result?.Message || `Postmark rejected the email (HTTP ${response.status}).`,
    };
  }

  if (!result.MessageID) {
    return { skipped: true, status: "unknown", reason: "Email acceptance could not be confirmed. Check the provider before sending again." };
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
export async function sendTransactionalEmail({ from, to, replyTo, cc, bcc, subject, html, text, metadata, provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase() }) {

  if (provider === "postmark") {
    try {
      return await sendViaPostmark({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The connection to Postmark was interrupted; the email may have been accepted. Check with support before sending again." };
    }
  }

  if (provider !== "resend") {
    // Unknown value in EMAIL_PROVIDER (typo, leftover from testing, etc) —
    // fail loudly instead of silently guessing which provider was meant.
    return {
      skipped: true,
      reason: `Unknown EMAIL_PROVIDER "${provider}" — expected "resend" or "postmark".`,
    };
  }

  try {
    return await sendViaResend({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
  } catch {
    return { skipped: true, status: "unknown", reason: "The connection to Resend was interrupted; the email may have been accepted. Check with support before sending again." };
  }
}
