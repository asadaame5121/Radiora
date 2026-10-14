import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { prepareWindowsLaunchers } from "../scripts/desktop_build.ts";

Deno.test({
	name: "Windows launchers recover a medium-integrity process after inheriting a low label",
	ignore: Deno.build.os !== "windows",
	async fn() {
		const dir = await Deno.makeTempDir({ prefix: "desktop-integrity-" });
		const outputDir = new URL(`file:///${dir.replaceAll("\\", "/")}/`);
		const launcher = `${dir}\\app.exe`;
		try {
			await Deno.copyFile(`${Deno.env.get("SystemRoot")}\\System32\\whoami.exe`, launcher);
			const low = await new Deno.Command("icacls.exe", {
				args: [launcher, "/setintegritylevel", "L"],
			}).output();
			assertEquals(low.success, true);
			const before = await new Deno.Command(launcher, { args: ["/groups"] }).output();
			assertEquals(before.success, true);
			assertStringIncludes(new TextDecoder().decode(before.stdout), "S-1-16-4096");

			await prepareWindowsLaunchers(outputDir);

			const after = await new Deno.Command(launcher, { args: ["/groups"] }).output();
			assertEquals(after.success, true);
			assertStringIncludes(new TextDecoder().decode(after.stdout), "S-1-16-8192");
		} finally {
			await Deno.remove(dir, { recursive: true });
		}
	},
});
