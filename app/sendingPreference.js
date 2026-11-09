// Preserve legacy installations; new profiles explicitly store false.
export const customerEmailEnabled = merchant => merchant?.automaticEmail !== false;
export const submittedSendingPreference = form => form.get("emailPreferenceReviewed") === "1" ? { automaticEmail: form.get("automaticEmail") === "on" } : {};
