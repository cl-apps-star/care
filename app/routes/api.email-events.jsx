import { authorisedEmailWebhook, applyPostmarkEvent } from "../emailDelivery.server";
export async function action({ request }) {
  if (!authorisedEmailWebhook(request)) return new Response("Unauthorized", { status: 401 });
  let event;
  try {
    const body = await request.text();
    if (body.length > 65536) return new Response("Too large", { status: 413 });
    event = JSON.parse(body);
  } catch { return new Response("Invalid JSON", { status: 400 }); }
  const result = await applyPostmarkEvent(event);
  return Response.json(result, { status: result.invalid ? 400 : 200 });
}
export function loader() { return new Response("Not found", { status: 404 }); }
