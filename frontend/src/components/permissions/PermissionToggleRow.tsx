import { PermissionSwitch } from './PermissionSwitch'

type Props = {
  nodeName: string
  viewChecked: boolean
  editChecked: boolean
  canEditDisabled: boolean
  collapsed?: boolean
  toggleCollapse?: () => void
  onViewToggle: (checked: boolean) => void
  onEditToggle: (checked: boolean) => void
  userOverride?: boolean
  onOverrideToggle?: () => void
  overrideTooltip?: string
  roleCanView?: boolean | null
  roleCanEdit?: boolean | null
  /** Kul. Gör: rol açık, kullanıcı kapalı */
  denyRevokeView?: boolean
  /** Kul. Düz: rol açık, kullanıcı kapalı (view açıkken) */
  denyRevokeEdit?: boolean
  mode?: 'role' | 'user'
  level?: number
  canEdit?: boolean
  zebraBg?: string
}

export function PermissionToggleRow({
  nodeName,
  viewChecked,
  editChecked,
  canEditDisabled,
  collapsed,
  toggleCollapse,
  onViewToggle,
  onEditToggle,
  userOverride = false,
  onOverrideToggle,
  overrideTooltip = '',
  roleCanView,
  roleCanEdit,
  denyRevokeView = false,
  denyRevokeEdit = false,
  mode = 'role',
  level = 0,
  canEdit = true,
  zebraBg = '',
}: Props) {
  const padLeft = level * 16

  const collapseIcon = typeof collapsed === 'boolean' ? (collapsed ? '▶ ' : '▼ ') : ''

  return (
    <div className={`flex min-h-[2.5rem] items-center border-b border-slate-100 py-1 ${zebraBg}`}>
      <div className="flex w-64 min-w-[12rem] items-center" style={{ paddingLeft: padLeft }}>
        <button
          type="button"
          onClick={toggleCollapse}
          disabled={toggleCollapse === undefined}
          className={`text-left text-sm font-medium text-slate-800 ${
            toggleCollapse ? 'hover:underline' : 'cursor-default'
          }`}
        >
          {collapseIcon}
          {nodeName}
        </button>
      </div>

      {mode === 'user' ? (
        <>
          <div className="flex w-24 justify-center">
            <PermissionSwitch checked={!!roleCanView} onChange={() => {}} disabled className="opacity-60" />
          </div>
          <div className="flex w-24 justify-center">
            <PermissionSwitch checked={!!roleCanEdit} onChange={() => {}} disabled className="opacity-60" />
          </div>
          <div className="flex w-24 justify-center">
            <PermissionSwitch
              checked={userOverride ? viewChecked : false}
              onChange={onViewToggle}
              disabled={!userOverride || !canEdit}
              denyRevoke={!!denyRevokeView}
            />
          </div>
          <div className="flex w-24 justify-center">
            <PermissionSwitch
              checked={userOverride ? (canEditDisabled ? false : editChecked) : false}
              onChange={onEditToggle}
              disabled={!userOverride || canEditDisabled || !canEdit}
              denyRevoke={!!denyRevokeEdit}
            />
          </div>
          <div className="flex w-16 justify-center">
            {onOverrideToggle && canEdit ? (
              <button
                type="button"
                title={overrideTooltip}
                onClick={onOverrideToggle}
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  userOverride ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {userOverride ? 'ON' : 'OFF'}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex w-20 justify-center">
            <PermissionSwitch checked={viewChecked} onChange={onViewToggle} disabled={!canEdit} />
          </div>
          <div className="flex w-20 justify-center">
            <PermissionSwitch
              checked={editChecked}
              onChange={onEditToggle}
              disabled={canEditDisabled || !canEdit}
            />
          </div>
        </>
      )}
    </div>
  )
}
