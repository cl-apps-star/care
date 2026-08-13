// Plan constants — kept in a plain (non-`.server`) file, same convention as
// the rest of the suite (see Digital Unboxing & COA Kit's planConstants.js),
// because a page needs some of these values for *display* (not just
// server-side checks), and files ending in `.server.js` are stripped out of
// the browser bundle entirely by React Router.
//
// Care launches with two tiers — Free and Studio — deliberately simpler
// than Digital Unboxing's three (Free/Studio/Atelier). A single paid tier
// avoids the upgrade/downgrade-between-paid-plans logic that caused
// Digital Unboxing's actual Shopify rejection (1.2.3) on its first
// submission — safer for a first review. Atelier/Established tiers can be
// added later the same way Digital Unboxing added its second paid tier
// after launch.
//
// Pricing set 2026-08-11 after a competitor pass on comparable Shopify
// repair/service-tracking apps: RepairTracker (closest feature match —
// quotes, tracking, draft-order payment) prices its Pro tier at $29/mo;
// Unified Repairs Support undercuts at $14.99/mo with a lighter feature
// set. $19/mo was chosen to sit between the two — priced above the
// bare-bones competitor but below the most feature-comparable one, since
// Care is a newer, unreviewed app without their install/review history
// yet. Free tier cap matches Digital Unboxing & COA Kit's FREE_CERTIFICATE_LIMIT
// (5) rather than In the Making's FREE_JOURNEY_LIMIT (10), per Candice's call.
// Also matches the Partner Dashboard's manual pricing entry for the
// listing (studio-plan: $19/month or $199/year) — that entry does NOT
// sync from this file and must be kept in sync by hand if this changes.

export const FREE_CASE_LIMIT = 5; // real cases created per month, not invites sent

export const STUDIO_PLAN = "Studio plan";
export const STUDIO_PLAN_PRICE = 19; // USD/month

// No trialDays — the 5 free cases a month already serve as the trial, same
// reasoning used for Digital Unboxing's Studio/Atelier and In the Making's
// Starter/Growth plans.
