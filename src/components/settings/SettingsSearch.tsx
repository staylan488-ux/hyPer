import { useEffect, useRef } from 'react';
import { Input, Modal } from '@/components/shared';
import { SettingsRow } from './SettingsRow';
import { searchApp } from '@/lib/appSearch';
import { isNativeIOS } from '@/lib/nativeBridge';

export function SettingsSearch({ open, query, onQuery, onClose, onSelect }: {
  open: boolean;
  query: string;
  onQuery: (query: string) => void;
  onClose: () => void;
  onSelect: (href: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const results = searchApp(query, { nativeIOS: isNativeIOS() });
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} title="Search" contentClassName="you-settings you-search">
      <form className="shrink-0" onSubmit={(event) => {
        event.preventDefault();
        if (results[0]) onSelect(results[0].href);
      }}>
        <Input ref={input} type="search" aria-label="Search settings and features"
          placeholder="Search settings and features" value={query}
          autoComplete="off" autoCapitalize="none" spellCheck={false}
          onChange={(event) => onQuery(event.target.value)} />
      </form>
      <p className="t-caption mt-3 shrink-0" role="status" aria-live="polite">
        {query.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : 'Suggested destinations'}
      </p>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {results.map((result) => <SettingsRow key={result.id} title={result.title}
          description={result.path} onClick={() => onSelect(result.href)} />)}
      {results.length === 0 && <p className="t-body py-5">
        No matching settings or features. Try “dark mode”, “protein goal”, or “program”.
      </p>}
      </div>
    </Modal>
  );
}
