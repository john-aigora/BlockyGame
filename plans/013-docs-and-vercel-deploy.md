# Plan 013: Truthful docs, share-ready metadata, and the Vercel deployment

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plan 001 must be DONE (Vite build exists).
> This plan is written to be executed LAST among 001-012: it documents
> whatever actually shipped. Check `plans/README.md` for which of 002-012 are
> DONE and describe only that reality in the README.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-tooling-baseline.md (hard); 002-012 (soft — document what landed)
- **Category**: docs / deployment
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The stated goal of this whole effort is "deploy it on Vercel." The repo also tells small lies that will confuse the next contributor (including the owners, months from now): the README claims the game "attempts to maintain a target number of food items" (that variable was dead code, removed in plan 002), says "Three.js (r128 via CDN)" (plan 001 moved it to npm), and recommends VS Code Live Server (superseded by `npm run dev`). `push_changes.ps1` is a Windows-era script that re-commits with a hardcoded months-old message — a footgun on the current mac setup. And the page has no favicon or social metadata, so a shared link looks broken-anonymous in chats.

## Current state

- `readme.md` — 69 lines; stale claims at: line 16 ("Three.js (r128 via CDN)"), lines 20-22 (Live Server instructions), line 48 ("The game attempts to maintain a target number of food items on screen (`targetCollectiblesOnScreen`)").
- `push_changes.ps1` — 12-line PowerShell: `git add .` + commit with the hardcoded message "Doc: Update todo.md with comprehensive feature list..." + `git push origin main`.
- `todo.md` — the working wishlist; several items are now DONE (frame-rate independence `todo.md:148`, high scores `:120-124`, sounds `:73-90`, start flow `:113`, shaking/teleporting bugs `:137-139`...). Do not rewrite the file's voice; just mark shipped items.
- `index.html` `<head>` — title + font + stylesheet only; no favicon (browsers request /favicon.ico → 404), no description/OG/theme-color.
- No `vercel.json`, no Vercel project. Git remote: `https://github.com/john-aigora/BlockyGame` (branch `main`). Vite outputs to `dist/`.
- Vercel auto-detects Vite projects: build `vite build`, output `dist` — no `vercel.json` needed for this repo; do not add one.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build | `npm run build` | exit 0, `dist/` populated |
| Local prod preview | `npm run preview` | serves `dist/` on localhost |
| Lint/tests | `npm run lint && npm test` | exit 0 |
| Vercel CLI (if used) | `npx vercel --prod` | prints production URL |

## Scope

**In scope**: `readme.md`, `todo.md`, `index.html` (head only), `public/favicon.svg` (create), `push_changes.ps1` (delete), Vercel project creation (see step 4 authorization note).

**Out of scope**: `grok_tips.md` (historical reference — leave untouched), any src/ change beyond nothing (this plan touches no game code), custom domains, analytics.

## Git workflow

- Branch: `improve/013-docs-and-deploy`
- Commit style: `Doc: ...` / `Chore: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Favicon + head metadata

Create `public/favicon.svg` (Vite serves `public/` at root) — hand-writable SVG of the orange player block, matching the game's palette (#FF4500 body, black eyes):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="4" y="6" width="24" height="24" rx="3" fill="#FF4500"/>
  <rect x="10" y="14" width="4" height="4" fill="#000"/>
  <rect x="18" y="14" width="4" height="4" fill="#000"/>
  <rect x="11" y="22" width="10" height="3" fill="#000"/>
</svg>
```

In `index.html` `<head>`:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="description" content="Blocky Collector 3D — collect blocks, grow huge, hunt the yellow enemies. A fast browser arcade game.">
<meta name="theme-color" content="#004D40">
<meta property="og:title" content="Blocky Collector 3D">
<meta property="og:description" content="Collect. Grow. Hunt the yellow ones. A father/son browser arcade game.">
<meta property="og:type" content="website">
```

**Verify**: `npm run dev` → browser tab shows the orange block icon; no 404 for favicon in the network panel.

### Step 2: README rewrite (truth only)

Rewrite `readme.md` to describe the CURRENT game: what it is (keep the existing good overview voice), controls, scoring (per plan 011 if DONE), project structure (`src/` modules, `tests/`), **How to run** (`npm install`, `npm run dev`, `npm test`, `npm run build`), and a **Deploying** section (step 4's chosen path, written as instructions). Explicitly remove/replace the three stale claims listed in Current state. Keep it under ~100 lines; it's a family project, not an enterprise wiki.

### Step 3: Retire the footgun, refresh the todo

- `git rm push_changes.ps1` (its job is done by normal git usage; the hardcoded message makes it actively harmful).
- `todo.md`: check off (`[x]`) items shipped by plans 001-012 that are DONE per `plans/README.md`, and add a one-line pointer at the top: `> Bug fixes and infra improvements are tracked as plans in plans/ — this file is the feature wishlist.`

**Verify**: `git status` shows the deletion + edits only; `grep -n "targetCollectiblesOnScreen" readme.md` → no matches.

### Step 4: Deploy to Vercel

Two supported paths — **ask the operator which to use if not already specified; do not create accounts**:

- **Path A (recommended, no CLI auth in the sandbox): GitHub integration.** Document in the README: vercel.com → Add New Project → Import `john-aigora/BlockyGame` → framework auto-detected as Vite → Deploy. Every push to `main` auto-deploys. This path is DOCUMENTATION ONLY from the executor's side — a human with the Vercel account clicks through it; the plan is DONE when the docs are written and the build is verified locally.
- **Path B: CLI.** If the operator confirms a logged-in Vercel CLI is available (`npx vercel whoami` succeeds), run `npx vercel` (link/create project, accept Vite defaults) then `npx vercel --prod`, and record the production URL in the README.

Either way, first prove the artifact: `npm run build && npm run preview` → play one run in the preview server (start, collect, die, restart).

**Verify**: Path A — README contains the exact click-path and `npm run build` exits 0. Path B — `curl -sI <production-url>` returns `HTTP/2 200` and the page title contains "Blocky Collector".

## Test plan

No new automated tests (no logic changed). Full gate: `npm run lint && npm test && npm run build` all exit 0. Manual: one complete run in `npm run preview`.

## Done criteria

- [ ] `test -f public/favicon.svg` and head metadata present in `index.html`
- [ ] `readme.md` contains no stale claims (the three listed) and documents npm scripts + deploy path
- [ ] `push_changes.ps1` deleted
- [ ] `npm run lint && npm test && npm run build` all exit 0
- [ ] Deployment: Path A docs written (and human handoff noted in the report) OR Path B production URL live and recorded
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 001 not DONE (no build to deploy).
- `npx vercel` prompts for login/credentials — STOP; account creation and authentication are the operator's/owner's job (Path A exists precisely for this).
- The production build behaves differently from dev (asset path issues) — report with the console error; the likely cause is a hardcoded absolute path that bypassed Vite.

## Maintenance notes

- With the GitHub integration, `main` = production; the family should treat pushing to `main` as "shipping" and use branches for experiments.
- OG metadata has no image yet (`og:image`) — a future nicety: screenshot the game, drop it in `public/og.png`, add the tag.
- If the repo is public, the Vercel URL will be too — that's the point, but say it out loud in the PR so it's a decision, not a surprise.
