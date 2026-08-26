import { assertEquals, assertThrows } from "jsr:@std/assert";
import { resolveBackend } from "../scripts/desktop_build.ts";

Deno.test("resolveBackend: returns cef by default when no backend flags", () => {
	assertEquals(resolveBackend([]), "cef");
	assertEquals(resolveBackend(["--other", "flag"]), "cef");
});

Deno.test("resolveBackend: returns webview when --webview is passed", () => {
	assertEquals(resolveBackend(["--webview"]), "webview");
	assertEquals(resolveBackend(["--other", "--webview"]), "webview");
});

Deno.test("resolveBackend: returns explicit backend when --backend is passed with valid value", () => {
	assertEquals(resolveBackend(["--backend", "cef"]), "cef");
	assertEquals(resolveBackend(["--backend", "webview"]), "webview");
});

Deno.test("resolveBackend: throws error when --backend is at end of args without value", () => {
	assertThrows(
		() => resolveBackend(["--backend"]),
		Error,
		"Missing value for --backend option",
	);
	assertThrows(
		() => resolveBackend(["--foo", "--backend"]),
		Error,
		"Missing value for --backend option",
	);
});

Deno.test("resolveBackend: throws error when invalid backend is passed", () => {
	assertThrows(
		() => resolveBackend(["--backend", "invalid"]),
		Error,
		"Invalid backend 'invalid'",
	);
});
