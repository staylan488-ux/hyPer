# Git Cheat Sheet (Hypertrophy App)

This is your quick reference for safe day-to-day Git usage while doing refactors.

## 0) One-time setup

Set your identity (global = all repos on this machine):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Verify:

```bash
git config --global --get user.name
git config --global --get user.email
```

## 1) Start new work safely

Always work in a branch:

```bash
git checkout main
git pull
git checkout -b refactor/<short-name>
```

Example:

```bash
git checkout -b refactor/dashboard-mobile-polish
```

## 2) Check what changed

```bash
git status
git diff
```

## 3) Save a checkpoint commit

Run checks first:

```bash
npm run test
npm run lint
npm run build
```

Then commit:

```bash
git add -A
git commit -m "feat: improve dashboard mobile spacing"
```

## 4) Push your branch to GitHub

First push for a new branch:

```bash
git push -u origin refactor/<short-name>
```

Next pushes:

```bash
git push
```

## 5) Get latest changes from main

```bash
git checkout main
git pull
git checkout refactor/<short-name>
git rebase main
```

If conflicts happen, resolve files, then:

```bash
git add <file>
git rebase --continue
```

## 6) Undo options (most important)

Undo unstaged edits in a file:

```bash
git restore <file>
```

Unstage a file (keep your edits):

```bash
git restore --staged <file>
```

See past commits:

```bash
git log --oneline --decorate -20
```

Hard rollback to a previous commit (destructive):

```bash
git reset --hard <commit-hash>
```

## 7) Useful commit message formats

- `feat:` new user-facing behavior
- `fix:` bug fix
- `refactor:` internal cleanup with same behavior
- `chore:` tooling/setup/docs

Examples:

- `feat: add quick add meal input`
- `fix: preserve workout timer on tab switch`
- `refactor: extract nutrition totals helper`

## 8) Daily safe workflow (copy/paste)

```bash
git checkout main
git pull
git checkout -b refactor/<short-name>

# ... make changes ...

npm run test && npm run lint && npm run build
git add -A
git commit -m "feat: <short description>"
git push -u origin refactor/<short-name>
```

## 9) What to avoid

- Do not commit `.env`.
- Do not work directly on `main` for refactors.
- Do not use `git push --force` unless you know exactly why.
- Do not leave giant uncommitted changes for days; checkpoint often.
