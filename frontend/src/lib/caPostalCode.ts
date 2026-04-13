export function normalizeCaPostalCode(raw: string): string {
  const s = raw.trim().toUpperCase().replaceAll(/\s+/g, '')
  if (s.length !== 6) return raw.trim().toUpperCase()
  return `${s.slice(0, 3)} ${s.slice(3)}`
}

export function isValidCaPostalCode(raw: string): boolean {
  const s = raw.trim().toUpperCase()
  if (!s) return true
  // Canada: A1A 1A1 (space optional)
  return /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(s)
}

