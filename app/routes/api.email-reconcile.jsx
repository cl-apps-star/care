import { authorisedEmailWebhook } from "../emailDelivery.server";
import { reconcileEmailMessages } from "../emailReconciliation.server";
export async function action({ request }) {
  if (!authorisedEmailWebhook(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await reconcileEmailMessages());
}
export function loader() { return new Response("Not found", { status: 404 }); }
