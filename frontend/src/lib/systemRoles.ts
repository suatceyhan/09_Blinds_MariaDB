const RESERVED = new Set(['superadmin', 'admin', 'user'])

export function isReservedSystemRoleName(name: string): boolean {
  return RESERVED.has(name.trim().toLowerCase())
}
