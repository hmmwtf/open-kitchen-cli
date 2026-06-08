export function timestampForId(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function isoNow(): string {
  return new Date().toISOString();
}
