import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

// Network transport only. Application senders use emailProviders.server to record first.
function address(value) {
  const raw = String(value || "").trim();
  return (raw.match(/<([^<>]+)>/)?.[1] || raw).trim();
}

function addressList(value) {
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map(address)
    .filter(Boolean);
}

const DEFAULT_CONSUMER_FALLBACK_DOMAINS = [
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "outlook.co.uk",
  "hotmail.co.uk",
  "live.co.uk",
  "yahoo.co.uk",
];

function normaliseProvider(value) {
  return String(value || "").trim().toLowerCase();
}

function parseDomainList(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function domainMatches(domain, pattern) {
  const candidate = String(domain || "").toLowerCase();
  const rule = String(pattern || "").toLowerCase();
  if (!candidate || !rule) return false;
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1);
    return candidate.endsWith(suffix) || candidate === rule.slice(2);
  }
  return candidate === rule;
}

function recipientDomains(...values) {
  return [...new Set(values
    .flatMap(addressList)
    .map(item => item.split("@").pop()?.toLowerCase())
    .filter(Boolean))];
}

function providerForRecipients(defaultProvider, { to, cc, bcc }) {
  const provider = normaliseProvider(defaultProvider || process.env.EMAIL_PROVIDER || "resend");
  const fallbackProvider = normaliseProvider(process.env.EMAIL_PROVIDER_CONSUMER_FALLBACK);
  if (!fallbackProvider) return provider;

  const fallbackDomains = parseDomainList(process.env.EMAIL_PROVIDER_CONSUMER_FALLBACK_DOMAINS);
  const domainsToCheck = fallbackDomains.length ? fallbackDomains : DEFAULT_CONSUMER_FALLBACK_DOMAINS;
  const domains = recipientDomains(to, cc, bcc);
  return domains.some(domain => domainsToCheck.some(pattern => domainMatches(domain, pattern)))
    ? fallbackProvider
    : provider;
}

function headerAddress(value) {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}

function displayName(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(.+?)\s*<[^<>]+>\s*$/);
  return (match?.[1] || "").replace(/[<>"\r\n]/g, "").trim();
}

function serviceFromName(fromName, serviceName) {
  const source = headerText(fromName);
  const service = headerText(serviceName || "CL Apps");
  if (!source || source.toLowerCase() === service.toLowerCase()) return service;
  if (source.toLowerCase().includes(` via ${service.toLowerCase()}`)) return source;
  return `${source} via ${service}`;
}

function deliveryFromAddress(from, options = {}) {
  const override = address(
    options.fromAddress ||
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.TRANSACTIONAL_FROM_ADDRESS,
  );
  if (!override) return from;
  const name = serviceFromName(
    displayName(from),
    options.fromName ||
    process.env.EMAIL_FROM_NAME ||
    process.env.TRANSACTIONAL_FROM_NAME ||
    "CL Apps",
  );
  return `${name} <${override}>`;
}

function smtpFromAddress(from, config) {
  return deliveryFromAddress(from, {
    fromAddress: config.fromAddress,
    fromName: config.fromName,
  });
}

function headerText(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function foldHeader(name, value) {
  const line = `${name}: ${value}`;
  if (line.length <= 998) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 990));
    rest = rest.slice(990);
  }
  return chunks.join("\r\n ");
}

