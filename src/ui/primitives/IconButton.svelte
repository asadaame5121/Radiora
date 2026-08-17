<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	type IconButtonProps = Omit<HTMLButtonAttributes, "children" | "title"> & {
		label: string;
		title?: string;
		children?: Snippet;
	};

	let {
		label,
		title = label,
		children,
		...buttonAttributes
	}: IconButtonProps = $props();
</script>

<button {...buttonAttributes} type="button" aria-label={label} title={title}>
	<span aria-hidden="true">
		{@render children?.()}
	</span>
</button>

<style>
	button {
		align-items: center;
		background: transparent;
		border: 0;
		color: inherit;
		cursor: pointer;
		display: inline-flex;
		justify-content: center;
		padding: 0;
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
