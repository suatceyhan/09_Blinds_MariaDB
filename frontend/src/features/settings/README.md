# Feature: Settings

Firma ayarları, kullanıcı tercihleri, rol/izin görüntüleme (yetkiye bağlı).

**Order workflow (transitions):** The main table shows a short summary per row; use **Configure** to open the full “prompt on transition” editor (table, field, label) in an expandable panel below the row so the list stays compact. **Show deleted** lists soft-deleted transitions; use **Restore** to re-activate (then **Save**). Run DB migration `DB/42_workflow_transitions_soft_delete.sql` if the column is missing.

**Estimate workflow (transitions):** Same UX as Order workflow, available at `/settings/estimate-workflow` (requires `settings.estimate_workflow.view|edit`).
