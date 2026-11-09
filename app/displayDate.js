// Match server and browser rendering even when their local timezones differ.
export function displayCareDate(value, withTime = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value)) + (withTime ? " UTC" : "");
}
