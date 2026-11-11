#!/usr/bin/env python3
"""Asks before recursive force deletes, except in Claude's own temp and build folders.

A PreToolUse hook for Bash, wired from ~/.claude/settings.json so it covers
every Claude Code session on this Mac. It replaces the ask rules
"Bash(rm -rf:*)" and "Bash(rm -fr:*)". Those rules stop for a person on every
rm -rf, even one that only clears Claude's own scratch folder, and a hook can't
override them.

This hook asks ("ask" decision) when a command runs rm with both recursive and
force flags (-rf, -fr, -Rf, -r -f, --recursive --force, also through sudo,
xargs, env, timeout, bash -c, eval or find -exec), unless it can prove that
every target is inside one of these:

  - /tmp or /private/tmp (not the whole folder, and not another Claude
    session's scratch tree)
  - the per-user temp folder ($TMPDIR, /var/folders/../T/...)
  - Xcode's DerivedData (single builds, not the whole folder)
  - simulator app data (CoreSimulator/Devices/<id>/data/...)
  - a Claude worktree (<repo>/.claude/worktrees/<name>)

and none of them is the session's working folder or a folder above it.
Anything it can't resolve (an unknown variable, $(...), a pipe into xargs,
an odd shell construct) is treated as "ask". It never allows or denies
anything itself: when it is silent, Claude Code decides as usual.

Run with --self-test to check it, or --install to wire it into
~/.claude/settings.json. --install keeps the original file as
settings.json.before-rm-guard; copying that back undoes everything.
Written 2026-11-11 for the "Cut down Mac permission prompts" thread.
"""

import glob
import json
import os
import re
import shutil
import sys

HOME = os.path.realpath(os.path.expanduser("~"))
TMP_ROOTS = sorted({os.path.realpath("/tmp"), os.path.realpath("/private/tmp")} - {"/"})
VAR_FOLDERS = os.path.realpath("/var/folders")
DERIVED = os.path.join(HOME, "Library/Developer/Xcode/DerivedData")
SIM_DEVICES = os.path.join(HOME, "Library/Developer/CoreSimulator/Devices")
WORKTREE_RE = re.compile(r"/\.claude/worktrees/[^/]+(/|$)")

# Raw text that may hide a recursive delete, used where the command can't be parsed.
RM_RAW = re.compile(r"(^|[\s;&|(){}`'\"=])(\S*/)?rm\s+([^;&|\n]*\s)?(-[A-Za-z]*[rR]|--recursive)")
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
KEYWORDS = {"if", "then", "else", "elif", "do", "while", "until", "!", "fi", "done", "esac"}
# Programs where "rm -rf" as an argument doesn't run rm.
HARMLESS = {"git", "echo", "printf", "grep", "egrep", "fgrep", "rg", "man", "which", "type", "ag",
            "cat", "head", "tail", "less", "jq", "awk", "sed", "tr", "wc", "sort", "uniq", "cut"}


class Ask(Exception):
    """The command may delete something outside the exempt folders."""


class ParseFail(Exception):
    """The command can't be read exactly; ask only if it visibly runs rm -r."""


# ---------------------------------------------------------------- paths

def inside(path, root):
    return path != root and path.startswith(root.rstrip("/") + "/")


def in_tmp(path):
    for r in TMP_ROOTS:
        if inside(path, r):
            rest = path[len(r) + 1:].split("/")
            # Claude's scratch tree (/tmp/claude-<uid>/<project>/<session>/...) is
            # shared by every session: only paths inside one session's folder.
            if re.match(r"claude-\d+$", rest[0]) and len(rest) < 4:
                return False
            return True
    if inside(path, VAR_FOLDERS):
        parts = path[len(VAR_FOLDERS) + 1:].split("/")
        return len(parts) >= 4 and parts[2] == "T"
    return False


def exempt(path):
    if in_tmp(path) or inside(path, DERIVED):
        return True
    if inside(path, SIM_DEVICES):
        parts = path[len(SIM_DEVICES) + 1:].split("/")
        return len(parts) >= 3 and parts[1] == "data"
    return WORKTREE_RE.search(path) is not None


def location(path):
    """The real folder holding path, plus its own name (a symlink is not followed)."""
    base = os.path.basename(path)
    if base in (".", ".."):
        return os.path.realpath(path)
    return os.path.join(os.path.realpath(os.path.dirname(path)), base)


