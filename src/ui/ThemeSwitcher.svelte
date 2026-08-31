<script lang="ts">
	import type { ThemePreference } from "./theme_preference.ts";

	let {
		themePreference = "auto",
		onThemePreferenceChange,
	}: {
		themePreference: ThemePreference;
		onThemePreferenceChange: (preference: ThemePreference) => void;
	} = $props();
</script>

<fieldset class="theme-switcher" aria-label="テーマの切り替え">
	<button
		type="button"
		class:active={themePreference === "dark"}
		aria-pressed={themePreference === "dark"}
		title="ダークテーマ"
		onclick={() => onThemePreferenceChange("dark")}
	>
		Dark
	</button>
	<button
		type="button"
		class:active={themePreference === "auto"}
		aria-pressed={themePreference === "auto"}
		title="システムの自動設定に従う"
		onclick={() => onThemePreferenceChange("auto")}
	>
		Auto
	</button>
	<button
		type="button"
		class:active={themePreference === "light"}
		aria-pressed={themePreference === "light"}
		title="ライトテーマ"
		onclick={() => onThemePreferenceChange("light")}
	>
		Light
	</button>
</fieldset>

<style>
	.theme-switcher {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		gap: 2px;
	}
	.theme-switcher button {
		border: 0;
		border-radius: 4px;
		padding: 3px 7px;
		background: transparent;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: .04em;
		text-transform: uppercase;
		cursor: pointer;
		line-height: 1.2;
		transition: background .16s ease, color .16s ease;
	}
	.theme-switcher button:hover {
		color: var(--text);
		background: var(--surface-hover);
	}
	.theme-switcher button.active {
		background: var(--cyan);
		color: var(--bg);
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.theme-switcher button {
			padding: 3px 5px;
			font-size: 9px;
		}
	}
</style>
