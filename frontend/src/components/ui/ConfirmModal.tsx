import { useEffect, useRef } from 'react'

export type ConfirmModalProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** Optional third action (e.g. branch after confirm). Placed between cancel and primary confirm. */
  secondaryAction?: { label: string; onClick: () => void }
  /** danger = destructive confirm button styling */
  variant?: 'danger' | 'default'
  /** While true, buttons are disabled (e.g. API in flight). */
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryAction,
  variant = 'default',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    globalThis.addEventListener('keydown', onKey)
    queueMicrotask(() => cancelRef.current?.focus())
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (!pending && e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p id="confirm-modal-desc" className="mt-2 text-sm text-slate-600">
          {description}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          {secondaryAction ? (
            <button
              type="button"
              disabled={pending}
              onClick={secondaryAction.onClick}
              className="rounded-lg border border-teal-200 bg-teal-50/80 px-4 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {secondaryAction.label}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={
              variant === 'danger'
                ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'
                : 'rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {pending ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