# ---------------------------------------------------------------- lexing

class Word(object):
    """A shell word as pieces: ("lit", text, quoted), ("var", name, quoted),
    ("unknown", raw, quoted) or ("tilde",)."""

    def __init__(self):
        self.pieces = []

    def add(self, kind, val, quoted):
        if kind == "lit" and self.pieces and self.pieces[-1][0] == "lit" and self.pieces[-1][2] == quoted:
            self.pieces[-1] = ("lit", self.pieces[-1][1] + val, quoted)
        else:
            self.pieces.append((kind, val, quoted))

    def literal(self):
        """The text when the word has no expansions, else None."""
        if any(p[0] != "lit" for p in self.pieces):
            return None
        return "".join(p[1] for p in self.pieces)

    def assign(self):
        """(NAME, value Word) of a NAME=value word, or None."""
        if not self.pieces or self.pieces[0][0] != "lit" or self.pieces[0][2]:
            return None
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=", self.pieces[0][1])
        if not m:
            return None
        val = Word()
        first = self.pieces[0][1][m.end():]
        if first.startswith("~"):
            val.pieces.append(("tilde", None, False))  # S=~/x expands the tilde
            first = first[1:]
        if first:
            val.add("lit", first, False)
        for p in self.pieces[1:]:
            val.pieces.append(p)
        return m.group(1), val


def strip_heredocs(cmd):
    """Removes heredoc bodies; Ask if a body may run a recursive delete."""
    out, pending = [], []
    for line in cmd.split("\n"):
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
            elif RM_RAW.search(line):
                raise Ask("heredoc body mentions a recursive rm")
            continue
        out.append(line)
        for m in re.finditer(r"(?<!<)<<-?\s*(['\"]?)([A-Za-z_][\w.-]*)\1", line):
            pending.append(m.group(2))
    return "\n".join(out)


def find_close(cmd, i):
    """Index after the ) matching the ( at cmd[i-1], skipping quotes."""
    depth, n = 1, len(cmd)
    while i < n:
        c = cmd[i]
        if c == "\\":
            i += 2
            continue
        if c == "'":
            j = cmd.find("'", i + 1)
            i = n if j < 0 else j + 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ParseFail("unclosed substitution")


