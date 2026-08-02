import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

Deno.test("desktop HMR routes the renderer through Vite while preserving the desktop API", async () => {
	const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url))) as {
		tasks: Record<string, string>;
	};
	const launcher = await Deno.readTextFile(new URL("../scripts/desktop_hmr.ts", import.meta.url));
	const proxy = await Deno.readTextFile(
		new URL("../scripts/desktop_hmr_proxy_plugin.ts", import.meta.url),
	);
	const main = await Deno.readTextFile(new URL("../src/main.ts", import.meta.url));
	const viteConfig = await Deno.readTextFile(new URL("../vite.config.ts", import.meta.url));

	assertEquals(config.tasks["desktop:hmr"], "deno run -A scripts/desktop_hmr.ts");
	assertMatch(launcher, /npm(?:\.cmd)?/);
	assertMatch(launcher, /"dev:web"/);
	assertMatch(launcher, /"desktop", "-A", "--hmr", \.\.\.inspectorArgs\(\), "src\/main\.ts"/);
	assert(launcher.includes("RADIORA_HMR_UI_ORIGIN"));
	assert(launcher.includes("RADIORA_HMR_BRIDGE_FILE"));
	assert(viteConfig.includes("desktopHmrProxyPlugin()"));
	assert(proxy.includes('startsWith("/api/")'));
	assert(proxy.includes("backendOrigin"));
	assert(proxy.includes("proxyApiRequest(bridgeFile, request, response)"));
	assertMatch(proxy, /async function proxyApiRequest\(\s*bridgeFile: string,/);
	assert(main.includes("RADIORA_HMR_UI_ORIGIN"));
	assert(main.includes("RADIORA_HMR_BRIDGE_FILE"));
	assert(main.includes("Response.redirect"));
});
