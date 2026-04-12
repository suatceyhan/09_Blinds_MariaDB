import type { PageConfig } from '@/config/appPages'
import {
  getAllChildKeys,
  getParentPermissionKeys,
} from '@/features/settings/roleMatrixTreeLogic'

export type PermissionRow = {
  permission_key: string
  permission_name: string
  category: string
  role_is_granted: boolean
  user_is_granted: boolean
  user_override: boolean
  permission_id: string
}

/** Modül (view+edit) için Özel bayrağı: ikisinden biri açıksa ikisi de açık kabul edilir. */
function alignModuleOverrideFlags(updated: PermissionRow[], viewKey: string) {
  const editKey = viewKey.replace('.view', '.edit')
  const vr = updated.find((r) => r.permission_key === viewKey)
  const er = updated.find((r) => r.permission_key === editKey)
  if (!vr || !er) return
  const merged = vr.user_override || er.user_override
  vr.user_override = merged
  er.user_override = merged
}

/** View satırındaki Özel bayrağına göre edit satırını eşler (ör. görüntüleme kapatılınca). */
function syncEditOverrideWithView(updated: PermissionRow[], viewKey: string) {
  const editKey = viewKey.replace('.view', '.edit')
  const vr = updated.find((r) => r.permission_key === viewKey)
  const er = updated.find((r) => r.permission_key === editKey)
  if (vr && er) {
    er.user_override = vr.user_override
  }
}

function cleanupParentOverridesRecursive(pages: PageConfig[], updated: PermissionRow[], permKey: string) {
  const parentChain = getParentPermissionKeys(pages, permKey)
  for (const parent of parentChain) {
    const parentPage = pages.find(
      (p) => p.permissions.view === parent.view || p.permissions.edit === parent.edit,
    )
    if (!parentPage) continue
    const children = pages.filter((p) => p.parent === parentPage.id)
    const anyChildOpen = children.some((child) => {
      const childViewRow = updated.find((r) => r.permission_key === child.permissions.view)
      const childEditRow = updated.find((r) => r.permission_key === child.permissions.edit)
      return (
        (childViewRow && (childViewRow.user_is_granted || childViewRow.user_override)) ||
        (childEditRow && (childEditRow.user_is_granted || childEditRow.user_override))
      )
    })
    if (!anyChildOpen) {
      const parentViewRow = updated.find((r) => r.permission_key === parent.view)
      const parentEditRow = updated.find((r) => r.permission_key === parent.edit)
      if (parentViewRow) {
        parentViewRow.user_is_granted = false
        parentViewRow.user_override = parentViewRow.role_is_granted
      }
      if (parentEditRow && parentViewRow) {
        parentEditRow.user_is_granted = false
        parentEditRow.user_override = parentViewRow.user_override
      }
      cleanupParentOverridesRecursive(pages, updated, parent.view)
    } else {
      break
    }
  }
}

/** API'den tek tarafta override gelmiş modüllerde Özel'i çift satırda tutar (Kayıt tutarlılığı). */
export function normalizeModuleOverrideRows(pages: PageConfig[], rows: PermissionRow[]): PermissionRow[] {
  const copy = rows.map((r) => ({ ...r }))
  for (const p of pages) {
    if (!p.basePath) continue
    const vr = copy.find((r) => r.permission_key === p.permissions.view)
    const er = copy.find((r) => r.permission_key === p.permissions.edit)
    if (!vr || !er) continue
    if (vr.user_override || er.user_override) {
      vr.user_override = true
      er.user_override = true
    }
  }
  return copy
}

