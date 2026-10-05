/**
 * A failed History edit still reloads partial writes, but that reload must not
 * finish the workout. For example, a failed target-set increase can leave all
 * the old sets logged while the requested new sets do not yet exist.
 */
export async function runWorkoutEdit(
  mutate: () => Promise<void>,
  refresh: (syncCompletion: boolean) => Promise<void>,
): Promise<boolean> {
  let saved = true;
  try {
    await mutate();
  } catch (error) {
    console.error('Error saving workout edit:', error);
    saved = false;
  }

  try {
    await refresh(saved);
  } catch (error) {
    console.error('Error refreshing workout after edit:', error);
    saved = false;
  }
  return saved;
}
