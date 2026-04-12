type Props = {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  className?: string
  /** Rolde açıkken kullanıcıda kapalı (explicit deny) — kapalı konumda kırmızımsı vurgu */
  denyRevoke?: boolean
}

export function PermissionSwitch({
  checked,
  onChange,
  disabled,
  className = '',
  denyRevoke = false,
}: Props) {
  const offDeny = !!denyRevoke && !checked
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={offDeny ? 'Role grant denied for this user' : undefined}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors',
        offDeny ? 'border-rose-400' : 'border-transparent',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-teal-600' : offDeny ? 'bg-rose-200' : 'bg-slate-200',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow ring-0 transition duration-200',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  )
}
