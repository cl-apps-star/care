// Plain (non-.server) module so client-rendered components can import the
// stage list without pulling in server-only code - same split pattern
// In the Making uses for app/stages.js.

export const DEFAULT_CARE_STAGES = [
  { key: "request_received", label: "Request received" },
  { key: "awaiting_item", label: "Awaiting item" },
  { key: "item_received", label: "Item received" },
  { key: "assessment", label: "Assessment" },
  { key: "quote_sent", label: "Quote sent" },
  { key: "approved", label: "Approved" },
  { key: "in_service", label: "In service" },
  { key: "quality_check", label: "Quality check" },
  { key: "ready_to_return", label: "Ready to return" },
  { key: "completed", label: "Completed" },
  ];
export const STAGES = DEFAULT_CARE_STAGES;

// Terminal / negative status, reachable from quote_sent if the customer
// declines rather than approves.
export const DECLINED_STAGE = { key: "declined", label: "Declined" };

export function stageIndex(statusKey) {
    return DEFAULT_CARE_STAGES.findIndex((s) => s.key === statusKey);
}

export function stageLabel(statusKey) {
    if (statusKey === DECLINED_STAGE.key) return DECLINED_STAGE.label;
    return DEFAULT_CARE_STAGES.find((s) => s.key === statusKey)?.label ?? statusKey;
}

export function nextStage(statusKey) {
    const idx = stageIndex(statusKey);
    if (idx === -1 || idx === DEFAULT_CARE_STAGES.length - 1) return null;
    return DEFAULT_CARE_STAGES[idx + 1];
}

export function isTerminal(statusKey) {
    return statusKey === "completed" || statusKey === DECLINED_STAGE.key;
}

// Shared between the case detail page and the cases list, so a stage reads
// the same way (same color, same "is this on me or the customer" signal)
// everywhere it shows up in the app, not just wherever it happens to be
// styled.
export function statusTone(statusKey) {
  switch (statusKey) {
    case "approved":
    case "completed":
      return "success";
    case "quote_sent":
      return "attention";
    case DECLINED_STAGE.key:
      return "critical";
    default:
      return "info";
  }
}

// True for any stage where the ball is in the MERCHANT's court — used to
// sort/flag cases on the list page so the ones actually waiting on the
// merchant surface first, instead of being buried among cases that are
// simply waiting on the customer or already moving along fine.
export function needsMerchantAction(careCase) {
  switch (careCase.status) {
    case "request_received":
    case "item_received":
    case "assessment":
    case "ready_to_return":
      return true;
    case "approved":
      // Approved-and-unpaid still needs the merchant to actually start the
      // work; approved-and-paid is arguably still "start the work" too, so
      // treat both as needing action until it's moved past "approved".
      return true;
    default:
      return false;
  }
}
