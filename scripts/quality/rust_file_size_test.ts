import {
	countNonBlankLines,
	findSizeViolations,
	isProductionRust,
	parseBaseline,
	RUST_FILE_LIMIT,
} from "./rust_file_size.ts";

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

const COUNTED_LINES = 3;
const TESTS_OVERSHOOT = 50;
const BASELINE_ALLOWANCE = 10;
const lines = (count: number): string =>
	Array.from({ length: count }, () => "let x = 1;").join("\n");

Deno.test("blank lines are excluded but comments are counted", () => {
	assert(
		countNonBlankLines("a\n\n  \n// comment\r\n/// doc\n") === COUNTED_LINES,
		"unexpected count",
	);
});

Deno.test("only production Rust sources are in scope", () => {
	assert(isProductionRust("crates/radiora-core/src/lib.rs"), "src excluded");
	assert(!isProductionRust("crates/radiora-core/tests/purge.rs"), "tests included");
	assert(!isProductionRust("crates/radiora-core/src/generated/x.rs"), "generated included");
	assert(!isProductionRust("crates/radiora-core/README.md"), "non-rs included");
});

Deno.test("a file over the limit fails and one at the limit passes", () => {
	const files = new Map([
		["crates/a/src/ok.rs", lines(RUST_FILE_LIMIT)],
		["crates/a/src/big.rs", lines(RUST_FILE_LIMIT + 1)],
		["crates/a/tests/big.rs", lines(RUST_FILE_LIMIT + TESTS_OVERSHOOT)],
	]);
	const violations = findSizeViolations(files, {});
	assert(violations.length === 1 && violations[0]?.path === "crates/a/src/big.rs", "wrong result");
});

Deno.test("a baselined file is tolerated at its recorded size but not when it grows", () => {
	const path = "crates/a/src/legacy.rs";
	const baseline = { [path]: RUST_FILE_LIMIT + BASELINE_ALLOWANCE };
	assert(
		findSizeViolations(new Map([[path, lines(RUST_FILE_LIMIT + BASELINE_ALLOWANCE)]]), baseline)
			.length === 0,
		"baseline not honoured",
	);
	assert(
		findSizeViolations(new Map([[path, lines(RUST_FILE_LIMIT + BASELINE_ALLOWANCE + 1)]]), baseline)
			.length === 1,
		"growth accepted",
	);
});

Deno.test("baseline entries must be integers above the limit", () => {
	for (const bad of [{ x: "1" }, { x: 10 }, { x: 700.5 }, [], null]) {
		let rejected = false;
		try {
			parseBaseline(bad);
		} catch {
			rejected = true;
		}
		assert(rejected, `accepted ${JSON.stringify(bad)}`);
	}
	assert(Object.keys(parseBaseline({ "crates/a/src/x.rs": 700 })).length === 1, "valid rejected");
});
