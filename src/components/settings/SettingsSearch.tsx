import { useRef } from 'react';
import { Search } from 'lucide-react';
import { Input, Modal } from '@/components/shared';
import { SettingsGroup, SettingsRow } from './SettingsRow';
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
  return (
    <Modal isOpen={open} onClose={onClose} title="Search" contentClassName="you-settings you-search" initialFocusRef={input}>
      <form className="relative shrink-0" onSubmit={(event) => {
        event.preventDefault();
        if (results[0]) onSelect(results[0].href);
      }}>
        <Search size={17} strokeWidth={1.75} aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[var(--color-muted)]" />
        <Input ref={input} type="search" aria-label="Search settings and features"
          placeholder="Search settings and features" value={query}
          autoComplete="off" autoCapitalize="none" spellCheck={false}
          onChange={(event) => onQuery(event.target.value)} />
      </form>
      <p className="t-label px-1 mt-5 mb-3 shrink-0" role="status" aria-live="polite">
        {query.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : 'Suggested destinations'}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {results.length > 0 && (
          <SettingsGroup>
            {results.map((result) => <SettingsRow key={result.id} title={result.title}
              description={result.path} onClick={() => onSelect(result.href)} />)}
          </SettingsGroup>
        )}
        {results.length === 0 && <p className="t-body px-1 py-5">
          No matching settings or features. Try “dark mode”, “protein goal”, or “program”.
        </p>}
      </div>
    </Modal>
  );
}
