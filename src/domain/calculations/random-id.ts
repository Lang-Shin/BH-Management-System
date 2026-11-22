/** Random IDs work in browsers and Workers without depending on DOM or Node declarations. */
export function randomSuffix(): string {
  const modern = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
  return modern?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
