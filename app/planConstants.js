// Plan constants — kept in a plain (non-`.server`) file, same convention as
// the rest of the suite (see Digital Unboxing & COA Kit's planConstants.js),
// because a page needs some of these values for *display* (not just
// server-side checks), and files ending in `.server.js` are stripped out of
// the browser bundle entirely by React Router.
//
// Care launches with two tiers — Free and Studio — deliberately simpler
// than Digital Unboxing's three (Free/Studio/Atelier). The suite's pricing
// strategy doc targets Free → $29 → $59 → $129 for Care longer-term, but a
// single paid tier avoids the upgrade/downgrade-between-paid-plans logic
// that caused Digital Unboxing's actual Shopify rejection (1.2.3) on its
// first submission — safer for a first review. Atelier/Established tiers
// can be added later the same way Digital Unboxing added its second paid
// tier after launch.

export const FREE_CASE_LIMIT = 3; // real cases created per month, not invites sent

export const STUDIO_PLAN = "Studio plan";
export const STUDIO_PLAN_PRICE = 29; // USD/month

// No trialDays — the 3 free cases a month already serve as the trial, same
// reasoning used for Digital Unboxing's Studio/Atelier and In the Making's
// Starter/Growth plans.
