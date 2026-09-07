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
    ...(metadata?.emailRecordId ? [foldHeader("X-CL-Email-Record-ID", headerText(metadata.emailRecordId))] : []),
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
    await session.send(`${body.replace(/^\./gm, "..")}\r\n.`);
    await session.send("QUIT", [221, 250]).catch(() => null);
  } finally {
    session.close();
  }
  return { skipped: false, provider: "smtp", providerMessageId: messageId.replace(/[<>]/g, "") };
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

// Normalized result shape from any path:
//   success -> { skipped: false, provider, providerMessageId }
//   failure -> { skipped: true, reason }
export async function sendTransactionalEmail({ from, to, replyTo, cc, bcc, subject, html, text, metadata, provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase() }) {

  if (provider === "smtp") {
    try {
      return await sendViaSmtp({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
    } catch {
      return { skipped: true, status: "unknown", reason: "The SMTP sender was interrupted; the email may have been accepted. Check the sending mailbox or relay logs before sending again." };
    }
  }

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
      reason: `Unknown EMAIL_PROVIDER "${provider}" — expected "resend", "postmark" or "smtp".`,
    };
  }

  try {
    return await sendViaResend({ from, to, replyTo, cc, bcc, subject, html, text, metadata });
  } catch {
    return { skipped: true, status: "unknown", reason: "The connection to Resend was interrupted; the email may have been accepted. Check with support before sending again." };
  }
}
