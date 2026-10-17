# Issue #328 theme assertion ledger

Source: `tests/theme_ui_contract_test.ts`, inherited base
`259bdb9d7a923862f8a7332a11f52aebc6cd9159`. The complete stable-ID inventory and original
expressions are recorded in “Stage 5 exhaustive assertion disposition” below. All 44 effective
assertion executions are mapped; the obsolete source suite was removed in Stage 5.

## `ThemeSwitcher provides Dark, Auto, and Light options` (source L17–25)

Original expressions:

```ts
assertMatch(switcher, /aria-label=".*テーマ.*"/);
assertMatch(switcher, /Dark/);
assertMatch(switcher, /Auto/);
assertMatch(switcher, /Light/);
assertMatch(switcher, /themePreference === "dark"/);
assertMatch(switcher, /themePreference === "auto"/);
assertMatch(switcher, /themePreference === "light"/);
```

Contract: accessible group and real Dark/Auto/Light labels; current preference is the sole pressed
button.

Destination: `stories/theme-switcher.stories.ts` checks the accessible group, each real label, each
initial pressed state, Enter activation, controlled harness state, and exactly one pressed value.
`tests/ui/theme.spec.ts` exercises all three real App controls. **Stage 4 covered.**

## `AppTopBar places ThemeSwitcher in the top right actions` (source L27–32)

Original expressions:

```ts
assertMatch(topBar, /<ThemeSwitcher/);
assertMatch(topBar, /themePreference/);
assertMatch(topBar, /onThemePreferenceChange/);
assertMatch(topBar, /--view-switcher-active-bg/);
```

Contracts: TopBar exposes the current preference/change operation; its active visual token remains
intended.

Destination: `tests/ui/theme.spec.ts` interacts with the real TopBar and checks App selection and
storage. **Selection covered in Stage 4.** Active-token/computed visual preservation is covered by
“Light palette and active view switcher use the rendered design colors” in Stage 5.

## `OptionsView provides theme preference control in display section with validation` (source L34–39)

Original expressions:

```ts
assertMatch(optionsView, /themePreference/);
assertMatch(optionsView, /onThemePreferenceChange/);
assertMatch(optionsView, /isThemePreference/);
assertMatch(optionsView, /<select[^>]*value=\{themePreference\}/);
```

Contract: controlled Options select validates and forwards the selected preference.

Destination: `stories/options-view.stories.ts` uses the actual controlled `themePreference="auto"`
prop, selects `light`, and checks the callback. `tests/ui/theme.spec.ts` verifies App
synchronization from Options to TopBar and TopBar to Options. The story callback alone is not
counted as App synchronization. **Stage 4 covered.**

## `styles.css defines light theme tokens and data-theme rules` (source L41–48)

Original expressions:

```ts
assertMatch(styles, /\[data-theme="light"\]/);
assertMatch(styles, /--bg:\s*#f4f0e6/);
assertMatch(styles, /--text:\s*#111/);
assertMatch(styles, /--cyan:\s*#9f2b20/);
assertMatch(styles, /--view-switcher-active-bg/);
assertMatch(styles, /\[data-theme="dark"\]/);
```

Contract: theme tokens and explicit selectors produce intended rendered colors.

Destination: `tests/ui/theme.spec.ts` checks actual computed root backgrounds in Auto light/dark and
explicit Light/Dark modes, rendered Light palette/accent, and active view-switcher colors. No CSS
source parsing is retained. **Covered in Stage 4 and Stage 5.**

## `App.svelte and theme_controller coordinate theme lifecycle` (source L50–57)

Original expressions:

```ts
assertMatch(app, /createThemeController/);
assertMatch(app, /themeController\.init\(\)/);
assertMatch(themeControllerSource, /loadThemePreference/);
assertMatch(themeControllerSource, /saveThemePreference/);
assertMatch(themeControllerSource, /applyThemeToDocument/);
assertMatch(themeControllerSource, /listenSystemThemeChange/);
```

Contract: App owns one initialized Controller; preference load/save/apply and the system-listener
lifecycle work.

