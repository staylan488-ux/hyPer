import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-agent-instructions.mjs', import.meta.url));
let temporaryDirectory: string;
let root: string;
let fixtureEnv: NodeJS.ProcessEnv;

function write(relative: string, contents: string) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function validate() {
  const result = spawnSync(process.execPath, [script, '--root', root], {
    cwd: root,
    env: fixtureEnv,
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-agent-instructions-'));
  root = path.join(temporaryDirectory, 'project');
  const emptyConfig = path.join(temporaryDirectory, 'empty-git-config');
  fs.writeFileSync(emptyConfig, '');
  // Keep the fixture independent of the developer's Git worktree and ignore rules.
  fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(fixtureEnv, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_TERMINAL_PROMPT: '0',
  });

  write('AGENTS.md', '# Project guidance\n[Workflows](docs/agent-workflows.md)\n');
  write('CLAUDE.md', 'Shared project instructions: @AGENTS.md\n');
  write('TOOL_SWITCHING_CHECKLIST.md', '[Policy][policy]\n\n[policy]: AGENTS.md\n');
  write('docs/agent-workflows.md', '[Policy](../AGENTS.md)\n');
  write('.agents/skills/sample-task/SKILL.md', [
    '---',
    "name: 'sample-task'",
    'description: >-',
    '  Use for sample operations',
    '  in this project.',
    '---',
    '[Details](references/details.md)',
    '[External](https://example.com)',
    '```markdown',
    '[Example only](missing-example.md)',
    '```',
    '',
  ].join('\n'));
  write('.agents/skills/sample-task/references/details.md', 'Task details.\n');
  fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
  fs.symlinkSync('../../.agents/skills/sample-task', path.join(root, '.claude/skills/sample-task'), 'dir');
  const git = spawnSync('git', ['init', '--quiet', root], { env: fixtureEnv, encoding: 'utf8' });
  expect(git.error).toBeUndefined();
  expect(git.status, git.stderr).toBe(0);
});

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('agent instruction CLI', () => {
  it('accepts a portable tree with inline import, relative aliases, and multiline metadata', () => {
    const result = validate();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Instruction checks passed: 1 skills, 6 Markdown files, 0 warnings.');
    expect(result.output).not.toContain('Git ignore checks skipped');
  });

  it('accepts an exported snapshot without Git metadata and reports the skipped ignore check', () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true });
    const result = validate();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Git ignore checks skipped');
  });

  it('allows unrelated ignored private skills without reading their contents', () => {
    write('.gitignore', '/.claude/skills/*\n!/.claude/skills/sample-task\n');
    write('.claude/skills/private-task/SKILL.md', 'Private notes with [unrelated link](missing.md).\n');
    const result = validate();
    expect(result.status, result.output).toBe(0);
  });

  const invalidCases: Array<{ name: string; arrange: () => void; expected: string }> = [
    {
      name: 'broken local link',
      arrange: () => write('docs/agent-workflows.md', '[Missing](missing.md)\n'),
      expected: 'missing local target docs/missing.md',
    },
    {
      name: 'canonical alias with the wrong target',
      arrange: () => {
        fs.unlinkSync(path.join(root, '.claude/skills/sample-task'));
        fs.symlinkSync('../../docs', path.join(root, '.claude/skills/sample-task'), 'dir');
      },
      expected: 'must use a relative symlink to .agents/skills/sample-task',
    },
    {
      name: 'separately maintained canonical alias copy',
      arrange: () => {
        fs.unlinkSync(path.join(root, '.claude/skills/sample-task'));
        write('.claude/skills/sample-task/SKILL.md', 'Copied instructions.\n');
      },
      expected: 'expected a symlink, not a separately maintained copy',
    },
    {
      name: 'ignored shared canonical file',
      arrange: () => write('.gitignore', '/.agents/skills/sample-task/SKILL.md\n'),
      expected: '.agents/skills/sample-task/SKILL.md: active instruction file is ignored by Git',
    },
    {
      name: 'unexpected unignored shared skill',
      arrange: () => write('.claude/skills/extra-task/SKILL.md', 'Unexpected copy.\n'),
      expected: '.claude/skills/extra-task: no corresponding canonical skill',
    },
    {
      name: 'import appearing only in code',
      arrange: () => write('CLAUDE.md', 'Example: `@AGENTS.md`\n```\n@AGENTS.md\n```\n'),
      expected: 'expected an @AGENTS.md import outside code',
    },
    {
      name: 'link outside the project',
      arrange: () => {
        fs.writeFileSync(path.join(temporaryDirectory, 'outside.md'), 'Outside.\n');
        write('AGENTS.md', '[Outside](../outside.md)\n');
      },
      expected: 'path leaves the project',
    },
    {
      name: 'local link whose symlink resolves outside the project',
      arrange: () => {
        const outside = path.join(temporaryDirectory, 'outside.md');
        fs.writeFileSync(outside, 'Outside.\n');
        fs.symlinkSync(outside, path.join(root, 'outside-link.md'));
        write('AGENTS.md', '[Outside](outside-link.md)\n');
      },
      expected: 'symlink resolves outside the project',
    },
  ];

  it.each(invalidCases)('rejects $name', ({ arrange, expected }) => {
    arrange();
    const result = validate();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(expected);
  });
});
