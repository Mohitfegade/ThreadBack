# Project Memory

> **Never lose your project context again.**

A zero-dependency Node.js CLI tool that scans your codebase, tracks features, records work sessions, and generates structured briefs — so you (or your AI pair programmer) can pick up exactly where you left off.

## The Problem

Every developer knows the pain: you return to a project after days away and spend 30+ minutes just remembering what you were doing, what's broken, and what to work on next. AI coding assistants are even worse at this — they have zero memory between sessions.

**Project Memory** solves this by deterministically scanning your repo and building a structured knowledge base that answers 5 critical questions:

1. **What is this project?** — Stack, purpose, setup commands
2. **What state is it in?** — Feature status counts, dirty tree warnings
3. **What happened last session?** — Completed work, decisions, blockers
4. **What is unfinished or uncertain?** — Incomplete features, TODOs, stale evidence
5. **What should I do first?** — 3 prioritized next actions with evidence

## Quick Start

```bash
# 1. Scan your repository
node bin/pm.js scan /path/to/your/project

# 2. Record a work session when you're done
node bin/pm.js checkin /path/to/your/project

# 3. Get a structured brief next time you sit down
node bin/pm.js brief /path/to/your/project
```

Or run the interactive demo:

```bash
node bin/pm.js demo
```

## Example Output

```
═══════════════════════════════════════════════════════════
  PROJECT BRIEF — giftly-app
═══════════════════════════════════════════════════════════

  1. WHAT IS THIS PROJECT?
  Name:    giftly-app
  Purpose: A modern gift-page creation platform...
  Stack:   Next.js, React, Prisma, Stripe, Tailwind CSS

  2. WHAT STATE IS IT IN?
  ● Implemented: 4   ◐ Incomplete: 2   ○ Planned: 3
  ⚠ Working tree is dirty (2 uncommitted files)

  5. WHAT SHOULD I DO FIRST?
  1. Implement the image upload handler with presigned URLs
     Why: Developer's own recorded next step from last session
  2. Fix incomplete feature: File Storage & Uploads
     Why: Has 3 TODO/placeholder markers
  3. Fix incomplete feature: Payments & Billing
     Why: Handler returns HTTP 501 Not Implemented
```

## Commands

| Command | Description |
|---------|-------------|
| `pm scan [path]` | Walk and analyze codebase, tech stack, git state & TODOs |
| `pm checkin [path]` | Interactive check-in to record a work session |
| `pm brief [path]` | Generate structured project brief answering 5 key questions |
| `pm status [path]` | Display dashboard and generate STATUS.md |
| `pm demo` | Run the full flow against a bundled demo repository |

### Non-Interactive Check-in

For scripting and CI/CD:

```bash
node bin/pm.js checkin --completed "Finished auth flow" \
  --decision "Used JWT" --rationale "Simpler than sessions" \
  --blockers "Stripe webhook not configured" \
  --next "Set up webhook handler" -y
```

## Feature Status Model

Project Memory tracks features with a deterministic status model:

| Status | Meaning | How It's Determined |
|--------|---------|---------------------|
| `implemented` | Source files exist, no placeholders or TODOs | Files scanned, no 501/placeholder/TODO markers |
| `incomplete` | Code exists but has TODO, FIXME, placeholder, or 501 | Pattern matching in source files |
| `planned` | Schema/declaration only, no service code | e.g., Prisma model with no route handler |
| `unknown` | Insufficient evidence | Needs manual review |

### Verification Rules

- **`verified`** = A recorded test run passed for this feature at the current commit
- **`unverified`** = Default. File existence is never proof of working
- **Stale evidence** = Feature files changed since the last scan — needs re-verification

## Data Storage

All data is stored in `.project-memory/` inside the target repository:

```
.project-memory/
├── scan.json       # Full repository scan results
├── ledger.json     # Feature ledger with status and evidence
├── sessions.json   # Work session history
└── brief.json      # Latest structured brief
```

Additionally, `STATUS.md` is generated at the repo root.

## Privacy & Safety

- **Strictly read-only** with respect to your source code
- Only writes inside `.project-memory/` and `STATUS.md`
- Automatically ignores: `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`
- Never reads: `.env*` (except `.env.example`), `*.pem`, `*.key`, lockfiles
- Skips files > 500KB
- Zero external dependencies — only Node.js built-in modules

## Known Limitations

- **JS/TS only** — Feature detection focuses on JavaScript/TypeScript ecosystems (Next.js, Express, Prisma, etc.)
- **No test execution** — Verification requires a recorded test run; the tool does not execute tests itself
- **Heuristic-based** — Feature discovery uses pattern matching (file paths, route patterns, dependency lists) which may miss custom architectures
- **Read-only** — Cannot modify source code, run builds, or execute commands on the target repo
- **Single-repo** — Designed for monolithic repositories; monorepo support is not yet implemented

## Requirements

- Node.js v20+
- Git (for commit history analysis; degrades gracefully without it)

## License

MIT