function quotedPrintable(value) {
  const encoded = String(value || "")
    .replace(/\r\n|\r|\n/g, "\r\n")
    .replace(/[^\t\r\n -<>-~]/g, ch => Buffer.from(ch).toString("hex").toUpperCase().replace(/(..)/g, "=$1"))
    .replace(/[ \t]+$/gm, match => match.replace(/[ \t]/g, ch => `=${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .replace(/^From /gm, "=46rom ");
  return encoded.split("\r\n").map(line => {
    const chunks = [];
    let rest = line;
    while (rest.length > 76) {
      let size = 75;
      while (size > 0 && rest[size - 1] === "=") size -= 1;
      while (size > 0 && /=[0-9A-F]?$/.test(rest.slice(0, size))) size -= 1;
      chunks.push(`${rest.slice(0, size)}=`);
      rest = rest.slice(size);
    }
    chunks.push(rest);
    return chunks.join("\r\n");
  }).join("\r\n");
}

function buildMimeMessage({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  const messageId = `<${randomUUID()}@cl-apps.net>`;
  const boundary = `cl-apps-${randomUUID()}`;
  const headers = [
    foldHeader("From", headerAddress(from)),
    foldHeader("To", addressList(to).join(", ")),
    ...(cc ? [foldHeader("Cc", addressList(cc).join(", "))] : []),
    ...(replyTo ? [foldHeader("Reply-To", headerAddress(replyTo))] : []),
    foldHeader("Subject", headerText(subject)),
    foldHeader("Message-ID", messageId),
    foldHeader("Date", new Date().toUTCString()),
    foldHeader("MIME-Version", "1.0"),
    ...(metadata?.emailRecordId ? [
      foldHeader("X-CL-Email-Record-ID", headerText(metadata.emailRecordId)),
      foldHeader("X-Mailin-custom", `emailRecordId=${headerText(metadata.emailRecordId)}`),
    ] : []),
  ];

  if (html && text) {
    headers.push(foldHeader("Content-Type", `multipart/alternative; boundary="${boundary}"`));
    return {
      messageId,
      body: [
        ...headers,
        "",
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        quotedPrintable(text),
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        quotedPrintable(html),
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    };
  }

  headers.push(foldHeader("Content-Type", html ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"'));
  headers.push(foldHeader("Content-Transfer-Encoding", "quoted-printable"));
  return { messageId, body: [...headers, "", quotedPrintable(html || text || ""), ""].join("\r\n") };
}

function smtpProviderMessageId(localMessageId, response) {
  const cleaned = headerText(response).replace(/\s+/g, " ");
  const match = cleaned.match(/\b(?:queued(?:\s+as)?|message[- ]?id|id)[:\s<]+([A-Za-z0-9._@+-]{6,})>?/i);
  return match?.[1] || localMessageId.replace(/[<>]/g, "");
}

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  return {
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTls: String(process.env.SMTP_REQUIRE_TLS || "true").toLowerCase() !== "false",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    envelopeFrom: process.env.SMTP_ENVELOPE_FROM,
    fromAddress: process.env.SMTP_FROM_ADDRESS,
    fromName: process.env.SMTP_FROM_NAME,
    ehloDomain: process.env.SMTP_EHLO_DOMAIN || "cl-apps.net",
  };
}

async function createSmtpSession(config) {
  let socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  socket.setTimeout(20000);
  socket.setEncoding("utf8");

  let buffer = "";
  const waitForResponse = () => new Promise((resolve, reject) => {
    const onData = chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        const response = lines.join("\n");
        buffer = "";
        resolve(response);
      }
    };
    const onError = error => { cleanup(); reject(error); };
    const onTimeout = () => { cleanup(); reject(new Error("SMTP connection timed out.")); };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
  const send = async (command, ok = [250]) => {
    socket.write(`${command}\r\n`);
    const response = await waitForResponse();
    const code = Number(response.slice(0, 3));
    if (!ok.includes(code)) throw new Error(`SMTP command failed (${code}).`);
    return response;
  };

  await waitForResponse();
  let ehlo = await send(`EHLO ${config.ehloDomain}`);
  if (!config.secure && /\bSTARTTLS\b/i.test(ehlo)) {
    await send("STARTTLS", [220]);
    socket = tls.connect({ socket, servername: config.host });
    socket.setTimeout(20000);
    socket.setEncoding("utf8");
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    ehlo = await send(`EHLO ${config.ehloDomain}`);
  } else if (!config.secure && config.requireTls) {
    throw new Error("SMTP server did not advertise STARTTLS.");
  }
  if (config.user && config.password) {
    const token = Buffer.from(`\0${config.user}\0${config.password}`).toString("base64");
    await send(`AUTH PLAIN ${token}`, [235]);
  }
  return { send, close: () => socket.end() };
}

async function sendViaSmtp({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  const config = smtpConfig();
  if (!config.host) {
    return { skipped: true, reason: "SMTP_HOST not set." };
  }

  const fromHeader = smtpFromAddress(from, config);
  const envelopeFrom = address(config.envelopeFrom || fromHeader);
  const recipients = [...new Set([...addressList(to), ...addressList(cc), ...addressList(bcc)])];
  if (!envelopeFrom || !recipients.length) {
    return { skipped: true, status: "failed", reason: "SMTP sender or recipient is missing." };
  }

  const { messageId, body } = buildMimeMessage({ from: fromHeader, to, replyTo, cc, bcc, subject, html, text, metadata });
  const session = await createSmtpSession(config);
  try {
    await session.send(`MAIL FROM:<${envelopeFrom}>`);
    for (const recipient of recipients) await session.send(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.send("DATA", [354]);
    const dataResponse = await session.send(`${body.replace(/^\./gm, "..")}\r\n.`);
    await session.send("QUIT", [221, 250]).catch(() => null);
    return { skipped: false, provider: "smtp", providerMessageId: smtpProviderMessageId(messageId, dataResponse) };
  } finally {
    session.close();
  }
}

async function sendViaResend({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "RESEND_API_KEY not set." };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from: deliveryFromAddress(from),
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
      From: deliveryFromAddress(from),
      To: Array.isArray(to) ? to.join(",") : to,
      ReplyTo: replyTo,
      ...(cc ? { Cc: Array.isArray(cc) ? cc.join(",") : cc } : {}),
      ...(bcc ? { Bcc: Array.isArray(bcc) ? bcc.join(",") : bcc } : {}),
      Subject: subject,
      HtmlBody: html,
      TextBody: text,
      Metadata: metadata,
      // Keep transactional links exactly as the app generated them. Relying on
      // stream defaults can rewrite links through a tracking domain, which is
      // a poor fit for customer status emails and makes placement tests harder
      // to interpret.
      TrackOpens: false,
      TrackLinks: "None",
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

async function sendViaBrevo({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  const apiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  if (!apiKey) {
    return { skipped: true, reason: "BREVO_API_KEY not set." };
  }

  const fromHeader = deliveryFromAddress(from, {
    fromAddress: process.env.BREVO_FROM_ADDRESS || process.env.EMAIL_FROM_ADDRESS || process.env.TRANSACTIONAL_FROM_ADDRESS,
    fromName: process.env.BREVO_FROM_NAME || process.env.EMAIL_FROM_NAME || process.env.TRANSACTIONAL_FROM_NAME || "CL Apps",
  });
  const fromEmail = address(fromHeader);
  const fromName = displayName(fromHeader);
  const replyToEmail = address(replyTo);
  const replyToName = displayName(replyTo);
  const toRecipients = addressList(to).map(email => ({ email }));
  const ccRecipients = addressList(cc).map(email => ({ email }));
  const bccRecipients = addressList(bcc).map(email => ({ email }));

  if (!fromEmail || !toRecipients.length) {
    return { skipped: true, status: "failed", reason: "Brevo sender or recipient is missing." };
  }

  const emailRecordId = headerText(metadata?.emailRecordId);
  const headers = emailRecordId ? {
    "X-Mailin-custom": `emailRecordId=${emailRecordId}`,
    "X-Cl-Email-Record-Id": emailRecordId,
  } : undefined;
  const payload = {
    sender: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
    to: toRecipients,
    ...(ccRecipients.length ? { cc: ccRecipients } : {}),
    ...(bccRecipients.length ? { bcc: bccRecipients } : {}),
    ...(replyToEmail ? { replyTo: { email: replyToEmail, ...(replyToName ? { name: replyToName } : {}) } } : {}),
    subject,
    // Brevo static API accepts one message body type per request. Use SMTP if a Brevo route needs multipart HTML+text.
    ...(html ? { htmlContent: html } : { textContent: text || "" }),
    ...(headers ? { headers } : {}),
    tags: ["customer-notification"],
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => null);
  if (response.status >= 500 || !result) {
    return { skipped: true, status: "unknown", reason: "Brevo acceptance is unconfirmed. Check the provider before sending again." };
  }

  if (!response.ok || result.code) {
    return {
      skipped: true,
      reason: result?.message || result?.code || `Brevo rejected the email (HTTP ${response.status}).`,
    };
  }

  const providerMessageId = Array.isArray(result.messageIds) ? result.messageIds[0] : result.messageId;
  if (!providerMessageId) {
    return { skipped: true, status: "unknown", reason: "Brevo acceptance did not include a message ID. Check the provider before sending again." };
  }

  return { skipped: false, provider: "brevo", providerMessageId: String(providerMessageId).replace(/[<>]/g, "") };
}

async function sendViaMailtrap({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  const token = process.env.MAILTRAP_API_TOKEN || process.env.MAILTRAP_API_KEY;
  if (!token) {
    return { skipped: true, reason: "MAILTRAP_API_TOKEN not set." };
  }

  const fromHeader = deliveryFromAddress(from, {
    fromAddress: process.env.MAILTRAP_FROM_ADDRESS || process.env.EMAIL_FROM_ADDRESS || process.env.TRANSACTIONAL_FROM_ADDRESS,
    fromName: process.env.MAILTRAP_FROM_NAME || process.env.EMAIL_FROM_NAME || process.env.TRANSACTIONAL_FROM_NAME || "CL Apps",
  });
  const fromEmail = address(fromHeader);
  const fromName = displayName(fromHeader);
  const replyToEmail = address(replyTo);
  const replyToName = displayName(replyTo);
  const toRecipients = addressList(to).map(email => ({ email }));
  const ccRecipients = addressList(cc).map(email => ({ email }));
  const bccRecipients = addressList(bcc).map(email => ({ email }));

  if (!fromEmail || !toRecipients.length) {
    return { skipped: true, status: "failed", reason: "Mailtrap sender or recipient is missing." };
  }

  const response = await fetch("https://send.api.mailtrap.io/api/send", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Token": token,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      from: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
      to: toRecipients,
      ...(ccRecipients.length ? { cc: ccRecipients } : {}),
      ...(bccRecipients.length ? { bcc: bccRecipients } : {}),
      ...(replyToEmail ? { reply_to: { email: replyToEmail, ...(replyToName ? { name: replyToName } : {}) } } : {}),
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      category: "customer-notification",
      custom_variables: metadata || undefined,
      headers: metadata?.emailRecordId ? { "X-CL-Email-Record-ID": headerText(metadata.emailRecordId) } : undefined,
    }),
  });

  const result = await response.json().catch(() => null);
  if (response.status >= 500 || !result) {
    return { skipped: true, status: "unknown", reason: "Mailtrap acceptance is unconfirmed. Check the provider before sending again." };
  }

  if (!response.ok || result.success === false) {
    const errors = Array.isArray(result?.errors) ? result.errors.join("; ") : "";
    return {
      skipped: true,
      reason: result?.message || errors || `Mailtrap rejected the email (HTTP ${response.status}).`,
    };
  }

  const providerMessageId = Array.isArray(result.message_ids) ? result.message_ids[0] : result.message_id;
  if (!providerMessageId) {
    return { skipped: true, status: "unknown", reason: "Mailtrap acceptance did not include a message ID. Check the provider before sending again." };
  }

  return { skipped: false, provider: "mailtrap", providerMessageId };
}

async function sendViaMailjet({ from, to, replyTo, cc, bcc, subject, html, text, metadata }) {
  const apiKey = process.env.MAILJET_API_KEY || process.env.MAILJET_API_KEY_PUBLIC;
  const secretKey = process.env.MAILJET_SECRET_KEY || process.env.MAILJET_API_SECRET || process.env.MAILJET_API_KEY_PRIVATE;
  if (!apiKey || !secretKey) {
    return { skipped: true, reason: "MAILJET_API_KEY and MAILJET_SECRET_KEY are required." };
  }

  const fromHeader = deliveryFromAddress(from, {
    fromAddress: process.env.MAILJET_FROM_ADDRESS || process.env.EMAIL_FROM_ADDRESS || process.env.TRANSACTIONAL_FROM_ADDRESS,
    fromName: process.env.MAILJET_FROM_NAME || process.env.EMAIL_FROM_NAME || process.env.TRANSACTIONAL_FROM_NAME || "CL Apps",
  });
  const fromEmail = address(fromHeader);
  const fromName = displayName(fromHeader);
  const replyToEmail = address(replyTo);
  const replyToName = displayName(replyTo);
  const toRecipients = addressList(to).map(email => ({ Email: email }));
  const ccRecipients = addressList(cc).map(email => ({ Email: email }));
  const bccRecipients = addressList(bcc).map(email => ({ Email: email }));

  if (!fromEmail || !toRecipients.length) {
    return { skipped: true, status: "failed", reason: "Mailjet sender or recipient is missing." };
  }

  const emailRecordId = headerText(metadata?.emailRecordId);
  const message = {
    From: { Email: fromEmail, ...(fromName ? { Name: fromName } : {}) },
    To: toRecipients,
    ...(ccRecipients.length ? { Cc: ccRecipients } : {}),
    ...(bccRecipients.length ? { Bcc: bccRecipients } : {}),
    ...(replyToEmail ? { ReplyTo: { Email: replyToEmail, ...(replyToName ? { Name: replyToName } : {}) } } : {}),
    Subject: subject,
    ...(text ? { TextPart: text } : {}),
    ...(html ? { HTMLPart: html } : {}),
    ...(emailRecordId ? { CustomID: emailRecordId, EventPayload: JSON.stringify(metadata || {}) } : {}),
    Headers: emailRecordId ? { "X-CL-Email-Record-ID": emailRecordId } : undefined,
    TrackOpens: "disabled",
    TrackClicks: "disabled",
  };

  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`,
    },
    body: JSON.stringify({ Messages: [message] }),
  });

  const result = await response.json().catch(() => null);
  if (response.status >= 500 || !result) {
    return { skipped: true, status: "unknown", reason: "Mailjet acceptance is unconfirmed. Check the provider before sending again." };
  }

  const sentMessage = Array.isArray(result.Messages) ? result.Messages[0] : null;
  const providerMessage = sentMessage?.To?.[0] || sentMessage?.Cc?.[0] || sentMessage?.Bcc?.[0] || {};
  const providerMessageId = firstText(providerMessage.MessageUUID, providerMessage.MessageID, providerMessage.MessageHref);
  const status = String(sentMessage?.Status || "").toLowerCase();
  if (!response.ok || (status && status !== "success")) {
    const errors = Array.isArray(sentMessage?.Errors)
      ? sentMessage.Errors.map(error => firstText(error.ErrorMessage, error.ErrorRelatedTo, error.StatusCode)).filter(Boolean).join("; ")
      : "";
    return {
      skipped: true,
      reason: errors || firstText(result.ErrorMessage, result.Message, `Mailjet rejected the email (HTTP ${response.status}).`),
    };
  }

  if (!providerMessageId) {
    return { skipped: true, status: "unknown", reason: "Mailjet acceptance did not include a message ID. Check the provider before sending again." };
  }

  return { skipped: false, provider: "mailjet", providerMessageId };
}

