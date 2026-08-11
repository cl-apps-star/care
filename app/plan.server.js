import prisma from "./db.server";
import { FREE_CASE_LIMIT } from "./planConstants";

// Calendar-month rolling window — same simple reset rule used elsewhere in
// the suite (a period "expires" the moment the UTC month changes, not
// exactly 30/31 days after it started).
function isNewPeriod(periodStart) {
  if (!periodStart) return true;
  const now = new Date();
  return (
    now.getUTCFullYear() !== periodStart.getUTCFullYear() ||
    now.getUTCMonth() !== periodStart.getUTCMonth()
  );
}

// Used by the Billing page to show "X of 3 free cases used this month" (or
// just the running count on Studio, which has no cap).
export async function getPlanSummary(shop) {
  const merchant = await prisma.merchantProfile.findUnique({ where: { shop } });
  if (!merchant) return { plan: "free", count: 0 };
  const count = isNewPeriod(merchant.casePeriodStart) ? 0 : merchant.casePeriodCount || 0;
  return { plan: merchant.plan || "free", count };
}

// Called at the moment a case is actually created — i.e. when the customer
// submits the public request form (care.request.jsx's submit_request
// action), not when the merchant sends an invite. A merchant can send as
// many invites as they like; only real submissions count toward the free
// plan's monthly allowance. Studio is unlimited but the count is still
// tracked for the merchant's own visibility on the Billing page.
export async function checkAndIncrementCaseCount(merchantId) {
  const merchant = await prisma.merchantProfile.findUnique({ where: { id: merchantId } });
  if (!merchant) return { allowed: true, count: 0 };

  const newPeriod = isNewPeriod(merchant.casePeriodStart);
  const currentCount = newPeriod ? 0 : merchant.casePeriodCount || 0;
  const plan = merchant.plan || "free";

  if (plan === "free" && currentCount >= FREE_CASE_LIMIT) {
    return { allowed: false, count: currentCount, limit: FREE_CASE_LIMIT };
  }

  await prisma.merchantProfile.update({
    where: { id: merchantId },
    data: newPeriod
      ? { casePeriodCount: 1, casePeriodStart: new Date() }
      : { casePeriodCount: { increment: 1 } },
  });

  return { allowed: true, count: currentCount + 1, limit: plan === "free" ? FREE_CASE_LIMIT : null };
}
