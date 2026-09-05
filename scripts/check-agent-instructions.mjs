#!/usr/bin/env node
// Check the active project instructions, never historical notes or user globals.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--root')) {
  console.error('Usage: node scripts/check-agent-instructions.mjs [--root PATH]');
  process.exit(2);
}
const requestedRoot = args[1] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root;
try {
  root = fs.realpathSync(requestedRoot);
} catch {
  console.error(`Instruction root does not exist: ${requestedRoot}`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const activeFiles = new Set();
const extraAliases = [];
const documents = new Map();
const skillRoot = path.join(root, '.agents/skills');
const aliasRoot = path.join(root, '.claude/skills');
const display = (file) => path.relative(root, file) || '.';
const insideRoot = (file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function requireLocal(file, context) {
  if (!insideRoot(file)) {
    errors.push(`${context}: path leaves the project (${file})`);
    return false;
  }
  try {
    if (!insideRoot(fs.realpathSync(file))) {
      errors.push(`${context}: symlink resolves outside the project (${display(file)})`);
      return false;
    }
    return true;
  } catch {
    errors.push(`${context}: missing local target ${display(file)}`);
    return false;
  }
}

function readDocument(file) {
  if (!requireLocal(file, display(file))) return;
  if (!fs.statSync(file).isFile()) {
    errors.push(`${display(file)}: expected a Markdown file`);
    return;
  }
  activeFiles.add(file);
  documents.set(file, fs.readFileSync(file, 'utf8'));
}

// This deliberately supports the scalar subset used by skill metadata, not all YAML.
function scalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/);
    if (!match) throw new Error('invalid double-quoted scalar');
    return JSON.parse(match[1]);
  }
  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
    if (!match) throw new Error('invalid single-quoted scalar');
    return match[1].replace(/''/g, "'");
  }
  const plain = trimmed.replace(/\s+#.*$/, '').trim();
  if (!plain || /^(?:null|true|false|~|[-+]?\d+(?:\.\d+)?)$/i.test(plain)
    || /^[\[\]{}&*!|>@`]/.test(plain) || /:\s/.test(plain)) {
    throw new Error('expected a nonempty string scalar (quote special YAML characters)');
  }
  return plain;
}

function checkFrontmatter(file, source, expectedName, names) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (lines[0] !== '---' || end < 0) {
    errors.push(`${display(file)}: missing YAML frontmatter delimiters`);
    return;
  }
  const values = {};
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^(name|description):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (Object.hasOwn(values, key)) errors.push(`${display(file)}:${index + 1}: duplicate ${key}`);
    try {
      if (/^[|>][+-]?(?:\s+#.*)?$/.test(value)) {
        const block = [];
        while (index + 1 < end && (/^\s/.test(lines[index + 1]) || !lines[index + 1])) {
          block.push(lines[++index].trim());
        }
        values[key] = block.join(value[0] === '>' ? ' ' : '\n').trim();
      } else {
        values[key] = scalar(value);
      }
    } catch (error) {
      errors.push(`${display(file)}:${index + 1}: ${key}: ${error.message}`);
    }
  }
  for (const key of ['name', 'description']) {
    if (typeof values[key] !== 'string' || !values[key].trim()) {
      errors.push(`${display(file)}: ${key} must be a nonempty string`);
    }
  }
  if (typeof values.name === 'string') {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.name) || values.name.length > 64) {
      errors.push(`${display(file)}: name must use 1–64 lowercase letters, digits, and single hyphens`);
    }
    if (values.name !== expectedName) errors.push(`${display(file)}: name must match folder ${expectedName}`);
    if (names.has(values.name)) errors.push(`${display(file)}: duplicate skill name ${values.name}`);
    names.add(values.name);
  }
  if ((values.description?.length ?? 0) > 1024) {
    warnings.push(`${display(file)}: description exceeds 1,024 characters; consider a shorter trigger`);
  }
  if (Buffer.byteLength(lines.slice(0, end + 1).join('\n')) > 4096) {
    warnings.push(`${display(file)}: frontmatter exceeds 4 KiB; consider moving detail into the body`);
  }
}

function withoutCode(source) {
  let fence;
  return source.split(/\r?\n/).map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line.replace(/(`+)[\s\S]*?\1/g, '');
  }).join('\n').replace(/<!--[\s\S]*?-->/g, '');
}