export function applyUserPermissionToggle(
  pages: PageConfig[],
  permissionRows: PermissionRow[],
  permKey: string,
  value: boolean,
  type?: 'is_granted' | 'override',
): PermissionRow[] {
  if (!type) return permissionRows
  let updated = permissionRows.map((r) => ({ ...r }))

  if (type === 'override') {
    if (value) {
      const isViewInit = permKey.endsWith('.view')
      const pairKeys = isViewInit
        ? [permKey, permKey.replace('.view', '.edit')]
        : [permKey.replace('.edit', '.view'), permKey]
      updated = updated.map((r) =>
        pairKeys.includes(r.permission_key)
          ? {
              ...r,
              user_override: true,
              user_is_granted: true,
            }
          : r,
      )
    } else {
      const isView = permKey.endsWith('.view')
      const isEdit = permKey.endsWith('.edit')
      if (isView) {
        const editKey = permKey.replace('.view', '.edit')
        updated = updated.map((r) => {
          if (r.permission_key === permKey || r.permission_key === editKey) {
            return { ...r, user_override: false, user_is_granted: r.role_is_granted }
          }
          return r
        })
      } else if (isEdit) {
        const viewKey = permKey.replace('.edit', '.view')
        updated = updated.map((r) => {
          if (r.permission_key === permKey || r.permission_key === viewKey) {
            return { ...r, user_override: false, user_is_granted: r.role_is_granted }
          }
          return r
        })
      }
    }
    return updated
  }

  if (type === 'is_granted') {
    const isView = permKey.endsWith('.view')
    const isEdit = permKey.endsWith('.edit')
    if (value) {
      if (isView) {
        getParentPermissionKeys(pages, permKey).forEach((parent) => {
          const parentViewRow = updated.find((r) => r.permission_key === parent.view)
          if (parentViewRow && !parentViewRow.user_is_granted) {
            parentViewRow.user_is_granted = true
            if (!parentViewRow.role_is_granted) parentViewRow.user_override = true
          }
        })
      } else if (isEdit) {
        getParentPermissionKeys(pages, permKey).forEach((parent) => {
          const pv = updated.find((r) => r.permission_key === parent.view)
          const pe = updated.find((r) => r.permission_key === parent.edit)
          if (pv && !pv.user_is_granted) {
            pv.user_is_granted = true
            if (!pv.role_is_granted) pv.user_override = true
          }
          if (pe && !pe.user_is_granted) {
            pe.user_is_granted = true
            if (!pe.role_is_granted) pe.user_override = true
          }
        })
      }
      updated = updated.map((r) =>
        r.permission_key === permKey ? { ...r, user_is_granted: true, user_override: true } : r,
      )
      alignModuleOverrideFlags(updated, isView ? permKey : permKey.replace('.edit', '.view'))
    } else {
      updated = updated.map((r) => {
        if (r.permission_key !== permKey) return r
        if (r.role_is_granted) {
          return { ...r, user_is_granted: false, user_override: true }
        }
        return { ...r, user_is_granted: false, user_override: false }
      })
      if (isView) {
        const page = pages.find((p) => p.permissions.view === permKey)
        const editKey = permKey.replace('.view', '.edit')
        const editRow = updated.find((r) => r.permission_key === editKey)
        const viewRow = updated.find((r) => r.permission_key === permKey)
        if (editRow && viewRow) {
          editRow.user_is_granted = false
          editRow.user_override = viewRow.user_override
        }
        if (page) {
          getAllChildKeys(pages, page.id).forEach((child) => {
            const cvr = updated.find((r) => r.permission_key === child.view)
            const cer = updated.find((r) => r.permission_key === child.edit)
            if (cvr) {
              cvr.user_is_granted = false
              cvr.user_override = cvr.role_is_granted
            }
            if (cer && cvr) {
              cer.user_is_granted = false
              cer.user_override = cvr.user_override
            }
          })
        }
        cleanupParentOverridesRecursive(pages, updated, permKey)
      } else if (isEdit) {
        const page = pages.find((p) => p.permissions.edit === permKey)
        if (page) {
          alignModuleOverrideFlags(updated, page.permissions.view)
          getAllChildKeys(pages, page.id).forEach((child) => {
            const cvr = updated.find((r) => r.permission_key === child.view)
            const cer = updated.find((r) => r.permission_key === child.edit)
            if (cer && cvr) {
              cer.user_is_granted = false
              cer.user_override = cvr.user_override
            }
          })
          syncEditOverrideWithView(updated, page.permissions.view)
        }
        cleanupParentOverridesRecursive(pages, updated, permKey)
      }
    }
  }

  return updated
}