// Normalized result shape from any path:
//   success -> { skipped: false, provider, providerMessageId }
//   failure -> { skipped: true, reason }
export async function sendTransactionalEmail({ from, to, replyTo, cc, bcc, subject, html, text, metadata, provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase() }) {
  const selectedProvider = providerForRecipients(provider, { to, cc, bcc });

  if (selectedProvider === "smtp") {
    try {
      return await sendViaSmtp({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The SMTP sender was interrupted; the email may have been accepted. Check the sending mailbox or relay logs before sending again." };
    }
  }

  if (selectedProvider === "postmark") {
    try {
      return await sendViaPostmark({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The connection to Postmark was interrupted; the email may have been accepted. Check with support before sending again." };
    }
  }

  if (selectedProvider === "brevo") {
    try {
      return await sendViaBrevo({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The connection to Brevo was interrupted; the email may have been accepted. Check provider logs before sending again." };
    }
  }

  if (selectedProvider === "mailtrap") {
    try {
      return await sendViaMailtrap({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The connection to Mailtrap was interrupted; the email may have been accepted. Check provider logs before sending again." };
    }
  }

  if (selectedProvider === "mailjet") {
    try {
      return await sendViaMailjet({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The connection to Mailjet was interrupted; the email may have been accepted. Check provider logs before sending again." };
    }
  }

  if (selectedProvider !== "resend") {
    // Unknown value in EMAIL_PROVIDER (typo, leftover from testing, etc) —
    // fail loudly instead of silently guessing which provider was meant.
    return {
      skipped: true,
      reason: `Unknown EMAIL_PROVIDER "${selectedProvider}" — expected "resend", "postmark", "brevo", "mailtrap", "mailjet" or "smtp".`,
    };
  }

  try {
    return await sendViaResend({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
  } catch {
    return { skipped: true, status: "unknown", reason: "The connection to Resend was interrupted; the email may have been accepted. Check with support before sending again." };
  }
}
