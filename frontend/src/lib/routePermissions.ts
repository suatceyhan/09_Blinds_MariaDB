import { appPages, type PageConfig } from '@/config/appPages'

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
