import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const topBar = await readFile(new URL("../../../src/ui/AppTopBar.svelte", import.meta.url), "utf8");
const switcher = await readFile(
	new URL("../../../src/ui/ThemeSwitcher.svelte", import.meta.url),
	"utf8",
);
const optionsView = await readFile(
	new URL("../../../src/ui/OptionsView.svelte", import.meta.url),
	"utf8",
);
const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");

const themeControllerSource = await readFile(
	new URL("../../../src/ui/theme_controller.svelte.ts", import.meta.url),
	"utf8",
);

test("ThemeSwitcher provides Dark, Auto, and Light options", () => {
	expect(switcher).toMatch(/aria-label=".*テーマ.*"/);
	expect(switcher).toMatch(/Dark/);
	expect(switcher).toMatch(/Auto/);
	expect(switcher).toMatch(/Light/);
	expect(switcher).toMatch(/themePreference === "dark"/);
	expect(switcher).toMatch(/themePreference === "auto"/);
	expect(switcher).toMatch(/themePreference === "light"/);
});

test("AppTopBar places ThemeSwitcher in the top right actions", () => {
	expect(topBar).toMatch(/<ThemeSwitcher/);
	expect(topBar).toMatch(/themePreference/);
	expect(topBar).toMatch(/onThemePreferenceChange/);
	expect(topBar).toMatch(/--view-switcher-active-bg/);
});

test("OptionsView provides theme preference control in display section with validation", () => {
	expect(optionsView).toMatch(/themePreference/);
	expect(optionsView).toMatch(/onThemePreferenceChange/);
	expect(optionsView).toMatch(/isThemePreference/);
	expect(optionsView).toMatch(/<select[^>]*value=\{themePreference\}/);
});

test("styles.css defines light theme tokens and data-theme rules", () => {
	expect(styles).toMatch(/\[data-theme="light"\]/);
	expect(styles).toMatch(/--bg:\s*#f4f0e6/);
	expect(styles).toMatch(/--text:\s*#111/);
	expect(styles).toMatch(/--cyan:\s*#9f2b20/);
	expect(styles).toMatch(/--view-switcher-active-bg/);
	expect(styles).toMatch(/\[data-theme="dark"\]/);
});

test("App.svelte and theme_controller coordinate theme lifecycle", () => {
	expect(app).toMatch(/createThemeController/);
	expect(app).toMatch(/themeController\.init\(\)/);
	expect(themeControllerSource).toMatch(/loadThemePreference/);
	expect(themeControllerSource).toMatch(/saveThemePreference/);
	expect(themeControllerSource).toMatch(/applyThemeToDocument/);
	expect(themeControllerSource).toMatch(/listenSystemThemeChange/);
});

test("light confirmation text follows readable theme colors", async () => {
	const dialog = await readFile(
		new URL("../../../src/ui/ConfirmationDialog.svelte", import.meta.url),
		"utf8",
	);
	expect(dialog).toMatch(/color:\s*var\(--theme-text,\s*#edf9fa\)/);
	expect(dialog).toMatch(/color:\s*var\(--theme-muted,\s*#afc1c9\)/);
	expect(styles).toMatch(/--theme-text:\s*var\(--text\)/);
	expect(styles).toMatch(/--theme-muted:\s*var\(--muted\)/);
	const light = styles.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
	if (!light) throw new Error("expected a light theme block");
	const token = (name: string): string => {
		const value = light.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, "i"))?.[1];
		if (!value) throw new Error(`Missing light token: ${name}`);
		return value;
	};
	for (const foreground of ["text", "muted"]) {
		expect(contrast(token(foreground), token("surface-raised")) >= 4.5).toBeTruthy();
	}
});

test("dark top-bar colors stay on their original selectors", () => {
	expect(topBar).toMatch(
		/\.top-bar\s*\{[^}]*background:\s*var\(--theme-topbar-bg,\s*rgb\(5 9 15 \/ 92%\)\)/,
	);
	expect(topBar).toMatch(
		/\.view-switcher\s*\{[^}]*background:\s*var\(--theme-\w[\w-]*,\s*#04080d\)/,
	);
	expect(topBar).toMatch(/\.search-results\s*\{[^}]*background:\s*var\(--surface-raised\)/);
	expect(topBar).toMatch(
		/\.search-section\s*\{[^}]*background:\s*var\(--theme-[\w-]+,\s*#07121c\)/,
	);
	expect(topBar).toMatch(/\.top-actions button\s*\{[^}]*color:\s*var\(--text-secondary\)/);
	expect(styles).toMatch(/--text-secondary:\s*#aebdc5/);
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
