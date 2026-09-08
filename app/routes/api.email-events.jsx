import { authorisedEmailWebhook, applyProviderEvent } from "../emailDelivery.server";

function parseWebhookBody(body) {
  try {
    return JSON.parse(body);
  } catch (jsonError) {
    const lines = String(body || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length <= 1) throw jsonError;
    return lines.map(line => JSON.parse(line));
  }
}

export async function action({ request }) {
  if (!authorisedEmailWebhook(request)) return new Response("Unauthorized", { status: 401 });
  let event;
  try {
    const body = await request.text();
    if (body.length > 65536) return new Response("Too large", { status: 413 });
    event = parseWebhookBody(body);
  } catch { return new Response("Invalid JSON", { status: 400 }); }
  const provider = new URL(request.url).searchParams.get("provider") || "postmark";
  const events = Array.isArray(event?.events) ? event.events : (Array.isArray(event) ? event : [event]);
  const results = [];
  for (const item of events) results.push(await applyProviderEvent(item, provider));
  const result = results.length === 1 ? results[0] : {
    processed: results.filter(item => item.processed).length,
    ignored: results.filter(item => item.ignored).length,
    invalid: results.filter(item => item.invalid).length,
    duplicate: results.filter(item => item.duplicate).length,
  };
  return Response.json(result, { status: result.invalid ? 400 : 200 });
}
export function loader() { return new Response("Not found", { status: 404 }); }
