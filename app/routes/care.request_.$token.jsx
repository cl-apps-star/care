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
//
// IMPORTANT: the filename has a trailing underscore after "request" —
// `care.request_.$token.jsx`, not `care.request.$token.jsx`. That
// underscore is React Router's flat-routes "opt out of nesting" escape.
// Without it, a file named `care.request.$token.jsx` shares the
// `care.request` prefix with `care.request.jsx` and gets auto-nested
// as ITS CHILD — both loaders run (this one included), but only the
// parent's component actually renders, since care.request.jsx's
// component has no <Outlet/> to descend into the child. The result: a
// real invite would resolve correctly in this loader (confirmed live via
// a temporary diagnostic log), and the page would still show
// care.request.jsx's own "This link is missing some information" error
// (its loader has no ?shop= to read, since none of this route's actual
// data ever reached the screen). The underscore makes this route an
// independent sibling instead — its own match, own render, no shared
// parent — which is what every other route in this app already is.
export const loader = async ({ params }) => {
  const invite = await getCareInviteByToken(params.token);
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
