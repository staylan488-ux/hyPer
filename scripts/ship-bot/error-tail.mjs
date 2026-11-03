import { stripVTControlCharacters } from 'node:util';

const LIMIT = 1200;
const FAILURE = /\b(?:error|errors|failed|failure|fatal|exception)\b|\[!\]|✗|❌|❗|└─ Cause:|exited with non-zero/i;

// Keep the cause and its surrounding output together. Filtering individual
// lines loses details such as CocoaPods' "Cause:" and compiler source context.
export function errorTail(out) {
  const clean = stripVTControlCharacters(out).replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').map((line) => line.replace(/^\[\d{2}:\d{2}:\d{2}\]:\s*(?:▸\s*)?/, ''));

  // Fastlane prints release notes even after failures; their references to
  // errors and failing tests describe unrelated changes in newer versions.
  const releaseNotes = lines.findIndex((line) => /^#\s*fastlane [\d.]+ is available\./.test(line));
  if (releaseNotes !== -1) lines.splice(releaseNotes);

  // Successful earlier stages can contain intentional error output (notably
  // tests exercising failure handling). Diagnose the stage that actually ran
  // last, rather than those earlier messages.
  const stage = lines.findLastIndex((line) => /^==> /.test(line));
  const current = lines.slice(stage === -1 ? 0 : stage + 1);
  const failure = current.findIndex((line) => FAILURE.test(line));
  const nextStep = failure === -1 ? -1 : current.findIndex((line, index) =>
    index > failure && /^(?:Step:|--- Step:)/.test(line));
  const end = nextStep === -1 ? failure + 10 : Math.min(nextStep, failure + 10);
  const excerpt = failure === -1
    ? current.join('\n').trim().slice(-LIMIT)
    : current.slice(Math.max(0, failure - 1), end).join('\n').trim().replace(/\n[-=]+$/, '');

  // A diagnostic can itself contain Markdown fences (Fastlane prints Ruby
  // source this way). Prevent it from closing the Discord message's fence.
  const safe = excerpt.replace(/```/g, "'''") || 'No diagnostic output was captured.';
  return safe.length <= LIMIT ? safe : `${safe.slice(0, LIMIT - 2)}\n…`;
}
