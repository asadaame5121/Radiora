import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

Deno.test("desktop DevTools inspection stays opt-in and exposes a CDP audit task", async () => {
	const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url))) as {
		tasks: Record<string, string>;
	};
	const launcher = await Deno.readTextFile(new URL("../scripts/desktop_hmr.ts", import.meta.url));
	const audit = await Deno.readTextFile(
		new URL("../scripts/desktop_cdp_audit.ts", import.meta.url),
	);

	assertEquals(
		config.tasks["desktop:inspect"],
		"deno run -A scripts/desktop_hmr.ts --inspect=127.0.0.1:9230",
	);
	assertEquals(config.tasks["desktop:audit"], "deno run -A scripts/desktop_cdp_audit.ts");
	assertMatch(launcher, /"desktop", "-A", "--hmr", \.\.\.inspectorArgs\(\)/);
	assert(launcher.includes("--inspect-renderer="));
	assert(audit.includes("/json/version"));
	assert(audit.includes("/json/list"));
	assert(audit.includes('client.send("Runtime.evaluate"'));
	assert(audit.includes('client.send("Page.captureScreenshot"'));
	assert(audit.includes("toWebSocketUrl(inspector.baseUrl, muxPath)"));
});
