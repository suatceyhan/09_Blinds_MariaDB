type ShowDeletedToggleProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
}

/** Compact checkbox for list headers (e.g. soft-deleted rows). */
export function ShowDeletedToggle({
  checked,
  onChange,
  disabled,
  id = 'show-deleted-toggle',
}: ShowDeletedToggleProps) {
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600"
    >
      <input
        id={id}
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>Show deleted</span>
    </label>
  )
}
