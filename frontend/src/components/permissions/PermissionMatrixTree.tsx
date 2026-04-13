import { useState } from 'react'
import { PermissionToggleRow } from './PermissionToggleRow'

export interface PermissionNode {
  id: string
  name: string
  permissions: { view: string; edit: string }
  children?: PermissionNode[]
}

type Props = {
  nodes: PermissionNode[]
  permissionMap: Record<string, boolean>
  onToggle: (
    permKey: string,
    value: boolean,
    allChildKeys?: string[],
    type?: 'is_granted' | 'override',
    pageId?: string,
  ) => void
  /**
   * Rol matrisi: görüntüle satırı OFF olunca düz satırını da aynı state güncellemesinde kapatır
   * (ardışık iki setKeyMap önceki prev ile çalışıp üst zincir ON’unu ezebiliyordu).
   */
  onRoleViewRowToggle?: (
    viewKey: string,
    editKey: string,
    checked: boolean,
    allViewKeys: string[],
    allEditKeys: string[],
    pageId: string,
  ) => void
  level?: number
  mode?: 'role' | 'user'
  canEdit?: boolean
  /** user mode: satır başına { role_is_granted, user_is_granted, user_override } */
  permissionDetailMap?: Record<
    string,
    { role_is_granted: boolean; user_is_granted: boolean; user_override: boolean }
  >
}

function collectKeys(node: PermissionNode, type: 'view' | 'edit'): string[] {
  const keys = [node.permissions[type]]
  if (node.children) {
    for (const child of node.children) {
      keys.push(...collectKeys(child, type))
    }
  }
  return keys
}

export function PermissionMatrixTree({
  nodes,
  permissionMap,
  onToggle,
  onRoleViewRowToggle,
  level = 0,
  mode = 'role',
  canEdit = true,
  permissionDetailMap,
}: Props) {
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  const toggleCollapse = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const collectAllNodes = (
    ns: PermissionNode[],
    currentLevel: number = 0,
  ): Array<{ node: PermissionNode; level: number }> => {
    let all: Array<{ node: PermissionNode; level: number }> = []
    ns.forEach((node) => {
      all.push({ node, level: currentLevel })
      const isCollapsed = collapsedNodes.has(node.id)
      if (node.children && !isCollapsed) {
        all = all.concat(collectAllNodes(node.children, currentLevel + 1))
      }
    })
    return all
  }

  const renderUserNode = (node: PermissionNode, nodeLevel: number, zebraBg: string) => {
    const viewKey = node.permissions.view
    const editKey = node.permissions.edit
    const hasChildren = !!(node.children && node.children.length > 0)
    const isCollapsed = collapsedNodes.has(node.id)

    const detView = permissionDetailMap?.[viewKey]
    const detEdit = permissionDetailMap?.[editKey]
    const roleView = detView?.role_is_granted ?? false
    const roleEdit = detEdit?.role_is_granted ?? false
    const userView = detView?.user_is_granted ?? false
    const userEditRaw = detEdit?.user_is_granted ?? false
    const userOverride = detView?.user_override ?? detEdit?.user_override ?? false
    const denyRevokeView = !!(userOverride && roleView && !userView)
    const denyRevokeEdit = !!(userOverride && roleEdit && userView && !userEditRaw)
    const overrideTooltip = userOverride
      ? 'Override on — click to turn off (reverts toward role defaults)'
      : 'Override: set user-specific grants for this module vs role'

    return (
      <div key={node.id}>
        <PermissionToggleRow
          nodeName={node.name}
          viewChecked={userView}
          editChecked={userEditRaw}
          canEditDisabled={!userView}
          collapsed={hasChildren ? isCollapsed : undefined}
          toggleCollapse={hasChildren ? () => toggleCollapse(node.id) : undefined}
          onViewToggle={(val) => onToggle(viewKey, val, undefined, 'is_granted', node.id)}
          onEditToggle={(val) => {
            if (!userView && val) return
            onToggle(editKey, val, undefined, 'is_granted', node.id)
          }}
          userOverride={userOverride}
          onOverrideToggle={() => onToggle(viewKey, !userOverride, undefined, 'override')}
          overrideTooltip={overrideTooltip}
          roleCanView={roleView}
          roleCanEdit={roleEdit}
          denyRevokeView={denyRevokeView}
          denyRevokeEdit={denyRevokeEdit}
          mode="user"
          level={nodeLevel}
          canEdit={canEdit}
          zebraBg={zebraBg}
        />
      </div>
    )
  }

  const renderRoleNode = (node: PermissionNode, nodeLevel: number, zebraBg: string) => {
    const viewKey = node.permissions.view
    const editKey = node.permissions.edit
    const hasChildren = !!(node.children && node.children.length > 0)
    const isCollapsed = collapsedNodes.has(node.id)

    const isViewChecked = !!permissionMap[viewKey]
    const isEditChecked = !!permissionMap[editKey]
    const allViewKeys = collectKeys(node, 'view')
    const allEditKeys = collectKeys(node, 'edit')

    return (
      <div key={node.id}>
        <PermissionToggleRow
          nodeName={node.name}
          viewChecked={isViewChecked}
          editChecked={isEditChecked}
          canEditDisabled={!isViewChecked}
          collapsed={hasChildren ? isCollapsed : undefined}
          toggleCollapse={hasChildren ? () => toggleCollapse(node.id) : undefined}
          onViewToggle={(checked) => {
            if (onRoleViewRowToggle) {
              onRoleViewRowToggle(viewKey, editKey, checked, allViewKeys, allEditKeys, node.id)
            } else {
              onToggle(viewKey, checked, allViewKeys, 'is_granted', node.id)
              if (!checked) {
                onToggle(editKey, false, allEditKeys, 'is_granted', node.id)
              }
            }
          }}
          onEditToggle={(checked) => onToggle(editKey, checked, allEditKeys, 'is_granted', node.id)}
          mode="role"
          level={nodeLevel}
          canEdit={canEdit}
          zebraBg={zebraBg}
        />
      </div>
    )
  }

  const allFlat = collectAllNodes(nodes, level)

  return (
    <>
      {level === 0 && (
        <div className="mb-2 flex items-center border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800">
          <div className="w-64 min-w-[12rem] text-base font-bold">Permission</div>
          <div className="w-24 text-center">Role view</div>
          <div className="w-24 text-center">Role edit</div>
          {mode === 'user' && (
            <>
              <div className="w-24 text-center">User view</div>
              <div className="w-24 text-center">User edit</div>
              <div className="w-16 text-center">Ovr.</div>
            </>
          )}
        </div>
      )}
      {allFlat.map(({ node: n, level: nodeLevel }, idx) => {
        const zebraBg = idx % 2 === 1 ? 'bg-slate-50' : ''
        return mode === 'user'
          ? renderUserNode(n, nodeLevel, zebraBg)
          : renderRoleNode(n, nodeLevel, zebraBg)
      })}
    </>
  )
}
