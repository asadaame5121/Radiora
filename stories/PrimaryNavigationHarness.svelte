<script lang="ts">
	import type { ComponentProps } from "svelte";
	import PrimaryNavigation from "../src/ui/PrimaryNavigation.svelte";

	type Props = ComponentProps<typeof PrimaryNavigation>;
	let { collapsed, ...props }: Props = $props();
</script>

<div class:collapsed class="navigation-story">
	<PrimaryNavigation {collapsed} {...props} />
	<main aria-label="表示領域">
		<p>Navigation content preview</p>
	</main>
</div>

<style>
	.navigation-story {
		display: grid;
		grid-template-columns: 190px minmax(0, 1fr);
		min-height: 100vh;
		background: var(--surface);
	}
	.navigation-story.collapsed {
		grid-template-columns: 42px minmax(0, 1fr);
	}
	main {
		padding: 24px;
		color: var(--muted);
	}
</style>
