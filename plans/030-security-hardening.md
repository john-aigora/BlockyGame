# Plan 030: Security hardening — scope the CSP per page, fix the two dev-tree advisories, add the .env safety net

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- vercel.json .gitignore package-lock.json readme.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a wrong CSP breaks pages at DEPLOY time, not build time — the verification story below is mandatory)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

Commit `fd99e1e` added a site-wide CSP — a net gain over no CSP — but it
promoted `'unsafe-inline'` and the whole `https://cdnjs.cloudflare.com`
origin into `script-src` for EVERY path, including the live game page, which
needs neither (Vite externalizes the gate bootstrap into a hashed asset
file). The primary XSS mitigation a CSP offers is therefore disabled on the
one page that touches player storage. Separately, `npm audit` reports two
high-severity advisories in the dev tree (both fixable in one command, both
unreachable from the shipped bundle), and the root `.gitignore` has no
`.env` pattern on a PUBLIC repo — today only `video/.gitignore` protects the
one real credential.

## Current state (verified excerpts)

### `vercel.json` (the whole file, at `c1ffd13`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
        }
      ]
    }
  ]
}
```

### What each page actually needs (enumerated by reading every tag; re-verify before editing)

| Page | script needs | style needs |
|---|---|---|
| `/` (index.html → dist) | self ONLY — the inline module at `index.html:175` is externalized by Vite into `/assets/index-*.js` (verify: `npm run build && grep -c "<script" dist/index.html` and confirm the tag has `src=`, no inline body; `grep -c cdnjs dist/index.html` → 0) | self + `'unsafe-inline'` (4 inline `style="…"` attributes) + fonts.googleapis.com; font-src fonts.gstatic.com |
| `/original.html` | `'unsafe-inline'` (inline `onload` attribute on the iframe, `public/original.html:34`) | inline `<style>` |
| `/original/…` (byte-frozen museum — NEVER edit) | `'unsafe-inline'` + the ONE cdnjs three.js r128 file (`public/original/index.html:10`) | self + inline |
| `/pad-test.html` | `'unsafe-inline'` (one big inline `<script>`) | inline |

- No page uses `eval`/`new Function` (three.module.js verified clean), no
  Workers, no media elements, no cross-origin fetch — `connect-src 'self'`
  and the `default-src` fallbacks are correct as-is.
- The gate form (`index.html:27`) has no `action` and is `preventDefault`ed
  (`src/gate.js:43`) — `form-action 'self'` is safe to add; `form-action`
  does NOT inherit from `default-src`.

### npm audit (run live on 2026-08-14 — root project)

```
brace-expansion  4.0.0 - 5.0.8   Severity: high   GHSA-rgw5-rvv9-x895   fix available via `npm audit fix`
nanoid  <3.3.18                  Severity: high   GHSA-2v37-7h3g-55p8   fix available via `npm audit fix`
```

Reachability (verified via the lockfile): both are `"dev": true`;
`brace-expansion` ← `minimatch` ← ESLint chain; `nanoid` ← `postcss` ←
Vite. 121 of 122 lockfile entries are dev; the ONLY production dependency is
`three@0.128.0`. So both advisories are dev-machine/CI-only — the fix is
hygiene, not an emergency, and it CANNOT change `dist/` output. NOTE: these
are 2026 advisories; do not second-guess them against older advisory data —
re-run `npm audit` yourself and trust its output.

### `.gitignore` (root) — has NO `.env` pattern

Verified: `grep -n env .gitignore` → no matches. `video/.env` (a Google
Gemini API key — location stated, value never to be reproduced) is protected
only by `video/.gitignore:8`; it is untracked and absent from all-refs
history (verified). The repo is public.

### CI (context)

`.github/workflows/ci.yml` runs `npm ci` + lint + Playwright. Vercel headers
apply ONLY in production — neither `vite dev` nor `vite preview` serves
`vercel.json` headers, so no local test can validate the CSP end-to-end.
Verification is by tag-enumeration (the table above) + a post-deploy manual
check (Step 5).

## Commands you will need

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Audit | `npm audit` | starts at: 2 high |
| Fix | `npm audit fix` | exit 0, lockfile-only change |
| Re-audit | `npm audit` | `found 0 vulnerabilities` |
| Lint | `npm run lint` | exit 0 |
| Suite | `npm test` | all pass (~8-9 min; never two suites at once) |
| Build | `npm run build` | exit 0 |
| video audit | `cd video && npm audit; cd ..` | record the result, whatever it is |

## Scope

**In scope:** `vercel.json`, `.gitignore`, `package-lock.json` (via
`npm audit fix` only), `readme.md` (deploy-notes paragraph only),
`video/.env.example` (NEW — key NAME only, never a value),
`plans/README.md` (status row).

**Out of scope (do NOT touch):** `public/original/**` and
`public/original.html` (byte-frozen museum + its wrapper — the CSP work
must be done entirely in `vercel.json`); `package.json` (no dep bumps beyond
what `npm audit fix` writes to the lockfile); `src/**`, `tests/**`,
`index.html`; `video/**` beyond adding `.env.example`; the in-app gate
(by-design soft — do not "harden" it).

## Git workflow

- Branch: `chore/030-security-hardening` off `main`.
- One commit per step. Do NOT push or open a PR unless the operator
  instructed it.

## Steps

### Step 1: `npm audit fix` (root)

Run it; confirm `git status` shows ONLY `package-lock.json` changed. Then
`npm run lint` → 0, `npm run build` → 0, and `npm audit` → 0 vulnerabilities.
Record the video/ tree's own `npm audit` result in the commit message body
(do not fix video/ in this plan — it is not on any deploy path; just record).

**Verify**: `npm audit` → `found 0 vulnerabilities`; `git diff --stat` →
`package-lock.json` only.

### Step 2: Scope the CSP per page in `vercel.json`

Rewrite `vercel.json` to four header blocks. Vercel matches ALL matching
`source` patterns and later blocks override same-named headers, so order the
general block first and the specific ones after it:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
        }
      ]
    },
    {
      "source": "/original.html",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
        }
      ]
    },
    {
      "source": "/original/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
        }
      ]
    },
    {
      "source": "/pad-test.html",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
        }
      ]
    }
  ]
}
```

Before committing, RE-VERIFY the museum page's exact cdnjs URL:
`grep cdnjs public/original/index.html` — the path-scoped source expression
above must match it character-for-character (scheme+host+path). Also confirm
`public/original/index.html` pulls its fonts the way the block assumes:
`grep -n "fonts\." public/original/index.html public/original/style.css` —
if it does NOT reference Google Fonts, you may drop the fonts sources from
the `/original/(.*)` block; if it does via style.css `@import`, keep them.

**Verify**: `python3 -c "import json; json.load(open('vercel.json'))"` →
no output (valid JSON); `npm run build` → 0.

### Step 3: Root `.gitignore` safety net

Append:

```
# Env files: never commit credentials (video/.env holds a real API key;
# this is the repo-wide net so a future .env anywhere is caught too)
.env
.env.*
!.env.example
```

**Verify**: `git check-ignore -v video/.env` still resolves;
`touch .env && git status --porcelain | grep -c "\.env$"` → `0`; then `rm .env`.

### Step 4: `video/.env.example` + readme note

Create `video/.env.example` containing exactly one line naming the variable
(read `video/README.md:59-60,88` first to copy the variable's exact name;
NEVER copy a value):

```
GEMINI_API_KEY=
```

In `readme.md`'s deploy section (the paragraph around lines 187-189), amend
the `vercel.json` sentence to say the CSP is per-page-scoped and that the
`/original` archive deliberately uses a path-scoped CDN allowance instead of
SRI (the archive is byte-frozen and cannot carry an `integrity` attribute).

**Verify**: `npm run lint` → 0; `git status` shows only in-scope files.

### Step 5: Full-suite gate + post-deploy check note

Run `npm test` → all pass (the CSP is production-only, so the suite proves
non-regression of everything else). Add to the commit message body: "After
the next Vercel deploy, load `/`, `/original.html`, and `/pad-test.html`
with DevTools console open — zero CSP violation reports expected; a broken
page here means a source expression is wrong (see plan 030 Step 2 table)."

**Verify**: `npm test` → all pass.

## Test plan

No new specs — headers are production-only (documented above). Regression =
full suite + build. The deploy-time verification is the manual check in
Step 5 (record it in the PR/commit body so a human does it).

## Done criteria (ALL must hold)

- [ ] `npm audit` → 0 vulnerabilities (root)
- [ ] `vercel.json` parses as JSON and contains four header blocks; the
      site-wide block's `script-src` is exactly `'self'`
- [ ] `grep -c "unsafe-inline" vercel.json` → 3 occurrences in script-src
      (original.html, original/, pad-test) + style-src occurrences; the
      `/(.*)` block's script-src has none
- [ ] `touch .env && git status --porcelain | grep -c .env` → 0 (then rm it)
- [ ] `video/.env.example` exists and contains no secret value
- [ ] `npm test` exits 0; `npm run build` exits 0
- [ ] `plans/README.md` row 030 updated

## STOP conditions

- `npm audit fix` touches `package.json` or anything beyond
  `package-lock.json` — stop, report the diff.
- `dist/index.html` DOES contain an inline script body after `npm run build`
  (the Vite-externalization assumption failed) — stop; the `/` block would
  then need `'unsafe-inline'` and the plan's premise changes.
- The museum page's cdnjs tag does not match the path-scoped source you
  wrote — stop and re-derive; NEVER edit `public/original/**` to fit.
- Any full-suite failure.

## Maintenance notes

- If a future page adds a Worker, `blob:` script, or cross-origin fetch,
  production is the FIRST place it fails (no local CSP) — check `vercel.json`
  in the same PR. A reviewer seeing a new `<script>` inline in any page
  should ask which CSP block covers it.
- Renaming/removing `public/pad-test.html` must remove its header block.
- The `video/` tree (332 packages, local-only) stays outside CI on purpose;
  re-run its audit occasionally — it can never affect the deployed site.
