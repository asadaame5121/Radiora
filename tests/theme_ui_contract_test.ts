import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const topBar = await Deno.readTextFile(new URL("../src/ui/AppTopBar.svelte", import.meta.url));
const switcher = await Deno.readTextFile(
	new URL("../src/ui/ThemeSwitcher.svelte", import.meta.url),
);
const optionsView = await Deno.readTextFile(
	new URL("../src/ui/OptionsView.svelte", import.meta.url),
);
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

Deno.test("ThemeSwitcher provides Dark, Auto, and Light options", () => {
	assertMatch(switcher, /aria-label=".*テーマ.*"/);
	assertMatch(switcher, /Dark/);
	assertMatch(switcher, /Auto/);
	assertMatch(switcher, /Light/);
	assertMatch(switcher, /themePreference === "dark"/);
	assertMatch(switcher, /themePreference === "auto"/);
	assertMatch(switcher, /themePreference === "light"/);
});

Deno.test("AppTopBar places ThemeSwitcher in the top right actions", () => {
	assertMatch(topBar, /<ThemeSwitcher/);
	assertMatch(topBar, /themePreference/);
	assertMatch(topBar, /onThemePreferenceChange/);
});

Deno.test("OptionsView provides theme preference control in display section", () => {
	assertMatch(optionsView, /themePreference/);
	assertMatch(optionsView, /onThemePreferenceChange/);
	assertMatch(optionsView, /<select[^>]*value=\{themePreference\}/);
});

Deno.test("styles.css defines light theme tokens and data-theme rules", () => {
	assertMatch(styles, /\[data-theme="light"\]/);
	assertMatch(styles, /--bg:\s*#f4f0e6/);
	assertMatch(styles, /--text:\s*#111/);
	assertMatch(styles, /--cyan:\s*#d63b2c/);
	assertMatch(styles, /\[data-theme="dark"\]/);
});

Deno.test("App.svelte loads, persists, and applies theme preference with OS media listener", () => {
	assertMatch(app, /loadThemePreference/);
	assertMatch(app, /saveThemePreference/);
	assertMatch(app, /applyThemeToDocument/);
	assertMatch(app, /listenSystemThemeChange/);
});
