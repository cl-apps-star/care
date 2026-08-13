import { loadRequestPageData, runRequestAction } from "../care-request.server";
import { getCareInviteByToken } from "../care.server";

// Public, unauthenticated route — the PERSONALIZED "start your request"
// link sent from the merchant dashboard (see app.cases._index.jsx's
// send_request_email intent), prefilled with the customer/order/item the
// merchant already told us. Clean path, no query string on purpose: the
// old version of this link carried the prefill as a query string (first
// readable params, then one opaque encoded param) and BOTH versions were
// enough to get the invite email collapsed behind a "•••" toggle in Gmail
// — every other Care email links to a clean path-only URL and never had
// the problem, so this route reads the prefill from a stored CareInvite
// (see that model in schema.prisma) instead of the URL at all.
//
// Reuses the exact same page component and action logic as the generic
// care.request.jsx route (`/care/request?shop=...`) — this file only
// differs in how it figures out `shop` and `prefill`.
export const loader = async ({ params }) => {
  const invite = await getCareInviteByToken(params.token);
  // TEMP diagnostic — a real invite is coming back as "This link is
  // missing some information" (loadRequestPageData's missing_shop branch),
  // which only happens if `shop` itself is falsy. Logging the raw invite
  // shape to find out whether `invite.merchant` is missing entirely or
  // just its `shop` field, since either points to a different bug.
  console.log(
    `[CARE] token loader — token=${params.token} invite=${invite ? "found" : "NULL"} merchant=${invite?.merchant ? JSON.stringify({ id: invite.merchant.id, shop: invite.merchant.shop }) : "MISSING"}`,
  );
  if (!invite) {
    return { error: "not_found" };
  }
  return loadRequestPageData({
    shop: invite.merchant.shop,
    actionUrl: `/care/request/${params.token}`,
    prefillEmail: invite.customerEmail,
    prefillOrder: invite.orderNumber,
    prefillName: invite.customerName,
    prefillProductTitle: invite.productTitle,
  });
};

export const action = async ({ request, params }) => {
  const invite = await getCareInviteByToken(params.token);
  if (!invite) throw new Response("Not found", { status: 404 });
  const formData = await request.formData();
  return runRequestAction({ shop: invite.merchant.shop, formData });
};

export { default } from "./care.request";
