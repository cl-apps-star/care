import { createHmac, timingSafeEqual } from "node:crypto";

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

function signingSecret() {
  return firstText(process.env.EMAIL_UNSUBSCRIBE_SECRET, process.env.EMAIL_WEBHOOK_SECRET);
}

function publicBaseUrl() {
  const raw = firstText(process.env.EMAIL_UNSUBSCRIBE_BASE_URL, process.env.CUSTOMER_APP_URL, process.env.SHOPIFY_APP_URL);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function emailUnsubscribeToken(emailRecordId) {
  const id = headerText(emailRecordId);
  const secret = signingSecret();
  if (!id || !secret) return "";
  return createHmac("sha256", secret).update(id).digest("hex");
}

export function verifyEmailUnsubscribeToken(emailRecordId, token) {
  const expected = emailUnsubscribeToken(emailRecordId);
  const supplied = headerText(token);
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function unsubscribeUrl(emailRecordId) {
  const id = headerText(emailRecordId);
  const base = publicBaseUrl();
  const token = emailUnsubscribeToken(id);
  if (!id || !base || !token) return "";
  const url = new URL("/api/email-unsubscribe", base);
  url.searchParams.set("message", id);
  url.searchParams.set("token", token);
  return url.toString();
}

function mailtoLink() {
  const raw = firstText(process.env.EMAIL_LIST_UNSUBSCRIBE_MAILTO, process.env.EMAIL_SUPPORT_EMAIL, "hello@cl-apps.net");
  const email = raw.match(/<([^<>]+)>/)?.[1] || raw;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "";
  return `mailto:${email}?subject=Unsubscribe%20customer%20emails`;
}

function helpLink() {
  const raw = firstText(process.env.EMAIL_LIST_HELP_MAILTO, process.env.EMAIL_SUPPORT_EMAIL, "hello@cl-apps.net");
  const email = raw.match(/<([^<>]+)>/)?.[1] || raw;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "";
  return `mailto:${email}?subject=Customer%20email%20help`;
}

export function emailHeaderPairs(metadata = {}) {
  const url = unsubscribeUrl(metadata.emailRecordId);
  if (!url) return [];
  const mailto = mailtoLink();
  const help = helpLink();
  return [
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    {
      name: "List-Unsubscribe",
      value: [`<${url}>`, mailto ? `<${mailto}>` : ""].filter(Boolean).join(", "),
    },
    ...(help ? [{ name: "List-Help", value: `<${help}>` }] : []),
  ];
}

export function emailHeadersObject(metadata = {}) {
  const entries = emailHeaderPairs(metadata);
  return entries.length ? Object.fromEntries(entries.map(({ name, value }) => [name, value])) : undefined;
}
