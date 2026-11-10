export function localize(value, locale = "en", fallbacks = ["en"]) {
  if (value == null) return "";
  if (typeof value === "string") return value;

  if (value[locale]) return value[locale];

  for (const fb of fallbacks) {
    if (value[fb]) return value[fb];
  }

  const firstKey = Object.keys(value)[0];
  return firstKey ? value[firstKey] : "";
}