Destination: `vitest/theme_controller.svelte.test.ts` verifies Auto-only callback reapplication,
explicit-mode no-reapply, and cleanup calling unlisten. `tests/ui/theme.spec.ts` verifies actual
storage, DOM application, invalid-value fallback, and reload. `tests/theme_preference_test.ts`
continues to cover schema, storage failure, and pure preference behavior. **Stage 4 covered.**

## `light confirmation text follows readable theme colors` (source L59–77)

Original expressions:

```ts
assertMatch(dialog, /color:\s*var\(--theme-text,\s*#edf9fa\)/);
assertMatch(dialog, /color:\s*var\(--theme-muted,\s*#afc1c9\)/);
assertMatch(styles, /--theme-text:\s*var\(--text\)/);
assertMatch(styles, /--theme-muted:\s*var\(--muted\)/);
assert(contrast(token(foreground), token("surface-raised")) >= 4.5);
```

Contract: visible Light confirmation text and supporting text meet 4.5:1 contrast against their
rendered background.

Destination: `tests/a11y/app.a11y.spec.ts`, test “Light confirmation dialog passes axe and rendered
text contrast”, measures the visible real confirmation's title and description, effective
background, 4.5:1 contrast, and scoped axe results. `vitest/theme_contrast.test.ts` directly
verifies known-color luminance, alpha compositing, and explicit rejection of unsupported/unresolved
colors. **Stage 5 covered.**

## `dark top-bar colors stay on their original selectors` (source L79–89)

Original expressions:

```ts
assertMatch(
	topBar,
	/\.top-bar\s*\{[^}]*background:\s*var\(--theme-topbar-bg,\s*rgb\(5 9 15 \/ 92%\)\)/,
);
assertMatch(topBar, /\.view-switcher\s*\{[^}]*background:\s*var\(--theme-\w[\w-]*,\s*#04080d\)/);
assertMatch(topBar, /\.search-results\s*\{[^}]*background:\s*var\(--surface-raised\)/);
assertMatch(topBar, /\.search-section\s*\{[^}]*background:\s*var\(--theme-[\w-]+,\s*#07121c\)/);
assertMatch(topBar, /\.top-actions button\s*\{[^}]*color:\s*var\(--text-secondary\)/);
assertMatch(styles, /--text-secondary:\s*#aebdc5/);
```

Contract: Dark TopBar, view switcher, search results/section, and actions retain intended visible
colors.

Destination: `tests/ui/theme.spec.ts`, test “Dark TopBar and visible search styling retain readable
computed colors”, drives actual Dark selection and query input, then checks computed
TopBar/action/view-switcher/search-result/section styles and contrast. Selector location and
declaration formatting are not contracts.

## Stage 4 boundaries

- Browser coverage uses actual App DOM, actual `localStorage`, real controls, reload, and
  `page.emulateMedia`; `applyThemeToDocument`'s fake-document unit is not browser proof.
- `tests/theme_ui_contract_test.ts` is retired in Stage 5 only after its complete assertion mapping
  and replacement tests pass.
- Invalid persisted-value coverage initializes storage before the single initial navigation. No
  initialization script overwrites the preference on reload.

## Stage 5 exhaustive assertion disposition

The inherited source has **40 assertion source expressions and 44 effective executions**: 37
`assertMatch` calls, one `assert(light)`, four executions of `assert(value, ...)` (each loop
iteration parses its foreground token and `surface-raised`), and two contrast assertions. There are
seven source tests. IDs below remain stable after source-suite retirement. “Retired” means the
source-layout/precondition check itself is deliberately removed; the user-facing behavior has a
listed runtime destination.

The dialog helper also performed these non-asserting source extractions before testing the result:

```ts
const light = styles.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
const token = (name: string): string => {
	const value = light.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, "i"))?.[1];
	return value;
};
```

Both parsing operations are retired with the token-presence assertions: the replacement reads
computed foreground/background colors from actual rendered elements and does not parse stylesheet
text.

