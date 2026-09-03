import { assert, assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const topBar = await Deno.readTextFile(new URL("../src/ui/AppTopBar.svelte", import.meta.url));
const switcher = await Deno.readTextFile(
	new URL("../src/ui/ThemeSwitcher.svelte", import.meta.url),
);
const optionsView = await Deno.readTextFile(
	new URL("../src/ui/OptionsView.svelte", import.meta.url),
);
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

const themeControllerSource = await Deno.readTextFile(
	new URL("../src/ui/theme_controller.svelte.ts", import.meta.url),
);

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
	assertMatch(topBar, /--view-switcher-active-bg/);
});

Deno.test("OptionsView provides theme preference control in display section with validation", () => {
	assertMatch(optionsView, /themePreference/);
	assertMatch(optionsView, /onThemePreferenceChange/);
	assertMatch(optionsView, /isThemePreference/);
	assertMatch(optionsView, /<select[^>]*value=\{themePreference\}/);
});

Deno.test("styles.css defines light theme tokens and data-theme rules", () => {
	assertMatch(styles, /\[data-theme="light"\]/);
	assertMatch(styles, /--bg:\s*#f4f0e6/);
	assertMatch(styles, /--text:\s*#111/);
	assertMatch(styles, /--cyan:\s*#d63b2c/);
	assertMatch(styles, /--view-switcher-active-bg/);
	assertMatch(styles, /\[data-theme="dark"\]/);
});

Deno.test("App.svelte and theme_controller coordinate theme lifecycle", () => {
	assertMatch(app, /createThemeController/);
	assertMatch(app, /themeController\.init\(\)/);
	assertMatch(themeControllerSource, /loadThemePreference/);
	assertMatch(themeControllerSource, /saveThemePreference/);
	assertMatch(themeControllerSource, /applyThemeToDocument/);
	assertMatch(themeControllerSource, /listenSystemThemeChange/);
});

Deno.test("light confirmation text follows readable theme colors", async () => {
	const dialog = await Deno.readTextFile(
		new URL("../src/ui/ConfirmationDialog.svelte", import.meta.url),
	);
	assertMatch(dialog, /color:\s*var\(--theme-text,\s*#edf9fa\)/);
	assertMatch(dialog, /color:\s*var\(--theme-muted,\s*#afc1c9\)/);
	assertMatch(styles, /--theme-text:\s*var\(--text\)/);
	assertMatch(styles, /--theme-muted:\s*var\(--muted\)/);
	const light = styles.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
	assert(light);
	const token = (name: string): string => {
		const value = light.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, "i"))?.[1];
		assert(value, `Missing light token: ${name}`);
		return value;
	};
	for (const foreground of ["text", "muted"]) {
		assert(contrast(token(foreground), token("surface-raised")) >= 4.5);
	}
});

Deno.test("dark top-bar colors stay on their original selectors", () => {
	assertMatch(
		topBar,
		/\.top-bar\s*\{[^}]*background:\s*var\(--theme-topbar-bg,\s*rgb\(5 9 15 \/ 92%\)\)/,
	);
	assertMatch(topBar, /\.view-switcher\s*\{[^}]*background:\s*var\(--theme-\w[\w-]*,\s*#04080d\)/);
	assertMatch(topBar, /\.search-results\s*\{[^}]*background:\s*var\(--surface-raised\)/);
	assertMatch(topBar, /\.search-section\s*\{[^}]*background:\s*var\(--theme-[\w-]+,\s*#07121c\)/);
	assertMatch(topBar, /\.top-actions button\s*\{[^}]*color:\s*var\(--text-secondary\)/);
	assertMatch(styles, /--text-secondary:\s*#aebdc5/);
});

function contrast(foreground: string, background: string): number {
	const luminance = (hex: string): number => {
		const channels = [1, 3, 5].map((offset) => {
			const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	const values = [luminance(foreground), luminance(background)];
	return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
