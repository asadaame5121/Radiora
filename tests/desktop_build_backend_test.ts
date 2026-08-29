import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
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

Deno.test("deno.json: deprecated surreal desktop tasks are removed", async () => {
	const denoJsonText = await Deno.readTextFile(new URL("../deno.json", import.meta.url));
	const denoJson = JSON.parse(denoJsonText);
	assertEquals("desktop:surreal" in (denoJson.tasks ?? {}), false);
	assertEquals("desktop:run:surreal" in (denoJson.tasks ?? {}), false);
	assertEquals("desktop:run:surreal-diagnostic" in (denoJson.tasks ?? {}), false);
	assertEquals("desktop:probe" in (denoJson.tasks ?? {}), false);
	assertEquals("desktop:sidecar" in (denoJson.tasks ?? {}), false);
});

Deno.test("scripts/desktop_run.ts: deprecated surreal runtime flags are removed", async () => {
	const scriptText = await Deno.readTextFile(new URL("../scripts/desktop_run.ts", import.meta.url));
	assertEquals(scriptText.includes("--surreal-diagnostic"), false);
	assertEquals(scriptText.includes('"--surreal"'), false);
});

Deno.test("scripts/desktop_build.ts: does not import or call sidecar_build / copySurrealCli", async () => {
	const buildScriptText = await Deno.readTextFile(
		new URL("../scripts/desktop_build.ts", import.meta.url),
	);
	assertEquals(buildScriptText.includes("sidecar_build"), false);
	assertEquals(buildScriptText.includes("copySurrealCli"), false);
	assertEquals(buildScriptText.includes("buildSurrealSidecar"), false);
});

async function safeRemoveDir(dir: string): Promise<void> {
	for (let i = 0; i < 40; i++) {
		try {
			await Deno.remove(dir, { recursive: true });
			return;
		} catch (err) {
			if (i === 39) throw err;
			await new Promise((r) => setTimeout(r, 150));
		}
	}
}

Deno.test("scripts/desktop_msix.ts: assertCleanBundle rejects stale surreal artifacts and accepts clean bundle", async () => {
	const { assertCleanBundle, findLauncher } = await import("../scripts/desktop_msix.ts");
	const root = await Deno.makeTempDir({ prefix: "msix-bundle-test-" });
	try {
		const rootUrl = new URL(`file:///${root.replaceAll("\\", "/")}/`);

		// 1. Clean bundle with valid launcher
		await Deno.writeTextFile(`${root}\\Radiora.exe`, "dummy launcher");
		await assertCleanBundle(rootUrl);
		const launcher = await findLauncher(rootUrl);
		assertEquals(launcher, "Radiora.exe");

		// 2. Bundle with stale surreal.exe
		await Deno.writeTextFile(`${root}\\surreal.exe`, "dummy surreal");
		await assertRejects(
			() => assertCleanBundle(rootUrl),
			Error,
			"古い surreal.exe がbundle内に残っています",
		);
		// findLauncher should still defensively ignore surreal.exe
		assertEquals(await findLauncher(rootUrl), "Radiora.exe");
		await Deno.remove(`${root}\\surreal.exe`);

		// 3. Bundle with stale radiora-surreal.exe
		await Deno.writeTextFile(`${root}\\radiora-surreal.exe`, "dummy sidecar");
		await assertRejects(
			() => assertCleanBundle(rootUrl),
			Error,
			"古い radiora-surreal.exe がbundle内に残っています",
		);
		// findLauncher should still defensively ignore radiora-surreal.exe
		assertEquals(await findLauncher(rootUrl), "Radiora.exe");
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("package.json: surrealdb is in devDependencies and not in runtime dependencies", async () => {
	const packageJsonText = await Deno.readTextFile(
		new URL("../package.json", import.meta.url),
	);
	const packageJson = JSON.parse(packageJsonText);
	assertEquals("surrealdb" in (packageJson.dependencies ?? {}), false);
	assertEquals("surrealdb" in (packageJson.devDependencies ?? {}), true);
});

Deno.test("scripts/licenses.ts: runtimeEntries does not include SurrealDB CLI", async () => {
	const licensesScriptText = await Deno.readTextFile(
		new URL("../scripts/licenses.ts", import.meta.url),
	);
	assertEquals(licensesScriptText.includes('"SurrealDB CLI"'), false);
});