def lex(cmd):
    cmd = cmd.replace("\\\n", "")
    cmd = strip_heredocs(cmd)
    toks = []
    cur = [None]

    def word():
        if cur[0] is None:
            cur[0] = Word()
        return cur[0]

    def finish():
        if cur[0] is not None:
            toks.append(("word", cur[0]))
            cur[0] = None

    def dollar(i, quoted):
        """Reads a $ expansion at cmd[i]; returns the next index."""
        w = word()
        nxt = cmd[i + 1:i + 2]
        if nxt == "(":
            end = find_close(cmd, i + 2)
            inner = cmd[i + 2:end - 1]
            if RM_RAW.search(inner):
                raise Ask("recursive rm inside a substitution")
            w.add("unknown", cmd[i:end], quoted)
            return end
        if nxt == "{":
            end = cmd.find("}", i + 2)
            if end < 0:
                raise ParseFail("open ${")
            body = cmd[i + 2:end]
            if re.match(r"[A-Za-z_][A-Za-z0-9_]*$", body):
                w.add("var", body, quoted)
            else:
                w.add("unknown", cmd[i:end + 1], quoted)
            return end + 1
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", cmd[i + 1:])
        if m:
            w.add("var", m.group(0), quoted)
            return i + 1 + m.end()
        if nxt and nxt in "@*#?$!-0123456789'":
            w.add("unknown", cmd[i:i + 2], quoted)
            return i + 2
        w.add("lit", "$", quoted)
        return i + 1

    i, n = 0, len(cmd)
    while i < n:
        c = cmd[i]
        if c in " \t":
            finish()
            i += 1
        elif c == "\n":
            finish()
            toks.append(("op", ";"))
            i += 1
        elif c == "#" and cur[0] is None:
            j = cmd.find("\n", i)
            i = n if j < 0 else j
        elif c == "'":
            j = cmd.find("'", i + 1)
            if j < 0:
                raise ParseFail("open quote")
            word().add("lit", cmd[i + 1:j], True)
            i = j + 1
        elif c == '"':
            w = word()
            w.add("lit", "", True)
            i += 1
            while True:
                if i >= n:
                    raise ParseFail("open quote")
                d = cmd[i]
                if d == '"':
                    i += 1
                    break
                if d == "\\" and i + 1 < n and cmd[i + 1] in '"\\$`':
                    w.add("lit", cmd[i + 1], True)
                    i += 2
                elif d == "$":
                    i = dollar(i, True)
                elif d == "`":
                    j = cmd.find("`", i + 1)
                    if j < 0:
                        raise ParseFail("open backquote")
                    if RM_RAW.search(cmd[i + 1:j]):
                        raise Ask("recursive rm inside a substitution")
                    w.add("unknown", cmd[i:j + 1], True)
                    i = j + 1
                else:
                    w.add("lit", d, True)
                    i += 1
        elif c == "\\":
            if i + 1 < n:
                word().add("lit", cmd[i + 1], True)
            i += 2
        elif c == "$":
            i = dollar(i, False)
        elif c == "`":
            j = cmd.find("`", i + 1)
            if j < 0:
                raise ParseFail("open backquote")
            if RM_RAW.search(cmd[i + 1:j]):
                raise Ask("recursive rm inside a substitution")
            word().add("unknown", cmd[i:j + 1], False)
            i = j + 1
        elif c in "<>":
            # A redirection: drop the operator and its target word.
            finish()
            if cur[0] is None and toks and toks[-1][0] == "word" and toks[-1][1].literal() is not None \
                    and toks[-1][1].literal().isdigit():
                toks.pop()  # the fd number
            j = i
            while j < n and cmd[j] in "<>&|-":
                j += 1
            if cmd[i:j].endswith("&-"):
                i = j
                continue  # closes a descriptor, no target
            if cmd[i:j].endswith("&") and j < n and cmd[j].isdigit():
                i = j + 1
                continue
            while j < n and cmd[j] in " \t":
                j += 1
            toks.append(("redir", cmd[i:j].strip()))
            i = j
            if cmd[i:i + 1] == "(":
                raise ParseFail("process substitution")
            # The target is the next word; mark it so segments() drops it.
            toks.append(("redir-target", None))
        elif c in "&|;":
            finish()
            if cmd[i:i + 2] in ("&&", "||", ";;", "|&"):
                op = cmd[i:i + 2]
            elif cmd[i:i + 2] == "&>":
                toks.append(("redir", "&>"))
                toks.append(("redir-target", None))
                i += 2
                continue
            else:
                op = c
            toks.append(("op", op))
            i += len(op)
        elif cur[0] is None and (c in "()" or (c in "{}" and (i + 1 >= n or cmd[i + 1] in " \t\n;&|)"))):
            if c == "(" and i + 1 < n and cmd[i + 1] == "(":
                end = find_close(cmd, i + 2)
                toks.append(("group", "(("))  # arithmetic may set variables
                i = end + 1 if cmd[end:end + 1] == ")" else end
                continue
            finish()
            toks.append(("group", c))
            i += 1
        else:
            w = word()
            if c == "~" and not w.pieces:
                w.pieces.append(("tilde", None, False))
            else:
                w.add("lit", c, False)
            i += 1
    finish()
    return toks


def segments(toks):
    """Simple commands, each with the operator after it; groups reset state."""
    segs, words, skip = [], [], False
    for kind, val in toks:
        if kind == "redir-target":
            skip = True
            continue
        if kind == "word":
            if skip:
                skip = False
                continue
            words.append(val)
            continue
        if kind == "redir":
            continue
        skip = False
        if words or kind == "group":
            segs.append({"words": words, "op": val if kind == "op" else None, "group": kind == "group"})
        words = []
    if words:
        segs.append({"words": words, "op": None, "group": False})
    return segs


# ---------------------------------------------------------------- evaluation

class Ctx(object):
    def __init__(self, cwd, env=None):
        self.cwd = cwd
        self.start = cwd
        self.vars = {"HOME": HOME}
        tmpdir = os.environ.get("TMPDIR")
        if tmpdir:
            self.vars["TMPDIR"] = tmpdir
        if env:
            self.vars.update(env)


