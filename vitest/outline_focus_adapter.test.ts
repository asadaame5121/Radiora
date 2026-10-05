import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutlineFocusAdapter } from "../src/ui/outline_focus_adapter.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function fixture() {
	let context = { pane: "a", origin: 1 };
	let current = true;
	let visible = true;
	const host = new EventTarget();
	const dispatch = vi.fn();
	host.addEventListener("radiora:focus-editor", dispatch);
	const query = vi.fn((): EventTarget | null => host);
	vi.stubGlobal("document", { querySelector: query });
	vi.stubGlobal("CSS", { escape: (value: string) => value });
	const adapter = new OutlineFocusAdapter({
		context: () => context,
		canFocus: () => visible,
	});
	return {
		adapter,
		dispatch,
		query,
		request: (id = "x", caret = 3) => adapter.request(id, caret, () => current),
		invalidate: (reason: string) => {
			if (reason === "pane") context = { ...context, pane: "b" };
			else if (reason === "origin") context = { ...context, origin: 2 };
			else if (reason === "receipt") current = false;
			else if (reason === "visibility") visible = false;
			else adapter.dispose();
		},
	};
}

it("dispatches the editor event with its caret through the DOM port", () => {
	const { request, dispatch, query } = fixture();
	request();
	expect(dispatch).not.toHaveBeenCalled();
	vi.runAllTimers();
	expect(query).toHaveBeenCalledWith('.markdown-editor-host[data-editor-item-id="x"]');
	expect(dispatch).toHaveBeenCalledOnce();
	expect(dispatch.mock.calls[0][0]).toMatchObject({ detail: { caretOffset: 3 } });
});

it.each(["pane", "origin", "receipt", "visibility", "disposal"])(
	"does not dispatch expired focus after %s changes",
	(reason) => {
		const { request, invalidate, dispatch, query } = fixture();
		request();
		invalidate(reason);
		vi.runAllTimers();
		expect(query).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	},
);

it("replaces a pending request and rejects requests after disposal", () => {
	const { adapter, request, dispatch, query } = fixture();
	request("old", 1);
	request("new", 4);
	vi.runAllTimers();
	expect(query).toHaveBeenCalledOnce();
	expect(query).toHaveBeenCalledWith('.markdown-editor-host[data-editor-item-id="new"]');
	expect(dispatch.mock.calls[0][0]).toMatchObject({ detail: { caretOffset: 4 } });
	adapter.dispose();
	request();
	vi.runAllTimers();
	expect(dispatch).toHaveBeenCalledOnce();
});

it("ignores a host removed before the timer fires", () => {
	const { request, dispatch, query } = fixture();
	request();
	query.mockReturnValue(null);
	expect(() => vi.runAllTimers()).not.toThrow();
	expect(dispatch).not.toHaveBeenCalled();
});