| Stable ID            | Full original test name                                                            | Exact original assertion expression                                                                         | Destination or retirement                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TSW-01               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /aria-label=".*テーマ.*"/);`                                                         | `stories/theme-switcher.stories.ts`: `Dark`, `Auto`, `Light` play checks named group                                                                                                                 |
| TSW-02               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /Dark/);`                                                                            | Same story plays check the actual accessible `Dark` button                                                                                                                                           |
| TSW-03               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /Auto/);`                                                                            | Same story plays check the actual accessible `Auto` button                                                                                                                                           |
| TSW-04               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /Light/);`                                                                           | Same story plays check the actual accessible `Light` button                                                                                                                                          |
| TSW-05               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /themePreference === "dark"/);`                                                      | Story `Dark` plus App test `dark preference is restored after reload`; retire source branch-expression check                                                                                         |
| TSW-06               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /themePreference === "auto"/);`                                                      | Story `Auto` plus App test `an unsaved preference starts in Auto and each control selection persists`; retire source branch-expression check                                                         |
| TSW-07               | `ThemeSwitcher provides Dark, Auto, and Light options`                             | `assertMatch(switcher, /themePreference === "light"/);`                                                     | Story `Light` plus App test `light preference is restored after reload`; retire source branch-expression check                                                                                       |
| TOP-01               | `AppTopBar places ThemeSwitcher in the top right actions`                          | `assertMatch(topBar, /<ThemeSwitcher/);`                                                                    | App test `an unsaved preference starts in Auto and each control selection persists`; retire component-placement spelling                                                                             |
| TOP-02               | `AppTopBar places ThemeSwitcher in the top right actions`                          | `assertMatch(topBar, /themePreference/);`                                                                   | App tests `an unsaved preference starts in Auto and each control selection persists` and `TopBar and Options share one theme preference through navigation`; retire prop-name spelling               |
| TOP-03               | `AppTopBar places ThemeSwitcher in the top right actions`                          | `assertMatch(topBar, /onThemePreferenceChange/);`                                                           | Same App tests exercise actual controls and persisted value; retire callback-name spelling                                                                                                           |
| TOP-04               | `AppTopBar places ThemeSwitcher in the top right actions`                          | `assertMatch(topBar, /--view-switcher-active-bg/);`                                                         | `Light palette and active view switcher use the rendered design colors` checks computed active fill and foreground                                                                                   |
| OPT-01               | `OptionsView provides theme preference control in display section with validation` | `assertMatch(optionsView, /themePreference/);`                                                              | `stories/options-view.stories.ts`: `Default`; App test `TopBar and Options share one theme preference through navigation`; retire prop-name spelling                                                 |
| OPT-02               | `OptionsView provides theme preference control in display section with validation` | `assertMatch(optionsView, /onThemePreferenceChange/);`                                                      | Story `Default` asserts callback value `light`; App test checks cross-view synchronization; retire callback-name spelling                                                                            |
| OPT-03               | `OptionsView provides theme preference control in display section with validation` | `assertMatch(optionsView, /isThemePreference/);`                                                            | Story `Default` selects valid `light`; `tests/theme_preference_test.ts`: `ThemePreferenceSchema validates theme preference picklist`; retire validator-name spelling                                 |
| OPT-04               | `OptionsView provides theme preference control in display section with validation` | `assertMatch(optionsView, /<select[^>]*value=\{themePreference\}/);`                                        | Story `Default` verifies controlled `auto` value and callback; App test checks two-way screen synchronization; retire markup/binding spelling                                                        |
| CSS-01               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /\[data-theme="light"\]/);`                                                            | `Light palette and active view switcher use the rendered design colors` checks real root background/text/accent; retire selector spelling                                                            |
| CSS-02               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /--bg:\s*#f4f0e6/);`                                                                   | Same browser test checks computed Light root background `rgb(244, 240, 230)`                                                                                                                         |
| CSS-03               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /--text:\s*#111/);`                                                                    | Same browser test checks computed root foreground `rgb(17, 17, 17)`                                                                                                                                  |
| CSS-04               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /--cyan:\s*#9f2b20/);`                                                                 | Same browser test focuses actual search control and checks rendered accent border `rgb(159, 43, 32)`                                                                                                 |
| CSS-05               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /--view-switcher-active-bg/);`                                                         | Same browser test checks actual pressed Outline button's computed fill/text and contrast                                                                                                             |
| CSS-06               | `styles.css defines light theme tokens and data-theme rules`                       | `assertMatch(styles, /\[data-theme="dark"\]/);`                                                             | `Dark TopBar and visible search styling retain readable computed colors` checks computed Dark root background; retire selector spelling                                                              |
| APP-01               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(app, /createThemeController/);`                                                                | Controller test `defaults to auto preference and reads stored preference`; App browser selection and reload tests; retire constructor spelling                                                       |
| APP-02               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(app, /themeController\.init\(\)/);`                                                            | Controller tests `init applies stored dark preference`, `init applies stored light preference`, and `system changes reapply Auto only and cleanup unsubscribes`; retire initialization call spelling |
| APP-03               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(themeControllerSource, /loadThemePreference/);`                                                | Controller test `defaults to auto preference and reads stored preference`; `theme preference loads from storage and falls back on invalid data`; App reload coverage; retire helper-name spelling    |
| APP-04               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(themeControllerSource, /saveThemePreference/);`                                                | Controller test `setPreference updates preference and persists value`; App test `an unsaved preference starts in Auto and each control selection persists`; retire helper-name spelling              |
| APP-05               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(themeControllerSource, /applyThemeToDocument/);`                                               | `tests/theme_preference_test.ts`: `applyThemeToDocument sets dataset and colorScheme on document element`; App browser checks computed Light/Dark style; retire helper-name spelling                 |
| APP-06               | `App.svelte and theme_controller coordinate theme lifecycle`                       | `assertMatch(themeControllerSource, /listenSystemThemeChange/);`                                            | Controller test `system changes reapply Auto only and cleanup unsubscribes`; App test `Auto follows system colors while retaining Auto preference`; retire helper-name spelling                      |
| DLG-01               | `light confirmation text follows readable theme colors`                            | `assertMatch(dialog, /color:\s*var\(--theme-text,\s*#edf9fa\)/);`                                           | Visible Light confirmation test checks computed title foreground `rgb(17, 17, 17)` and 4.5:1                                                                                                         |
| DLG-02               | `light confirmation text follows readable theme colors`                            | `assertMatch(dialog, /color:\s*var\(--theme-muted,\s*#afc1c9\)/);`                                          | Same test checks computed supporting copy foreground `rgb(98, 91, 80)` and 4.5:1                                                                                                                     |
| DLG-03               | `light confirmation text follows readable theme colors`                            | `assertMatch(styles, /--theme-text:\s*var\(--text\)/);`                                                     | Same test checks rendered foreground and effective visible dialog background; retire token alias spelling                                                                                            |
| DLG-04               | `light confirmation text follows readable theme colors`                            | `assertMatch(styles, /--theme-muted:\s*var\(--muted\)/);`                                                   | Same test checks rendered supporting foreground and effective visible dialog background; retire token alias spelling                                                                                 |
| DLG-05               | `light confirmation text follows readable theme colors`                            | `assert(light);`                                                                                            | Retire extracted-light-selector precondition. Browser now exercises Light through the App control, not source text parsing                                                                           |
| DLG-06-text          | `light confirmation text follows readable theme colors`                            | `assert(value, \`Missing light token: ${name}\`);`                                                          | Retire source-token presence precondition; actual visible title color and contrast are measured with `name === "text"` in the browser                                                                |
| DLG-06-muted         | `light confirmation text follows readable theme colors`                            | `assert(value, \`Missing light token: ${name}\`);`                                                          | Retire source-token presence precondition; actual visible support-copy color and contrast are measured with `name === "muted"` in the browser                                                        |
| DLG-06-surface-text  | `light confirmation text follows readable theme colors`                            | `assert(value, \`Missing light token: ${name}\`);`                                                          | Retire source-token presence precondition; this is the `token("surface-raised")` validation in the `text` loop pass; rendered dialog background is tested in the browser                             |
| DLG-06-surface-muted | `light confirmation text follows readable theme colors`                            | `assert(value, \`Missing light token: ${name}\`);`                                                          | Retire source-token presence precondition; this is the `token("surface-raised")` validation in the `muted` loop pass; rendered dialog background is tested in the browser                            |
| DLG-07-text          | `light confirmation text follows readable theme colors`                            | `assert(contrast(token(foreground), token("surface-raised")) >= 4.5);` with `foreground === "text"`         | Replaced by rendered title/effective-background contrast and scoped axe                                                                                                                              |
| DLG-07-muted         | `light confirmation text follows readable theme colors`                            | `assert(contrast(token(foreground), token("surface-raised")) >= 4.5);` with `foreground === "muted"`        | Replaced by rendered description/effective-background contrast and scoped axe                                                                                                                        |
| DKR-01               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(topBar, /\.top-bar\s*\{[^}]*background:\s*var\(--theme-topbar-bg,\s*rgb\(5 9 15 \/ 92%\)\)/);` | Dark App browser test checks actual computed TopBar background and action foreground; retire selector/fallback formatting                                                                            |
| DKR-02               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(topBar, /\.view-switcher\s*\{[^}]*background:\s*var\(--theme-\w[\w-]*,\s*#04080d\)/);`         | Dark App browser test checks actual switcher and active-button computed fills/contrast; retire selector/fallback formatting                                                                          |
| DKR-03               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(topBar, /\.search-results\s*\{[^}]*background:\s*var\(--surface-raised\)/);`                   | Dark App browser test types a real query and checks visible result panel computed background and result text                                                                                         |
| DKR-04               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(topBar, /\.search-section\s*\{[^}]*background:\s*var\(--theme-[\w-]+,\s*#07121c\)/);`          | Dark App browser test checks visible search section computed background/foreground and contrast                                                                                                      |
| DKR-05               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(topBar, /\.top-actions button\s*\{[^}]*color:\s*var\(--text-secondary\)/);`                    | Dark App browser test checks visible navigation action computed foreground; no additional manual contrast assertion is claimed                                                                       |
| DKR-06               | `dark top-bar colors stay on their original selectors`                             | `assertMatch(styles, /--text-secondary:\s*#aebdc5/);`                                                       | Same browser test checks computed action foreground `rgb(174, 189, 197)`; retire source token literal check                                                                                          |

Retirement notes: `styles.match(...)`, `light.match(...)`, and the old local `contrast` function
read/parsed CSS source; those implementation preconditions are not user-visible behavior and are
intentionally retired rather than reimplemented against source text. Computed-style checks preserve
the design colors that matter. The contrast helper accepts browser-computed `rgb()/rgba()` and the
actual Chromium `color(srgb … / alpha)` format. It guarantees only solid-color/alpha backgrounds and
stops background traversal at the nearest opaque layer. It rejects subtree opacity/filter/mask/blend
effects on every evaluated target ancestor, including ancestors beyond that layer; it rejects
background-image/backdrop-filter only on layers contributing to the background result. Dark TopBar
action foreground is checked as a computed design color; manual contrast is omitted because its
backdrop-filter/radial-gradient path is outside this helper's supported background model.

Stage 5 validation: `RADIORA_UI_PORT=4177 npm run test:a11y` passed 8; the full
`RADIORA_UI_PORT=4177 npm run test:ui` passed 141; focused final theme rerun passed 11;
`npm run test:storybook` passed 49; contrast/controller Vitest passed 11; `npm run check` found 0
errors and 0 warnings; exact `deno task verify` passed 1,026 Deno tests, 57 Vitest files / 571
tests, and production build. A temporary browser-rendered title mutation failed at contrast 1.165
against the 4.5 threshold and was removed. Deno-generated optional-peer lockfile changes were
verified as generated during this gate and restored; no package manifest or lockfile delta remains.

Stage 5 is accumulated work pending parent review; no main-branch landing is implied.