def expand(w, ctx):
    """(text, glob) for a word, or None if it can't be known exactly."""
    text, is_glob = "", False
    for k, piece in enumerate(w.pieces):
        kind, val, quoted = piece
        if kind == "tilde":
            nxt = w.pieces[1][1] if len(w.pieces) > 1 and w.pieces[1][0] == "lit" else ""
            if len(w.pieces) == 1 or nxt.startswith("/"):
                text += HOME
                continue
            return None
        if kind == "unknown":
            return None
        if kind == "var":
            if val not in ctx.vars:
                return None
            v = ctx.vars[val]
            if not quoted and (re.search(r"\s", v) or re.search(r"[*?\[]", v) or v == ""):
                return None  # word splitting or globbing of the value
            text += v
            continue
        if not quoted and re.search(r"[*?\[]", val):
            is_glob = True
        if not quoted and "{" in val and ("," in val or ".." in val):
            return None  # brace expansion
        text += val
    return text, is_glob


def target_ok(w, ctx):
    got = expand(w, ctx)
    if got is None:
        return False
    text, is_glob = got
    if not text:
        return False
    if not os.path.isabs(text):
        if not ctx.cwd:
            return False
        text = os.path.join(ctx.cwd, text)
    p = text
    if is_glob:
        folder, base = os.path.dirname(p), os.path.basename(p)
        if re.search(r"[*?\[]", folder):
            return False
        # A pattern inside an exempt folder is fine; at the top of a root (/tmp,
        # DerivedData) it needs a name prefix, so no "root/*" sweeps.
        if not exempt(os.path.realpath(folder)) and len(re.split(r"[*?\[]", base)[0]) < 3:
            return False
        matches = glob.glob(p) or [p]
    else:
        matches = [p]
    for m in matches:
        r = os.path.realpath(m)
        for c in (ctx.cwd, ctx.start):
            if c and (r == c or inside(c, r)):
                return False  # never the working folder or a folder above it
        loc = location(m.rstrip("/") or "/")
        if os.path.islink(m.rstrip("/")) and not text.endswith("/"):
            if not exempt(loc):
                return False
        elif not (exempt(r) and exempt(loc)):
            return False
    return True


def rm_flags(words, ctx):
    """(recursive, force, targets) for rm's arguments."""
    rec = force = False
    targets, ended = [], False
    for w in words:
        lit = w.literal()
        if not ended and lit == "--":
            ended = True
        elif not ended and lit is not None and lit.startswith("--"):
            rec = rec or lit == "--recursive"
            force = force or lit == "--force"
        elif not ended and lit is not None and lit.startswith("-") and len(lit) > 1:
            rec = rec or "r" in lit or "R" in lit
            force = force or "f" in lit
        else:
            targets.append(w)
    return rec, force, targets


def lit_or_none(w):
    return w.literal()


