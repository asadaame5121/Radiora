import { assertEquals } from "jsr:@std/assert@1";
import { checkForUpdate, compareVersions, versionFromTag } from "./update_checker.ts";

Deno.test("update checker normalizes release tags and compares versions", () => {
	assertEquals(versionFromTag("v0.3.0"), "0.3.0");
	assertEquals(versionFromTag("0.4.1"), "0.4.1");
	assertEquals(versionFromTag("release-0.4.1"), null);
	assertEquals(compareVersions("0.4.0", "0.3.0"), 1);
	assertEquals(compareVersions("0.3.0", "0.3.0"), 0);
	assertEquals(compareVersions("0.2.9", "0.3.0"), -1);
});

Deno.test("update checker reports a newer GitHub release", async () => {
	const result = await checkForUpdate("0.3.0", async () => ({
		ok: true,
		json: async () => ({
			tag_name: "v0.4.0",
			html_url: "https://github.com/asadaame5121/Radiora/releases/tag/v0.4.0",
			published_at: "2026-08-07T00:00:00Z",
		}),
	}));
	assertEquals(result.updateAvailable, true);
	assertEquals(result.latest?.version, "0.4.0");
	assertEquals(result.error, null);
});

Deno.test("update checker handles network failures and unsafe release URLs", async () => {
	const failed = await checkForUpdate("0.3.0", async () => ({
		ok: false,
		json: async () => ({}),
	}));
	assertEquals(failed.latest, null);
	assertEquals(failed.updateAvailable, false);
	assertEquals(typeof failed.error, "string");

	const unsafe = await checkForUpdate("0.3.0", async () => ({
		ok: true,
		json: async () => ({
			tag_name: "v0.4.0",
			html_url: "https://evil.example/v0.4.0",
		}),
	}));
	assertEquals(unsafe.latest, null);
	assertEquals(unsafe.updateAvailable, false);
});
