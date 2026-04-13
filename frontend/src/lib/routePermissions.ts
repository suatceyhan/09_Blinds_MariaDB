import { appPages, type PageConfig } from '@/config/appPages'

/** Hub ``/lookups``: any child lookup .view is enough (parent row may stay ``lookups.view`` only). */
export function routeViewAllowed(pathname: string, permissions: string[]): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/'
  if (normalized === '/lookups') {
    if (permissions.includes('lookups.view')) return true
    return appPages.some(
      (p) => p.parent === 'lookups-root' && permissions.includes(p.permissions.view),
    )
  }
  if (normalized.startsWith('/lookups/')) {
    if (permissions.includes('lookups.view')) return true
    const required = pathRequiresViewPermission(pathname)
    return Boolean(required && permissions.includes(required))
  }
  const required = pathRequiresViewPermission(pathname)
  if (!required) return true
  return permissions.includes(required)
}

/** Geçerli path için menü/erişimde kullanılan .view izin anahtarı (en uzun basePath eşlemesi). */
export function pathRequiresViewPermission(pathname: string): string | null {
  const normalized = pathname.replace(/\/$/, '') || '/'
  const pages = appPages
    .filter((p): p is PageConfig & { basePath: string } => Boolean(p.basePath))
    .sort(
      (a, b) =>
        (b.basePath.replace(/\/$/, '') || '/').length -
        (a.basePath.replace(/\/$/, '') || '/').length,
    )

  for (const p of pages) {
    const bp = p.basePath.replace(/\/$/, '') || '/'
    if (normalized === bp || normalized.startsWith(`${bp}/`)) {
      return p.permissions.view
    }
  }
  return null
}

/** İlk görüntülenebilir sayfa (genelde panel); hiç yoksa `/`. */
export function firstNavigableBasePath(permissions: string[]): string {
  for (const p of appPages) {
    if (p.basePath && permissions.includes(p.permissions.view)) {
      return p.basePath.replace(/\/$/, '') || '/'
    }
  }
  return '/'
}