def check_command(words, ctx, depth):
    """Raises Ask if this simple command may delete outside the exempt folders."""
    i = 0
    # Leading NAME=value words apply only to this command.
    while i < len(words) and words[i].assign():
        i += 1
    via_xargs = False
    while i < len(words):
        name = lit_or_none(words[i])
        if name is None:
            if any(p[0] == "unknown" or p[0] == "var" for p in words[i].pieces) and \
                    any(lit_or_none(w) and re.match(r"^-[A-Za-z]*[rR]", lit_or_none(w)) for w in words[i + 1:]):
                raise Ask("unknown program with recursive flags")
            return
        base = os.path.basename(name)
        args = words[i + 1:]
        if base in KEYWORDS:
            i += 1
            continue
        if base in ("cd", "pushd", "popd", "source", "."):
            ctx.cwd = None  # a folder change we don't follow
            ctx.vars = {"HOME": HOME}
            return
        if base in ("time", "nohup", "command", "builtin", "exec", "caffeinate"):
            i += 1
            while i < len(words) and (lit_or_none(words[i]) or "").startswith("-"):
                i += 1
            continue
        if base in ("sudo", "doas"):
            i += 1
            while i < len(words) and (lit_or_none(words[i]) or "").startswith("-"):
                if lit_or_none(words[i]) in ("-u", "-g", "-C", "-p", "-h", "-U", "-r", "-t"):
                    i += 1
                i += 1
            continue
        if base == "nice":
            i += 1
            if (lit_or_none(words[i]) if i < len(words) else "") == "-n":
                i += 2
            continue
        if base == "timeout":
            i += 1
            while i < len(words) and (lit_or_none(words[i]) or "").startswith("-"):
                if lit_or_none(words[i]) in ("-s", "-k", "--signal", "--kill-after"):
                    i += 1
                i += 1
            i += 1  # the duration
            continue
        if base == "env":
            i += 1
            while i < len(words):
                t = lit_or_none(words[i]) or ""
                if words[i].assign():
                    i += 1
                elif t in ("-u", "-C", "-S", "-P"):
                    i += 2
                elif t.startswith("-"):
                    i += 1
                else:
                    break
            continue
        if base == "xargs":
            via_xargs = True
            i += 1
            while i < len(words) and (lit_or_none(words[i]) or "").startswith("-"):
                if lit_or_none(words[i]) in ("-I", "-n", "-L", "-P", "-d", "-E", "-s", "-J", "-R", "-S"):
                    i += 1
                i += 1
            continue
        if base == "rm":
            rec, force, targets = rm_flags(args, ctx)
            if not (rec and force):
                return
            if via_xargs or not targets:
                raise Ask("rm -rf with targets from input")
            for w in targets:
                if not target_ok(w, ctx):
                    raise Ask("rm -rf outside Claude's temp and build folders")
            return
        if base in SHELLS:
            lits = [lit_or_none(w) for w in args]
            if any(l and l.startswith("-") and "c" in l and not l.startswith("--") for l in lits):
                k = next(j for j, l in enumerate(lits) if l and l.startswith("-") and "c" in l)
                if k + 1 >= len(args):
                    return
                inner = expand(args[k + 1], ctx)
                if inner is None:
                    raise ParseFail("shell -c with an unknown script")
                analyze(inner[0], ctx.cwd, depth + 1)
            return
        if base == "eval":
            parts = [expand(w, ctx) for w in args]
            if any(p is None for p in parts):
                raise ParseFail("eval of unknown text")
            sub = Ctx(ctx.cwd)
            sub.vars = dict(ctx.vars)
            analyze(" ".join(p[0] for p in parts), ctx.cwd, depth + 1, sub)
            return
        if base == "find":
            for k, w in enumerate(args):
                if lit_or_none(w) in ("-exec", "-execdir", "-ok", "-okdir") and k + 1 < len(args):
                    prog = lit_or_none(args[k + 1])
                    if prog is None or os.path.basename(prog) in SHELLS:
                        raise Ask("find -exec of an unknown or shell program")
                    if os.path.basename(prog) == "rm":
                        rec, force, _ = rm_flags(args[k + 2:], ctx)
                        if rec and force:
                            raise Ask("find -exec rm -rf")
            return
        if base not in HARMLESS:
            # Another program that runs a command, such as watch rm -rf x.
            for k, w in enumerate(args):
                if os.path.basename(lit_or_none(w) or "") == "rm":
                    rec, force, _ = rm_flags(args[k + 1:], ctx)
                    if rec and force:
                        raise Ask("rm -rf run through " + base)
        return


