import { useEffect, useMemo, useState } from 'react'
import { EyeOff, Pencil, Plus, RotateCcw, StickyNote, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'

type NoteRow = {
  id: string
  company_id: string
  title: string
  body: string | null
  due_at: string | null
  is_deleted: boolean
  created_at?: string | null
  updated_at?: string | null
}

type PendingConfirm =
  | { kind: 'delete'; id: string; title: string }
  | { kind: 'restore'; id: string; title: string }

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString()
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(v: string): string | null {
  const raw = v.trim()
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function NotesPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('notes.view'))
  const canEdit = Boolean(me?.permissions.includes('notes.edit'))

  const [rows, setRows] = useState<NoteRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [onlyReminders, setOnlyReminders] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [dueAt, setDueAt] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editDueAt, setEditDueAt] = useState('')

  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showDeleted) p.set('include_deleted', 'true')
    if (onlyReminders) p.set('only_reminders', 'true')
    return p.toString()
  }, [debouncedSearch, showDeleted, onlyReminders])

  useEffect(() => {
    if (!me || !canView) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<NoteRow[]>(`/notes?${listParams}`)
        if (!cancelled) setRows(list)
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load notes')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canView, listParams])

  async function refresh() {
    const list = await getJson<NoteRow[]>(`/notes?${listParams}`)
    setRows(list)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !title.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await postJson('/notes', {
        title: title.trim(),
        body: body.trim() || null,
        due_at: fromDatetimeLocal(dueAt),
      })
      setTitle('')
      setBody('')
      setDueAt('')
      setShowCreate(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(r: NoteRow) {
    setEditId(r.id)
    setEditTitle(r.title ?? '')
    setEditBody(r.body ?? '')
    setEditDueAt(toDatetimeLocal(r.due_at ?? null))
  }

  async function onEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editId || !editTitle.trim()) return
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/notes/${editId}`, {
        title: editTitle.trim(),
        body: editBody.trim() || null,
        due_at: fromDatetimeLocal(editDueAt),
      })
      setEditId(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function runConfirm() {
    if (!pending) return
    setConfirmPending(true)
    setErr(null)
    try {
      if (pending.kind === 'delete') {
        await deleteJson(`/notes/${pending.id}`)
      } else {
        await postJson(`/notes/${pending.id}/restore`, {})
      }
      setPending(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setConfirmPending(false)
    }
  }

  if (!me) return <div className="text-sm text-slate-500">Loading…</div>
  if (!canView) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-700">You do not have access to Notes.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Notes</h1>
          <p className="text-sm text-slate-600">Quick notes and reminders for work in the field.</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            New note
          </button>
        ) : null}
      </div>

      {canEdit && showCreate ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <StickyNote className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-900">New note</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Add a due date to turn this note into a reminder.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="grid gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Title</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Quick note…"
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Body (optional)</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder="Details…"
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Due date (optional)</span>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </label>
            </div>
          </div>
        </form>
      ) : null}

      {canEdit && editId ? (
        <form
          onSubmit={(e) => void onEditSave(e)}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900">Edit note</h2>
              <p className="mt-0.5 text-xs text-slate-500">Update note details.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditId(null)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving || !editTitle.trim()}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="grid gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Title</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Body (optional)</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={4}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Due date (optional)</span>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                />
              </label>
            </div>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes…"
          className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
        />
        <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={onlyReminders}
            onChange={(e) => setOnlyReminders(e.target.checked)}
          />
          <span>Reminders only</span>
        </label>
        <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          <span>Show deleted</span>
        </label>
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right min-w-[13rem]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (rows ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-slate-500">
                  No notes found.
                </td>
              </tr>
            ) : (
              (rows ?? []).map((r) => (
                <tr key={r.id} className={r.is_deleted ? 'bg-slate-50/50 text-slate-500' : ''}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{r.title}</div>
                    {r.body ? <div className="mt-1 line-clamp-2 text-xs text-slate-600">{r.body}</div> : null}
                    {r.is_deleted ? (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                        <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
                        Deleted
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{fmtDateTime(r.due_at)}</td>
                  <td className="px-4 py-3">{fmtDateTime(r.updated_at ?? r.created_at)}</td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="flex flex-col items-end gap-1 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-x-2">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" strokeWidth={2} />
                        </button>
                      ) : null}
                      {canEdit && !r.is_deleted ? (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'delete', id: r.id, title: r.title })}
                          className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={2} />
                        </button>
                      ) : null}
                      {canEdit && r.is_deleted ? (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'restore', id: r.id, title: r.title })}
                          className="rounded-lg border border-teal-200 p-1.5 text-teal-800 hover:bg-teal-50"
                          title="Restore"
                          aria-label="Restore"
                        >
                          <RotateCcw className="h-4 w-4" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(() => {
        let confirmTitle = 'Restore note?'
        let confirmDescription = `This note will be visible again in the default list. (${pending?.title ?? ''})`
        let confirmLabel = 'Restore'
        let variant: 'danger' | 'default' = 'default'
        if (pending?.kind === 'delete') {
          confirmTitle = 'Delete note?'
          confirmDescription = `This note will be hidden from the default list. You can restore it later. (${pending?.title ?? ''})`
          confirmLabel = 'Delete'
          variant = 'danger'
        }
        return (
          <ConfirmModal
            open={pending !== null}
            title={confirmTitle}
            description={confirmDescription}
            confirmLabel={confirmLabel}
            variant={variant}
            pending={confirmPending}
            onCancel={() => (confirmPending ? undefined : setPending(null))}
            onConfirm={() => void runConfirm()}
          />
        )
      })()}
    </div>
  )
}

