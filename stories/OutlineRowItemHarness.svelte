<script lang="ts">
	import type { ComponentProps } from "svelte";
	import type { OutlineRowSource } from "../src/ui/outline_row_types.ts";
	import OutlineRowItem from "../src/ui/OutlineRowItem.svelte";

	type Props = ComponentProps<typeof OutlineRowItem<OutlineRowSource>>;
	let props: Props = $props();
</script>

<div role="tree" aria-label="アウトライン">
	<OutlineRowItem {...props} />
</div>
