# Plan 001: Establish build tooling, dependency pinning, and a smoke-test baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f4d3ecc..HEAD -- index.html game.js style.css`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tests
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The repo is a browser game with **no package.json, no dev server, no lint, and no tests** — the only way to know anything works is to open it in a browser by hand. Every subsequent plan in `plans/` cites the commands this plan creates as its verification gates, so nothing else can land safely until this exists. It also removes the game's hard runtime dependency on a third-party CDN (`cdnjs.cloudflare.com`) — today the game is unplayable offline and unbuildable for deployment.

## Current state

- Repo root contains exactly: `game.js` (1006 lines, all game logic, classic script using the global `THREE`), `index.html`, `style.css`, `readme.md`, `todo.md`, `grok_tips.md`, `push_changes.ps1`. No `package.json`, no `node_modules`, no test or lint config, no `.gitignore`.
- `index.html:10` loads three.js r128 from a CDN:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  ```
- `index.html:44-51` loads the game and starts it with an inline script:
  ```html
  <script src="game.js"></script>
  <script>
      // Ensure the game starts after the page is fully loaded
      window.addEventListener('load', function () {
          console.log('Window loaded, initializing game...');
          init();
      });
  </script>
  ```
- `game.js` defines everything at top level (classic-script globals): `init`, `update`, `animate`, `togglePause`, `resetGame`, etc. It references the global `THREE` throughout (e.g. `new THREE.Scene()` at `game.js:107`).
- `game.js` has two intentionally-unused declarations that a strict lint would flag (they are removed by plan 002, NOT by this plan): `enemy` in `let player, enemy, ground;` (`game.js:5`) and `targetCollectiblesOnScreen` (`game.js:48`, written at lines 289/754 but never read).
- Known UI facts the smoke tests rely on (all in `index.html`): `#game-container` (canvas is inserted as its first child), `#pause-button` (game boots **paused**, button text "Resume"), `#score` (starts "0"), `#collect-time` (starts "15"), `#message-box` (hidden until game over; game over text always starts with "GAME OVER!"), `#restart-button` ("Play Again").
- Game-over timing fact: the game ends at most ~16s after unpausing if the player never moves (a 15-second collect timer at `game.js:543-557` — and the enemy usually catches the stationary player around the 10s mark). Either way `#message-box` becomes visible with text containing "GAME OVER".

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Node present | `node --version` | v18+ prints |
| Install | `npm install` | exit 0 (after step 1) |
| Dev server | `npm run dev` | Vite serves on localhost |
| Lint | `npm run lint` | exit 0 |
| Smoke tests | `npm test` | all Playwright tests pass |
| Prod build | `npm run build` | exit 0, `dist/` created |

## Scope

**In scope** (the only files you should create/modify):
- `package.json`, `package-lock.json` (create)
- `.gitignore` (create)
- `vite.config.js` (create)
- `eslint.config.js` (create)
- `playwright.config.js` (create)
- `tests/smoke.spec.js` (create)
- `index.html` (modify: script tags only)
- `src/main.js` (create)
- `game.js` → **move** to `src/game.js` (content changes limited to the THREE import shim and init-call relocation described in step 3)

**Out of scope** (do NOT touch):
- Any game logic, tuning constant, or behavior in `game.js` beyond the two mechanical edits in step 3.
- `style.css`, `readme.md`, `todo.md`, `grok_tips.md`, `push_changes.ps1`.
- Removing the unused `enemy` / `targetCollectiblesOnScreen` variables (plan 002 does this).
- TypeScript, frameworks, or any three.js version other than 0.128.0.

## Git workflow

- Branch: `improve/001-tooling-baseline`
- Commit style: match repo history (`Chore: ...`, `Feat: ...`, `Fix: ...` prefixes — see `git log --oneline`), e.g. `Chore: Add Vite, ESLint, and Playwright baseline tooling`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create package.json and install dependencies

Create `package.json`:

```json
{
  "name": "blocky-collector-3d",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "playwright test"
  }
}
```

Then run:
- `npm install --save-exact three@0.128.0`
- `npm install --save-dev vite@^5 eslint@^9 @eslint/js globals @playwright/test`
- `npx playwright install chromium`