def analyze(cmd, cwd, depth=0, ctx=None):
    if depth > 3:
        raise ParseFail("nested too deep")
    ctx = ctx or Ctx(cwd)
    segs = segments(lex(cmd))
    prev_op = None
    for k, seg in enumerate(segs):
        if seg["group"]:
            # Subshells and groups: cd and assignments inside may not last.
            ctx.cwd = None
            ctx.vars = {"HOME": HOME}
            prev_op = seg["op"]
            continue
        words = seg["words"]
        while words and words[0].literal() in KEYWORDS:
            words = words[1:]
        if not words:
            prev_op = seg["op"]
            continue
        piped = seg["op"] in ("|", "|&") or prev_op in ("|", "|&")
        lead = words[0].pieces[0][1] if words[0].pieces and words[0].pieces[0][0] == "lit" else ""
        odd = re.match(r"([A-Za-z_][A-Za-z0-9_]*)(\[[^]]*\])?\+=|([A-Za-z_][A-Za-z0-9_]*)\[", lead)
        if odd:
            ctx.vars.pop(odd.group(1) or odd.group(3), None)
            prev_op = seg["op"]
            continue
        # A segment of only NAME=value words sets shell variables.
        if all(w.assign() for w in words):
            for w in words:
                name, val = w.assign()
                got = expand(val, ctx)
                if got is None or piped:
                    ctx.vars.pop(name, None)
                else:
                    ctx.vars[name] = got[0]
        else:
            first = lit_or_none(words[0])
            if first in ("export", "declare", "local", "readonly", "typeset"):
                for w in words[1:]:
                    a = w.assign()
                    if a:
                        got = expand(a[1], ctx)
                        if got is None or piped:
                            ctx.vars.pop(a[0], None)
                        else:
                            ctx.vars[a[0]] = got[0]
            elif first in ("unset", "read", "mapfile", "readarray", "getopts", "for", "select"):
                for w in words[1:]:
                    ctx.vars.pop(lit_or_none(w) or "", None)
                if first not in ("unset", "for", "select"):
                    check_command(words, ctx, depth)
            elif first in ("source", ".") or (first == "printf" and any(lit_or_none(w) == "-v" for w in words)):
                ctx.vars = {"HOME": HOME}
                ctx.cwd = None if first != "printf" else ctx.cwd
            elif first == "cd":
                arg = words[1] if len(words) > 1 else None
                new = None
                if arg is None:
                    new = HOME
                elif len(words) == 2:
                    got = expand(arg, ctx)
                    if got and not got[1] and got[0] and not got[0].startswith("-"):
                        if os.path.isabs(got[0]):
                            new = os.path.realpath(got[0])
                        elif ctx.cwd and not os.environ.get("CDPATH"):
                            new = os.path.realpath(os.path.join(ctx.cwd, got[0]))
                            if not os.path.isdir(new):
                                new = None
                if new and (piped or (seg["op"] != "&&" and not os.path.isdir(new))):
                    new = None  # cd in a pipe doesn't last; a failed cd leaves cwd as it was
                ctx.cwd = new
            elif first in ("pushd", "popd"):
                ctx.cwd = None
            else:
                check_command(words, ctx, depth)
        prev_op = seg["op"]


def decide(data):
    if data.get("tool_name") != "Bash":
        return None
    cmd = (data.get("tool_input") or {}).get("command")
    if not isinstance(cmd, str) or not re.search(r"\brm\b|\beval\b|-c\b|xargs|-exec", cmd):
        return None
    cwd = data.get("cwd")
    cwd = os.path.realpath(cwd) if cwd else None
    try:
        analyze(cmd, cwd)
    except Ask as e:
        return str(e)
    except Exception:
        if RM_RAW.search(cmd):
            return "could not check this command"
    return None


def main():
    if sys.argv[1:] == ["--self-test"]:
        return self_test()
    if sys.argv[1:] == ["--install"]:
        return install()
    reason = None
    try:
        reason = decide(json.load(sys.stdin))
    except Exception:
        reason = None
    if reason:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "Recursive delete: %s (~/.claude/hooks/rm-guard.py)" % reason,
        }}))
    return 0


# ---------------------------------------------------------------- install

HOOK_CMD = '/usr/bin/python3 "$HOME/.claude/hooks/rm-guard.py"; exit 0'
OLD_ASK = ("Bash(rm -rf:*)", "Bash(rm -fr:*)")
PROD_READS = (
    "Read-only checks of the hyPer production Supabase project (ref nnwfaaxmyvqsdnfcdxom): "
    "supabase link, projects list, functions list and functions download, secrets list "
    "(names only), storage ls or storage cp FROM the project into a temp folder, and "
    "supabase db query --linked whose SQL only reads (SELECT, SHOW, EXPLAIN without ANALYZE; "
    "no INSERT, UPDATE, DELETE, DDL, GRANT, or functions that change data). Any production "
    "write, migration, deploy, secrets set, storage upload or delete still needs explicit "
    "words from the user in that session."
)


