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
