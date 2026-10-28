import { ConfirmButton } from '@/components/ConfirmButton'
import { Button } from '@/components/ui'

/** Save, plus turn off / on and delete for rows that already exist. */
export function EditorActions({
  isNew,
  active,
  saving,
  onToggleActive,
  onDelete,
  deleting,
  canEdit = true,
}: {
  isNew: boolean
  active: boolean
  saving: boolean
  onToggleActive?: () => void
  onDelete?: () => void
  deleting?: boolean
  canEdit?: boolean
}) {
  if (!canEdit) return null
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button type="submit" busy={saving} full>
        {isNew ? 'Add' : 'Save'}
      </Button>
      {!isNew && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row">
          {onToggleActive && (
            <Button type="button" variant="secondary" className="flex-1" onClick={onToggleActive}>
              {active ? 'Turn off (keeps history)' : 'Turn back on'}
            </Button>
          )}
          {onDelete && (
            <ConfirmButton
              type="button"
              variant="ghost"
              className="flex-1 text-red-600"
              busy={deleting}
              confirmLabel="Tap again to delete"
              onConfirm={onDelete}
            >
              Delete
            </ConfirmButton>
          )}
        </div>
      )}
    </div>
  )
}