def install():
    if self_test(quiet=True) != 0:
        print("rm-guard self-test failed; settings left unchanged.")
        return 1
    p = os.path.expanduser("~/.claude/settings.json")
    backup = p + ".before-rm-guard"
    if not os.path.exists(backup):  # keep the first, untouched copy
        shutil.copy(p, backup)
    with open(p) as f:
        s = json.load(f)
    hooks = s.get("hooks") or {}
    pre = hooks.get("PreToolUse") or []
    if not any(h.get("command") == HOOK_CMD for e in pre for h in (e.get("hooks") or [])):
        pre.append({"matcher": "Bash", "hooks": [{"type": "command", "command": HOOK_CMD, "timeout": 10}]})
    hooks["PreToolUse"] = pre
    s["hooks"] = hooks
    perm = s.setdefault("permissions", {})
    perm["ask"] = [r for r in perm.get("ask", []) if r not in OLD_ASK]
    am = s.get("autoMode")
    if not isinstance(am, dict):
        am = {}
    allow = am.get("allow")
    if not isinstance(allow, list):
        allow = ["$defaults"]
    if PROD_READS not in allow:
        allow.append(PROD_READS)
    am["allow"] = allow
    s["autoMode"] = am
    tmp = p + ".tmp-rm-guard"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(tmp) as f:
        json.load(f)
    os.replace(tmp, p)
    print("Installed. Backup: " + backup)
    print("Ask rules kept: " + ", ".join(perm["ask"]))
    self_test()
    return 0


# ---------------------------------------------------------------- self-test

