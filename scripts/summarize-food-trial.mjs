// Offline only. Input is your manually recorded comparison data, never an API key.
// node scripts/summarize-food-trial.mjs path/to/comparisons.json
import { readFile } from 'node:fs/promises';
const path = process.argv[2];
if (!path) throw new Error('Supply a JSON array of {meal, estimatedKcal, referenceKcal, reference, amountConfirmed}.');
const rows = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(rows) || !rows.length) throw new Error('No comparisons supplied.');
const usable = rows.filter(r => r.amountConfirmed === true && typeof r.reference === 'string' && r.reference.trim()
  && Number.isFinite(r.estimatedKcal) && Number.isFinite(r.referenceKcal) && r.estimatedKcal >= 0 && r.referenceKcal > 0);
if (!usable.length) throw new Error('No comparisons have a confirmed amount, known reference and valid calories.');
const errors = usable.map(r => r.estimatedKcal - r.referenceKcal);
const abs = errors.map(Math.abs).sort((a, b) => a - b);
const round = n => Math.round(n * 10) / 10;
console.log(JSON.stringify({
  compared: usable.length,
  excluded: rows.length - usable.length,
  meanSignedKcalError: round(errors.reduce((a, b) => a + b, 0) / errors.length),
  meanAbsoluteKcalError: round(abs.reduce((a, b) => a + b, 0) / abs.length),
  largestAbsoluteKcalError: round(abs.at(-1)),
  mealsOver200KcalError: abs.filter(n => n > 200).length,
  meals: usable.map((r, i) => ({ meal: r.meal, signedKcalError: round(errors[i]), reference: r.reference })),
  limitation: 'Small convenience sample; reference labels are rounded and weighed recipes still require complete ingredients. This does not establish accuracy for other meals.',
}, null, 2));
