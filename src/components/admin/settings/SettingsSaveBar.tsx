export function SettingsSaveBar({
  isDirty,
  isSaving,
  onSave,
}: {
  isDirty: boolean
  isSaving: boolean
  onSave: () => void
}) {
  if (!isDirty) return null

  return (
    <div className="sticky bottom-4 flex justify-end">
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
      >
        {isSaving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  )
}
