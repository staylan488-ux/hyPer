import { memo, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { Input } from '@/components/shared';

type CommitInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'defaultValue'> & {
  value: string;
  onCommit: (value: string) => void;
};

/**
 * A text field that keeps keystrokes local and commits once, on blur or
 * Enter, so typing does not re-render the whole program. Saving first blurs
 * the focused field (commitFocusedField), so nothing typed is lost.
 */
export const CommitInput = memo(function CommitInput({ value, onCommit, onKeyDown, ...props }: CommitInputProps) {
  // null while not editing: the field shows the committed value.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };

  return (
    <Input
      {...props}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event);
        if (event.key === 'Enter' && !event.defaultPrevented) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
});
