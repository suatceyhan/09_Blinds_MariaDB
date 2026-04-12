import type { PageConfig } from '@/config/appPages'

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

function turnOnAncestorsIncludingEdit(
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
    if (parentPage.permissions.edit) updated[parentPage.permissions.edit] = true
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
): Record<string, boolean> {
  const updated = { ...prev }
  const isViewPermission = permKey.endsWith('.view')
  const isEditPermission = permKey.endsWith('.edit')

  if (value) {
    if (allKeys != null && allKeys.length > 0) {
      allKeys.forEach((key) => {
        updated[key] = true
      })
    } else {
      updated[permKey] = true
    }
    if (isViewPermission) {
      const currentPage = pages.find((p) => p.permissions.view === permKey)
      turnOnAncestors(currentPage, pages, updated)
    } else if (isEditPermission) {
      const currentPage = pages.find((p) => p.permissions.edit === permKey)
      turnOnAncestorsIncludingEdit(currentPage, pages, updated)
    }
  } else if (allKeys != null && allKeys.length > 1) {
    allKeys.forEach((key) => {
      updated[key] = false
    })
    /* OFF toplu: yalnızca listedeki anahtarlar; üst menülere dokunma */
  } else {
    updated[permKey] = false
    if (isViewPermission) {
      const currentPage = pages.find((p) => p.permissions.view === permKey)
      const editKey = permKey.replace('.view', '.edit')
      updated[editKey] = false
      if (currentPage) {
        getAllChildKeys(pages, currentPage.id).forEach(({ view, edit }) => {
          updated[view] = false
          updated[edit] = false
        })
      }
    } else if (isEditPermission) {
      const currentPage = pages.find((p) => p.permissions.edit === permKey)
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
