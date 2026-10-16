<script lang="ts">
	import { untrack } from "svelte";
	import ThemeSwitcher from "../src/ui/ThemeSwitcher.svelte";
	import type { ThemePreference } from "../src/ui/theme_preference.ts";

	let { initialPreference = "auto" }: { initialPreference?: ThemePreference } = $props();
	let preference = $state<ThemePreference>(untrack(() => initialPreference));
	let lastChange = $state("未変更");

	function setPreference(next: ThemePreference): void {
		preference = next;
		lastChange = next;
	}
</script>

<ThemeSwitcher
	themePreference={preference}
	onThemePreferenceChange={setPreference}
/>
<p aria-live="polite">選択中: {preference} / 最後の変更: {lastChange}</p>
