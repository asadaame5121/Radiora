import { describe, expect, it } from "vitest";
import {
	type ComputedBackgroundLayer,
	contrastForSolidBackgroundLayers,
	contrastRatio,
} from "../tests/ui/theme_contrast.ts";

describe("theme contrast measurement", () => {
	const layer = (
		backgroundColor: string,
		overrides: Partial<ComputedBackgroundLayer> = {},
	): ComputedBackgroundLayer => ({
		backgroundColor,
		backgroundImage: "none",
		maskImage: "none",
		opacity: "1",
		filter: "none",
		backdropFilter: "none",
		mixBlendMode: "normal",
		...overrides,
	});

	it("uses the WCAG sRGB luminance ratio", () => {
		expect(contrastRatio("rgb(0, 0, 0)", ["rgb(255, 255, 255)"])).toBe(21);
		expect(contrastRatio("color(srgb 0 0 0 / 1)", ["color(srgb 1 1 1 / 1)"]))
			.toBe(21);
		expect(contrastRatio("rgb(17, 17, 17)", ["rgb(236, 229, 216)"])).toBeGreaterThan(4.5);
	});

	it("composites near-transparent backgrounds over the nearest opaque ancestor", () => {
		expect(contrastRatio("rgb(255, 255, 255)", [
			"rgba(0, 0, 0, 0.01)",
			"rgb(255, 255, 255)",
		])).toBeGreaterThan(1);
		expect(contrastRatio("rgb(255, 255, 255)", [
			"rgba(0, 0, 0, 0.01)",
			"rgb(255, 255, 255)",
		])).toBeLessThan(1.1);
		expect(contrastRatio("rgba(0, 0, 0, 0.5)", ["rgb(255, 255, 255)"]))
			.toBeCloseTo(3.98, 2);
	});

	it("rejects subtree effects on every ancestor, including beyond an opaque background", () => {
		for (
			const unsupported of [
				{ maskImage: "linear-gradient(red, blue)" },
				{ opacity: "0.5" },
				{ filter: "blur(1px)" },
				{ mixBlendMode: "multiply" },
			]
		) {
			expect(() =>
				contrastForSolidBackgroundLayers("rgb(0, 0, 0)", [
					layer("rgb(255, 255, 255)"),
					layer("rgb(0, 0, 0)", unsupported),
				])
			).toThrow("does not support subtree paint effects");
		}
	});

	it("rejects background effects up to the opaque layer and ignores them behind it", () => {
		for (
			const unsupported of [
				{ backgroundImage: "linear-gradient(red, blue)" },
				{ backdropFilter: "blur(1px)" },
			]
		) {
			expect(() =>
				contrastForSolidBackgroundLayers("rgb(0, 0, 0)", [
					layer("rgba(0, 0, 0, 0)", unsupported),
					layer("rgb(255, 255, 255)"),
				])
			).toThrow("only solid-color background layers");
		}
		expect(contrastForSolidBackgroundLayers("rgb(0, 0, 0)", [
			layer("rgb(255, 255, 255)"),
			layer("rgb(0, 0, 0)", { backgroundImage: "linear-gradient(red, blue)" }),
			layer("rgb(0, 0, 0)", { backdropFilter: "blur(1px)" }),
		])).toBe(21);
	});

	it("fails explicitly for unparseable colors or unresolved transparent canvas", () => {
		expect(() => contrastRatio("color(display-p3 0 0 0)", ["rgb(255, 255, 255)"]))
			.toThrow("Unsupported computed CSS color");
		expect(() => contrastRatio("rgb(0, 0, 0)", ["rgba(255, 255, 255, 0)"]))
			.toThrow("Effective computed background is transparent");
	});
});
