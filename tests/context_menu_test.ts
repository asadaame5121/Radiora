import { assertEquals } from "jsr:@std/assert@1";
import {
	type ContextMenuItem,
	contextMenuPosition,
	firstEnabledContextMenuIndex,
	lastEnabledContextMenuIndex,
	nextEnabledContextMenuIndex,
} from "../src/ui/context_menu.ts";

const items: readonly ContextMenuItem[] = [
	{ id: "open", label: "開く" },
	{ id: "unavailable", label: "利用不可", disabled: true, reason: "選択してください。" },
	{ id: "remove", label: "外す", danger: true },
];

Deno.test("context menu position preserves pointer placement when the menu fits", () => {
	assertEquals(contextMenuPosition(120, 80, 180, 220, 800, 600), { left: 120, top: 80 });
});

Deno.test("context menu position shifts the menu inside every viewport edge", () => {
	assertEquals(contextMenuPosition(790, 590, 180, 220, 800, 600), { left: 612, top: 372 });
	assertEquals(contextMenuPosition(-30, -20, 100, 100, 800, 600), { left: 8, top: 8 });
	assertEquals(contextMenuPosition(50, 50, 900, 700, 800, 600), { left: 8, top: 8 });
});

Deno.test("context menu keyboard navigation skips disabled entries and wraps", () => {
	assertEquals(firstEnabledContextMenuIndex(items), 0);
	assertEquals(lastEnabledContextMenuIndex(items), 2);
	assertEquals(nextEnabledContextMenuIndex(items, 0, 1), 2);
	assertEquals(nextEnabledContextMenuIndex(items, 2, 1), 0);
	assertEquals(nextEnabledContextMenuIndex(items, 0, -1), 2);
	assertEquals(nextEnabledContextMenuIndex(items, 1, 1), 0);
});

Deno.test("context menu has no keyboard target when every entry is disabled", () => {
	const disabled: readonly ContextMenuItem[] = [{ id: "a", label: "A", disabled: true }];
	assertEquals(firstEnabledContextMenuIndex(disabled), -1);
	assertEquals(lastEnabledContextMenuIndex(disabled), -1);
	assertEquals(nextEnabledContextMenuIndex(disabled, 0, 1), -1);
});

Deno.test("context menu restores focus before clearing parent-owned state", async () => {
	const component = await Deno.readTextFile(
		new URL("../src/ui/ContextMenu.svelte", import.meta.url),
	);
	const closeBody = component.slice(
		component.indexOf("function close"),
		component.indexOf("function select"),
	);
	assertEquals(closeBody.indexOf("triggerElement?.focus()") < closeBody.indexOf("onClose()"), true);
});
