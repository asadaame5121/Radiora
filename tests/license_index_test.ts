import { assertEquals, assertRejects } from "jsr:@std/assert";
import { fetchLicenseIndex } from "../src/services/license_index.ts";

Deno.test("license index rejects the HTML SPA fallback and validates JSON", async () => {
	await assertRejects(
		() =>
			fetchLicenseIndex(async () =>
				new Response("<!doctype html>", {
					headers: { "content-type": "text/html; charset=utf-8" },
				})
			),
		Error,
		"JSONではありません",
	);

	const index = await fetchLicenseIndex(async () =>
		Response.json({
			runtime: [],
			npm: [
				{ name: "example", version: "1.0.0", license: "MIT", file: null, summary: "" },
			],
		})
	);
	assertEquals(index.npm[0]?.name, "example");
});
