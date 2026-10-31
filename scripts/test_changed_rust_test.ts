import { runPlan, selectTests } from "./test_changed.ts";

Deno.test("Rust workspace selection executes tests and propagates failure", async () => {
	const cwd = await Deno.makeTempDir({ prefix: "radiora-test-selection-" });
	try {
		await Deno.mkdir(`${cwd}/src`);
		await Deno.writeTextFile(
			`${cwd}/Cargo.toml`,
			'[workspace]\n[package]\nname = "selection-fixture"\nversion = "0.0.0"\nedition = "2024"\n',
		);
		await Deno.writeTextFile(
			`${cwd}/src/lib.rs`,
			'#[test]\nfn selected() { panic!("intentional failure"); }\n',
		);
		const lock = await new Deno.Command("cargo", {
			cwd,
			args: ["generate-lockfile", "--offline"],
			stdout: "piped",
			stderr: "piped",
		}).output();
		if (!lock.success) throw new Error(new TextDecoder().decode(lock.stderr));
		const plan = selectTests(["crates/radiora-core/src/lib.rs"], []);
		if ((await runPlan(cwd, plan)) === 0) throw new Error("Rust test failure was swallowed");
		await Deno.writeTextFile(`${cwd}/src/lib.rs`, "#[test]\nfn selected() {}\n");
		if ((await runPlan(cwd, plan)) !== 0)
			throw new Error("Rust test was not executed successfully");
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});