function checkTarget(file, target) {
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return;
  let local;
  try {
    local = decodeURIComponent(target.split(/[?#]/, 1)[0].replace(/\\([\\()[\] <>])/g, '$1'));
  } catch {
    errors.push(`${display(file)}: invalid URL encoding in local link ${target}`);
    return;
  }
  if (local) requireLocal(path.resolve(path.dirname(file), local), `${display(file)}: link ${target}`);
}

function checkLinks(file, source) {
  const prose = withoutCode(source);
  // Inline links/images: support angle destinations, escapes, and balanced parentheses.
  for (const match of prose.matchAll(/\]\(\s*/g)) {
    let index = match.index + match[0].length;
    let target = '';
    if (prose[index] === '<') {
      const end = prose.indexOf('>', index + 1);
      if (end < 0) continue;
      target = prose.slice(index + 1, end);
    } else {
      let depth = 0;
      while (index < prose.length) {
        const char = prose[index++];
        if (char === '\\' && index < prose.length) {
          target += char + prose[index++];
          continue;
        }
        if (/\s/.test(char) || (char === ')' && depth === 0)) break;
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        target += char;
      }
    }
    checkTarget(file, target);
  }
  for (const match of prose.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    checkTarget(file, match[1] ?? match[2]);
  }
}

for (const relative of ['AGENTS.md', 'CLAUDE.md', 'TOOL_SWITCHING_CHECKLIST.md', 'docs/agent-workflows.md']) {
  readDocument(path.join(root, relative));
}
const skills = [];
if (requireLocal(skillRoot, '.agents/skills')) {
  if (!fs.statSync(skillRoot).isDirectory()) errors.push('.agents/skills: expected a directory');
  else {
    for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) readDocument(path.join(skillRoot, entry.name));
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const directory = path.join(skillRoot, entry.name);
      if (!requireLocal(directory, display(directory)) || !fs.statSync(directory).isDirectory()) continue;
      skills.push(entry.name);
      readDocument(path.join(directory, 'SKILL.md'));
      const visited = new Set();
      const walk = (current) => {
        if (!requireLocal(current, display(current))) return;
        const real = fs.realpathSync(current);
        if (visited.has(real)) return;
        visited.add(real);
        for (const child of fs.readdirSync(current, { withFileTypes: true })) {
          const file = path.join(current, child.name);
          if (!requireLocal(file, display(file))) continue;
          if (fs.statSync(file).isDirectory()) walk(file);
          else if (child.name.endsWith('.md')) readDocument(file);
        }
      };
      walk(directory);
    }
    if (!skills.length) errors.push('.agents/skills: no skill directories found');
  }
}

const names = new Set();
for (const name of skills) {
  const file = path.join(skillRoot, name, 'SKILL.md');
  if (documents.has(file)) checkFrontmatter(file, documents.get(file), name, names);
}
if (requireLocal(aliasRoot, '.claude/skills')) {
  if (!fs.lstatSync(aliasRoot).isDirectory()) errors.push('.claude/skills: expected a directory of skill-entry symlinks');
  else {
    for (const entry of fs.readdirSync(aliasRoot)) {
      if (!skills.includes(entry)) extraAliases.push(path.join(aliasRoot, entry));
    }
    for (const name of skills) {
      const alias = path.join(aliasRoot, name);
      const canonical = path.join(skillRoot, name);
      if (!requireLocal(alias, display(alias))) continue;
      activeFiles.add(alias);
      if (!fs.lstatSync(alias).isSymbolicLink()) {
        errors.push(`${display(alias)}: expected a symlink, not a separately maintained copy`);
        continue;
      }
      const target = fs.readlinkSync(alias);
      if (path.isAbsolute(target) || path.resolve(aliasRoot, target) !== canonical
        || fs.realpathSync(alias) !== fs.realpathSync(canonical)) {
        errors.push(`${display(alias)}: must use a relative symlink to ${display(canonical)}`);
      }
    }
  }
}

const claudeFile = path.join(root, 'CLAUDE.md');
const imports = [...withoutCode(documents.get(claudeFile) ?? '').matchAll(/(?:^|[\s(])@([^\s()[\]<>]+)/gm)];
if (!imports.length) errors.push('CLAUDE.md: expected an @AGENTS.md import outside code');
let importsAgents = false;
for (const match of imports) {
  const target = path.resolve(root, match[1]);
  requireLocal(target, `CLAUDE.md: import ${match[1]}`);
  if (target === path.join(root, 'AGENTS.md')) importsAgents = true;
}
if (imports.length && !importsAgents) errors.push('CLAUDE.md: must import the canonical AGENTS.md');
for (const [file, source] of documents) checkLinks(file, source);

const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
let gitChecked = false;
let ignoredPaths = new Set();
if (git.status === 0 && fs.realpathSync(git.stdout.trim()) === root) {
  gitChecked = true;
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin', '-z'], {
    input: [...activeFiles, ...extraAliases].map(display).join('\0') + '\0', encoding: 'utf8',
  });
  if (ignored.status !== 0 && ignored.status !== 1) errors.push(`git check-ignore failed: ${ignored.stderr.trim()}`);
  else {
    ignoredPaths = new Set(ignored.stdout.split('\0').filter(Boolean));
    for (const file of activeFiles) {
      if (ignoredPaths.has(display(file))) errors.push(`${display(file)}: active instruction file is ignored by Git`);
    }
  }
} else if (fs.existsSync(path.join(root, '.git'))) {
  errors.push(`Cannot inspect the supplied Git root: ${git.stderr?.trim() || git.error?.message || 'unexpected worktree root'}`);
}
for (const alias of extraAliases) {
  if (!ignoredPaths.has(display(alias))) {
    errors.push(`${display(alias)}: no corresponding canonical skill and not confirmed ignored by Git`);
  }
}
for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`FAIL ${error}`);
if (!gitChecked) console.log('Git ignore checks skipped: the supplied root is not a Git worktree root.');
if (errors.length) {
  console.error(`Instruction checks failed (${errors.length} error${errors.length === 1 ? '' : 's'}).`);
  process.exitCode = 1;
} else {
  console.log(`Instruction checks passed: ${skills.length} skills, ${documents.size} Markdown files, ${warnings.length} warnings.`);
}