def self_test(quiet=False):
    repo = os.path.join(HOME, "orca/hyPer")
    wt = repo + "/.claude/worktrees/objective-jennings-f3bad2"
    sp = "/private/tmp/claude-501/-Users-sinan-orca-hyPer--claude-worktrees-objective-jennings-f3bad2/f389885c-4bbb-4de1-9127-e349ff5f8343/scratchpad"
    sq = "/private/tmp/claude-501/-Users-sinan-orca-hyPer--claude-worktrees-quirky-maxwell-67c881/55d5f28a-4b46-441b-a005-a679066b8856/scratchpad"
    dd = HOME + "/Library/Developer/Xcode/DerivedData"
    # A link in /tmp that points into the home folder.
    link = os.path.join(TMP_ROOTS[-1], "rm-guard-selftest-%d" % os.getpid())
    try:
        os.symlink(os.path.join(HOME, "Music"), link)
    except OSError:
        pass
    silent = [
        # The eight commands that stopped for Sinan on 2026-11-11 (shapes as run).
        (wt, 'pkill -f "scratchpad/pr226/native.*expo start" ; sleep 2; lsof -nP -iTCP:8081 -sTCP:LISTEN | tail -n +2 | head -3; rm -rf '
         + dd + '/hyPerNative-aymcysdgoinzqndzkjtjigyixeyh ' + sp + '/probe/dd; cd ' + wt + ' && git -C ' + sp
         + '/pr226 status --short | head; git worktree remove --force ' + sp + '/pr226 && git worktree prune && git worktree list | grep -c pr226; ls '
         + sp + '/; df -h / | tail -1'),
        (wt, 'S=' + sp + '; rm -rf $S/probe; pgrep -fl "xcodebuild|expo start" | head; ls $S'),
        (wt, 'S=' + sp + "; python3 -I - $S/ledgerdl <<'EOF'\nimport json, sys\nprint(sum([1, 2]))\nEOF\nrm -rf $S/ledgerdl; ls $S"),
        (wt, 'S=' + sp + "; mkdir -p $S/ledgerdl; supabase storage cp -r ss:///food-analysis-ledger/food-v1 $S/ledgerdl --experimental --linked --workdir $S/sbwork >/dev/null 2>&1; python3 -I - $S/ledgerdl <<'EOF'\nprint(1)\nEOF\nrm -rf $S/ledgerdl; test -d $S/ledgerdl && echo STILL-THERE || echo copies-deleted"),
        (wt, 'S=' + sp + '; rm -rf $S/deployed $S/sbwork $S/asc_apps.json $S/out_inventory.json; ls $S; cd ' + wt + ' && git status --short | head; ls supabase/.temp 2>/dev/null'),
        (wt, 'S=' + sp + '; cd ' + wt + '; rm -r supabase/.temp; rm -rf $S/sql; git status --short | wc -l'),
        (wt, 'cat ' + HOME + '/.claude/projects/x/memory/a.md; cd ' + wt + '; rm -rf ' + sq + '/wd; grep -n -i "exercise" supabase/schema.sql | head -80'),
        (wt, 'rm -rf ' + sq + '/wd; ls ' + sq + '/; cd ' + wt + ' && git status --short | head'),
        # Other routine shapes.
        (repo, 'rm -rf "$TMPDIR/hyper-x"' if os.environ.get("TMPDIR") else 'rm -rf /tmp/hyper-x'),
        (repo, 'rm -rf ~/Library/Developer/Xcode/DerivedData/hyPerNative-*'),
        (repo, 'rm -rf .claude/worktrees/old-wt'),
        (repo, 'git rm -rf --cached x'),
        (repo, 'echo "rm -rf ~"'),
        (repo, 'rm -r build'),
        (repo, 'rm -f notes.txt'),
        (repo, 'npm run build && ls dist'),
        (repo, 'for f in a b; do echo $f; done; rm -rf /tmp/hyper-x'),
        (repo, "python3 -c 'print((1))'; ((i++)); rm -rf /tmp/hyper-x"),
        (repo, 'rm -rf ' + link),
        (repo, 'rm -rf /tmp/a/b/../c'),
    ]
    ask = [
        (repo, 'rm -rf ~/Documents'),
        (repo, 'rm -rf /tmp/x ~/Documents'),
        (repo, 'rm -Rf ~/Music'),
        (repo, 'rm -r -f ~/Music'),
        (repo, 'rm --recursive --force ~/Music'),
        (repo, '/bin/rm -rf ~/Music'),
        (repo, 'sudo rm -rf /'),
        (repo, 'rm -rf build'),
        (repo, 'rm -rf .'),
        (wt, 'rm -rf ' + wt),
        (repo, 'rm -rf /private/tmp/*'),
        (repo, 'rm -rf /private/tmp'),
        (repo, 'rm -rf /private/tmp/claude-501'),
        (repo, 'rm -rf ' + dd),
        (repo, 'rm -rf $UNKNOWN/'),
        (repo, 'S=/tmp/x; rm -rf $S/../../' + HOME.lstrip("/")),
        (repo, 'S="/tmp/a ' + HOME + '/Documents"; rm -rf $S'),
        (repo, 'S=$(pwd); rm -rf $S'),
        (repo, 'rm -rf "$(pwd)"'),
        (repo, 'cd ~ && rm -rf Documents'),
        (HOME, '(cd /tmp/x); rm -rf Documents'),
        (repo, 'find . -name x | xargs rm -rf'),
        (repo, 'find ~ -name x -exec rm -rf {} +'),
        (repo, "bash -c 'rm -rf ~/Music'"),
        (repo, 'eval "rm -rf ~/Music"'),
        (repo, "bash <<'EOF'\nrm -rf ~/Music\nEOF"),
        (repo, 'ls; rm -rf ~/Pictures/x'),
        (repo, 'cd /tmp/x/does-not-exist; rm -rf Documents'),
        (repo, 'time rm -rf ~/Movies'),
        (repo, 'env FOO=1 rm -rf ~/Movies'),
        (repo, 'rm -rf -- ~/Movies'),
        (repo, 'S=/tmp/a; S+=/../../Users/x; rm -rf $S'),
        (repo, 'd=/tmp/x; for d in ~/Music; do rm -rf $d; done'),
        (repo, 'S=~/Music; rm -rf $S'),
        (repo, 'rm -rf /tmp/x/{..,../../Users}'),
        ("/tmp", 'if true; then cd ~ && rm -rf Music; fi'),
        ("/tmp", 'command cd ~; rm -rf Music'),
        ("/tmp", 'cd -P ~ && rm -rf Music'),
        (repo, 'watch rm -rf ~/Music'),
        (repo, 'rm -rf ' + link + '/'),
        (repo, 'rm -rf ' + link + '/../Music'),
    ]
    bad = 0
    for cwd, cmd in silent:
        got = decide({"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": cwd})
        if got:
            bad += 1
            print("SHOULD NOT ASK (%s): %s" % (got, cmd[:160]))
    for cwd, cmd in ask:
        got = decide({"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": cwd})
        if not got:
            bad += 1
            print("SHOULD ASK: " + cmd[:160])
    try:
        os.remove(link)
    except OSError:
        pass
    total = len(silent) + len(ask)
    if not quiet or bad:
        print("rm-guard self-test: %d of %d checks pass (home %s)" % (total - bad, total, HOME))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