Create `.gitignore` with: `node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `.DS_Store`.

**Why three@0.128.0 exactly**: it is the npm publication of the same r128 build the game uses today from the CDN, so rendering is pixel-identical and zero game code needs retuning. Do not "helpfully" upgrade it — newer three versions change color management and light intensity defaults and would visibly alter the game. A future upgrade is a deliberately separate decision.

**Verify**: `npm ls three` → `three@0.128.0`; `.gitignore` exists.

### Step 2: Wire Vite

Create `vite.config.js`:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2019' }
});
```

**Verify**: `npx vite --version` → prints a 5.x version.

### Step 3: Convert the entry point to ES modules (mechanical)

1. `git mv game.js src/game.js`.
2. At the very top of `src/game.js`, add:
   ```js
   import * as THREE from 'three';
   ```
   (The file's existing `THREE.*` references now resolve to the import instead of a global. No other line of the file changes in this step, except step 3.4 below.)
3. Create `src/main.js`:
   ```js
   import './game.js';
   ```
4. At the very bottom of `src/game.js` (replacing the commented-out `window.onload` block at the current `game.js:1002-1006`), add the startup call that used to live inline in `index.html`:
   ```js
   if (document.readyState === 'complete') {
       init();
   } else {
       window.addEventListener('load', init);
   }
   ```
5. In `index.html`: delete the CDN `<script>` tag (line 10), delete the `<script src="game.js"></script>` tag and the entire inline startup `<script>` block (lines 44-51), and add before `</body>`:
   ```html
   <script type="module" src="/src/main.js"></script>
   ```

**Verify**: `npm run dev` then open the printed URL in a browser — the game renders the teal world with the orange player, and the browser console shows "Game initialized successfully" and no errors. (If you cannot open a browser, defer this check to step 5's automated test, but still confirm the dev server starts cleanly.)

### Step 4: Add ESLint (flat config)

Create `eslint.config.js`:

```js
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  },
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] }
];
```

`no-unused-vars` is deliberately **warn**, not error: `src/game.js` currently contains two known-dead variables (`enemy`, `targetCollectiblesOnScreen`) that plan 002 removes; plan 002 then raises this rule to `error`.

**Verify**: `npm run lint` → exit 0. Warnings about `enemy` / `targetCollectiblesOnScreen` being unused are expected and acceptable; any **error** (especially `no-undef`) means step 3 broke a reference — fix before proceeding.

### Step 5: Add the Playwright smoke suite

Create `playwright.config.js`:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
});
```

Create `tests/smoke.spec.js` with exactly these four DOM-level tests (DOM-level on purpose — later plans refactor internals heavily and these tests must survive):

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

test('game boots: canvas renders, score 0, starts paused', async ({ page }) => {
  await expect(page.locator('#game-container canvas')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#pause-button')).toBeVisible();
});

test('unpausing starts the collect countdown', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});

test('an idle game reaches game over', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#message-text')).toContainText('GAME OVER');
});

test('Play Again resets the game', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await page.locator('#restart-button').click();
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0');
});
```

**Verify**: `npm test` → 4 passed.

### Step 6: Confirm the production build

**Verify**: `npm run build` → exit 0 and `dist/index.html` exists; `npx vite preview` serves a working game (spot-check if a browser is available).

## Test plan

The smoke suite created in step 5 IS the test plan. It must pass headlessly via `npm test` with no manual interaction. These four tests are the regression net every later plan runs.

## Done criteria

- [ ] `npm run lint` exits 0 (warnings allowed, errors not)
- [ ] `npm test` exits 0 with 4 passing tests
- [ ] `npm run build` exits 0
- [ ] `grep -rn "cdnjs" index.html` returns no matches
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- `npm install` cannot reach the registry or `three@0.128.0` cannot be installed.
- After step 3 the game does not render in the dev server and the console error is anything other than a missed mechanical edit from step 3.
- The smoke tests are flaky (pass/fail intermittently) after two attempts — report the flake rather than loosening assertions.

## Maintenance notes

- Every later plan assumes `npm run lint` / `npm test` / `npm run build` as gates; keep script names stable.
- `three` is pinned exact at 0.128.0 on purpose (see step 1 rationale). A version bump is its own project with visual-retuning steps — reviewers should reject drive-by upgrades.
- The smoke tests are DOM-only by design; plans 008/009 will legitimately need to update the boot/game-over tests when they change those screens, and say so explicitly.
