import { useRef, useState } from 'react';
import { Check, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/shared';
import { importCronometerCsv, parseCronometerCsv, type CronometerImportSummary } from '@/lib/cronometerImport';
import { supabase } from '@/lib/supabase';
import { isPreviewActive } from '@/preview/flag';

const MAX_CSV_BYTES = 8 * 1024 * 1024;
const PREVIEW_CSV = `Day,Time,Group,Food Name,Amount,Unit,Energy (kcal),Protein (g),Carbs (g),Fat (g)
2026-07-16,08:10,Breakfast,"Greek Yogurt, Plain",170,g,100,17,6,1
2026-07-16,08:12,Breakfast,"Granola, Almond",45,g,205,5,31,7
2026-07-16,15:20,Snack 1,"Protein Bar, Chocolate",1,bar,210,20,23,7
2026-07-16,19:05,Dinner,"Salmon, Cooked",170,g,280,39,0,13`;

interface CronometerImporterProps {
  onImported: () => void;
}
export function CronometerImporter({ onImported }: CronometerImporterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [validRows, setValidRows] = useState(0);
  const [invalidRows, setInvalidRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CronometerImportSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const prepareCsv = (name: string, text: string) => {
    const parsed = parseCronometerCsv(text);
    setFileName(name);
    setCsvText(text);
    setValidRows(parsed.rows.length);
    setInvalidRows(parsed.invalid);
    setSummary(null);
    setError(parsed.rows.length === 0 ? 'No valid serving rows found. Choose Cronometer’s Servings CSV export.' : null);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setSummary(null);
    if (file.size > MAX_CSV_BYTES) {
      setError('CSV is too large. Export a smaller date range (maximum 8 MB).');
      return;
    }
    prepareCsv(file.name, await file.text());
  };

  const handleImport = async () => {
    if (!csvText || importing) return;
    setImporting(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Your session expired. Please sign in again.');
      const result = await importCronometerCsv(supabase, user.id, fileName || 'servings.csv', csvText);
      setSummary(result);
      onImported();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Cronometer import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-2">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0] || null)}
      />

      <div>
        <p className="t-body text-[var(--color-text-dim)]">
          In Cronometer, export <strong className="font-medium text-[var(--color-text)]">Servings</strong> for the date range you want, then choose that CSV here. Re-importing the same rows is safe.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="pressable mt-5 w-full border border-dashed border-[var(--color-border-strong)] py-9 flex flex-col items-center gap-3"
        >
          <FileUp className="w-5 h-5 text-[var(--color-text-dim)]" strokeWidth={1.5} />
          <span className="t-heading">{fileName || 'Choose servings.csv'}</span>
          <span className="t-caption">Cronometer CSV, up to 8 MB</span>
        </button>
        {isPreviewActive() && (
          <button
            type="button"
            className="pressable t-label mt-3 text-[var(--color-text-dim)]"
            onClick={() => prepareCsv('preview-cronometer-servings.csv', PREVIEW_CSV)}
          >
            Use preview sample
          </button>
        )}
      </div>

      {csvText && !summary && (
        <div className="border-l-2 border-[var(--color-text)] pl-4">
          <span className="t-label block">Ready to import</span>
          <p className="t-data mt-1 text-[var(--color-text)]">{validRows} valid row{validRows === 1 ? '' : 's'}</p>
          {invalidRows > 0 && <p className="t-caption mt-1">{invalidRows} invalid row{invalidRows === 1 ? '' : 's'} will be skipped.</p>}
        </div>
      )}

      {summary && (
        <div className="border-l-2 border-[var(--color-accent)] pl-4">
          <span className="t-label flex items-center gap-2"><Check className="w-3.5 h-3.5" /> Import complete</span>
          <p className="t-data mt-1 text-[var(--color-text)]">
            {summary.imported} new · {summary.skipped} already present
          </p>
          {summary.alreadyImportedFile && <p className="t-caption mt-1">This exact export was imported previously.</p>}
        </div>
      )}

      {error && <p className="t-caption text-[var(--color-accent)]">{error}</p>}

      <Button
        size="lg"
        className="w-full"
        onClick={() => void handleImport()}
        disabled={!csvText || validRows === 0 || importing || !!summary}
      >
        {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" strokeWidth={1.75} />}
        {importing ? 'Importing…' : 'Import new entries'}
      </Button>
    </div>
  );
}
