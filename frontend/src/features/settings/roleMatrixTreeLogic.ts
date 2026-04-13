import type { PageConfig } from '@/config/appPages'

/** Row that was toggled (nav page id); required when several pages share the same permission key. */
function resolvePageForToggle(
  pages: PageConfig[],
  permKey: string,
  kind: 'view' | 'edit',
  pageId?: string | null,
): PageConfig | undefined {
  if (pageId) return pages.find((p) => p.id === pageId)
  return pages.find((p) => p.permissions[kind] === permKey)
}

export function findParentKey(pages: PageConfig[], permKey: string, type: 'view' | 'edit'): string | null {
  const page = pages.find((p) => p.permissions[type] === permKey)
  const parentPage = pages.find((p) => p.id === page?.parent)
  return parentPage?.permissions[type] ?? null
}

export function findChildKeys(pages: PageConfig[], parentKey: string, type: 'view' | 'edit'): string[] {
  const parentPage = pages.find((p) => p.permissions[type] === parentKey)
  if (!parentPage) return []
  const children = pages.filter((p) => p.parent === parentPage.id)
  return children.map((c) => c.permissions[type])
}

export function getParentPermissionKeys(pages: PageConfig[], permKey: string): { view: string; edit: string }[] {
  const page = pages.find(
    (p) => p.permissions.view === permKey || p.permissions.edit === permKey,
  )
  if (!page) return []
  const parentKeys: { view: string; edit: string }[] = []
  let current: PageConfig | undefined = page
  while (current?.parent) {
    const parentPage = pages.find((p) => p.id === current!.parent)
    if (!parentPage) break
    parentKeys.push({ view: parentPage.permissions.view, edit: parentPage.permissions.edit })
    current = parentPage
  }
  return parentKeys
}

export function getAllChildKeys(pages: PageConfig[], parentId: string): { view: string; edit: string }[] {
  const all: { view: string; edit: string }[] = []
  function collect(currentParentId: string) {
    const directChildren = pages.filter((p) => p.parent === currentParentId)
    directChildren.forEach((child) => {
      all.push({ view: child.permissions.view, edit: child.permissions.edit })
      collect(child.id)
    })
  }
  collect(parentId)
  return all
}

/** Üst zincir: çocuk açılınca menü yolu için ata görünüm (ve gerekirse düz) açılır */
function turnOnAncestors(page: PageConfig | undefined, pages: PageConfig[], updated: Record<string, boolean>) {
  let cur: PageConfig | undefined = page
  for (;;) {
    const parentId = cur?.parent
    if (parentId == null) break
    const parentPage = pages.find((p) => p.id === parentId)
    if (!parentPage) break
    if (parentPage.permissions.view) updated[parentPage.permissions.view] = true
    cur = parentPage
  }
}

/** Granting edit: only ancestor **view** bits (menu path); do not flip parent edit switches. */
function turnOnAncestorViewsForEdit(
  page: PageConfig | undefined,
  pages: PageConfig[],
  updated: Record<string, boolean>,
) {
  let cur: PageConfig | undefined = page
  for (;;) {
    const parentId = cur?.parent
    if (parentId == null) break
    const parentPage = pages.find((p) => p.id === parentId)
    if (!parentPage) break
    if (parentPage.permissions.view) updated[parentPage.permissions.view] = true
    cur = parentPage
  }
}

/** DWP RolePermissionsPage handleToggle — key -> granted map */
export function applyRoleMatrixToggle(
  pages: PageConfig[],
  prev: Record<string, boolean>,
  permKey: string,
  value: boolean,
  allKeys?: string[],
  _type?: 'is_granted' | 'override',
  /** Nav row id from the tree — disambiguates pages that still share a permission key. */
  pageId?: string | null,
): Record<string, boolean> {
  const updated = { ...prev }
  const isViewPermission = permKey.endsWith('.view')
  const isEditPermission = permKey.endsWith('.edit')
  /** True when the UI sent a subtree (parent row), not only the row’s own key (duplicate keys can dedupe to 1). */
  const subtreeFromUi = (allKeys?.length ?? 0) > 1

  if (value) {
    if (allKeys != null && allKeys.length > 0) {
      for (const key of new Set(allKeys)) {
        updated[key] = true
      }
    } else {
      updated[permKey] = true
    }
    if (isViewPermission) {
      const currentPage = resolvePageForToggle(pages, permKey, 'view', pageId)
      turnOnAncestors(currentPage, pages, updated)
    } else if (isEditPermission) {
      const currentPage = resolvePageForToggle(pages, permKey, 'edit', pageId)
      turnOnAncestorViewsForEdit(currentPage, pages, updated)
    }
  } else if (subtreeFromUi && allKeys != null) {
    for (const key of new Set(allKeys)) {
      updated[key] = false
    }
    /* OFF subtree: only keys listed in collectKeys; paired edits handled by role view row handler when needed */
  } else {
    updated[permKey] = false
    if (isViewPermission) {
      const currentPage = resolvePageForToggle(pages, permKey, 'view', pageId)
      const editKey = permKey.replace('.view', '.edit')
      updated[editKey] = false
      if (currentPage) {
        getAllChildKeys(pages, currentPage.id).forEach(({ view, edit }) => {
          updated[view] = false
          updated[edit] = false
        })
      }
    } else if (isEditPermission) {
      const currentPage = resolvePageForToggle(pages, permKey, 'edit', pageId)
      if (currentPage) {
        getAllChildKeys(pages, currentPage.id).forEach(({ edit }) => {
          updated[edit] = false
        })
      }
    }
    /* Üst düğümlere dokunma: yalnızca bu satır + tüm alt ağaç güncellenir */
  }

  return updated
}
