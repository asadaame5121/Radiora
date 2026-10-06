import { describe, expect, it, vi } from "vitest";
import type { LicenseEntry, LicenseIndex } from "../src/services/license_index.ts";
import { LicensesController } from "../src/ui/licenses_controller.svelte.ts";

const entryA: LicenseEntry = {
	name: "Runtime A",
	version: "1.0",
	license: "MIT",
	file: "runtime-a.txt",
	summary: "Runtime notice",
};

const entryB: LicenseEntry = {
	name: "Package B",
	version: "2.0",
	license: "Apache-2.0",
	file: "package-b.txt",
	summary: "Package notice",
};

const sampleIndex: LicenseIndex = {
	runtime: [entryA],
	npm: [entryB],
};

describe("LicensesController", () => {
	it("initializes with closed dialog and clean state", () => {
		const controller = new LicensesController();
		expect(controller.isOpen).toBe(false);
		expect(controller.index).toBeNull();
		expect(controller.detail).toBeNull();
		expect(controller.error).toBe("");
		expect(controller.loading).toBe(false);
	});

	it("opens dialog, shows loading, and populates index on success", async () => {
		const fetchIndex = vi.fn().mockResolvedValue(sampleIndex);
		const controller = new LicensesController({ fetchIndex });

		const opening = controller.open();
		expect(controller.isOpen).toBe(true);
		expect(controller.loading).toBe(true);
		expect(controller.error).toBe("");

		await opening;
		expect(controller.loading).toBe(false);
		expect(controller.index).toEqual(sampleIndex);
	});

	it("sets error message when index fetch fails", async () => {
		const fetchIndex = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
		const controller = new LicensesController({ fetchIndex });

		await controller.open();
		expect(controller.isOpen).toBe(true);
		expect(controller.loading).toBe(false);
		expect(controller.error).toBe("503 Service Unavailable");
		expect(controller.index).toBeNull();
	});

	it("closing dialog while index is loading prevents late response from populating", async () => {
		let resolveIndex!: (value: LicenseIndex) => void;
		const fetchIndex = vi.fn().mockReturnValue(
			new Promise<LicenseIndex>((resolve) => {
				resolveIndex = resolve;
			}),
		);
		const controller = new LicensesController({ fetchIndex });

		void controller.open();
		expect(controller.isOpen).toBe(true);
		expect(controller.loading).toBe(true);

		controller.close();
		expect(controller.isOpen).toBe(false);
		expect(controller.loading).toBe(false);

		resolveIndex(sampleIndex);
		await Promise.resolve();

		expect(controller.isOpen).toBe(false);
		expect(controller.index).toBeNull();
	});

	it("reopening dialog discards older in-flight index response", async () => {
		let resolveOld!: (value: LicenseIndex) => void;
		let resolveNew!: (value: LicenseIndex) => void;
		const fetchIndex = vi
			.fn()
			.mockReturnValueOnce(
				new Promise<LicenseIndex>((resolve) => {
					resolveOld = resolve;
				}),
			)
			.mockReturnValueOnce(
				new Promise<LicenseIndex>((resolve) => {
					resolveNew = resolve;
				}),
			);

		const controller = new LicensesController({ fetchIndex });

		void controller.open();
		controller.close();

		const secondOpen = controller.open();

		const newIndex: LicenseIndex = {
			runtime: [],
			npm: [entryB],
		};
		resolveNew(newIndex);
		await secondOpen;

		expect(controller.index).toEqual(newIndex);

		// Now old response resolves late
		resolveOld(sampleIndex);
		await Promise.resolve();

		// Should not overwrite newer index
		expect(controller.index).toEqual(newIndex);
	});

	it("fetches and displays detail text when license is selected", async () => {
		const fetchDetail = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "Full license text for A",
		} as Response);
		const controller = new LicensesController({ fetchDetail });

		await controller.open();
		const selecting = controller.select(entryA);

		expect(controller.detail).toEqual({
			name: "Runtime A 1.0",
			text: "ライセンス全文を読み込んでいます…",
		});

		await selecting;
		expect(controller.detail).toEqual({
			name: "Runtime A 1.0",
			text: "Full license text for A",
		});
	});

	it("displays HTTP failure message on non-ok detail response", async () => {
		const fetchDetail = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		} as Response);
		const controller = new LicensesController({ fetchDetail });

		await controller.open();
		await controller.select(entryA);

		expect(controller.detail).toEqual({
			name: "Runtime A 1.0",
			text: "ライセンス全文を読み込めませんでした (404)。",
		});
	});

	it("displays error message on detail network failure", async () => {
		const fetchDetail = vi.fn().mockRejectedValue(new Error("Network connection lost"));
		const controller = new LicensesController({ fetchDetail });

		await controller.open();
		await controller.select(entryA);

		expect(controller.detail).toEqual({
			name: "Runtime A 1.0",
			text: "Network connection lost",
		});
	});

	it("stale detail response is discarded when newer selection is made", async () => {
		let resolveA!: (value: Response) => void;
		const fetchDetail = vi.fn().mockImplementation((file: string) => {
			if (file === "runtime-a.txt") {
				return new Promise<Response>((resolve) => {
					resolveA = resolve;
				});
			}
			return Promise.resolve({
				ok: true,
				text: async () => "Package B license text",
			} as Response);
		});

		const controller = new LicensesController({ fetchDetail });
		await controller.open();

		void controller.select(entryA);
		await controller.select(entryB);

		expect(controller.detail).toEqual({
			name: "Package B 2.0",
			text: "Package B license text",
		});

		// Stale A arrives late
		resolveA({
			ok: true,
			text: async () => "Stale A text",
		} as Response);
		await Promise.resolve();

		expect(controller.detail).toEqual({
			name: "Package B 2.0",
			text: "Package B license text",
		});
	});

	it("detail from a closed dialog cannot leak into a reopened dialog", async () => {
		let resolveA!: (value: Response) => void;
		const fetchDetail = vi.fn().mockReturnValue(
			new Promise<Response>((resolve) => {
				resolveA = resolve;
			}),
		);

		const controller = new LicensesController({ fetchDetail });
		await controller.open();

		void controller.select(entryA);
		controller.close();

		await controller.open();
		expect(controller.detail).toBeNull();

		resolveA({
			ok: true,
			text: async () => "Stale A text",
		} as Response);
		await Promise.resolve();

		expect(controller.detail).toBeNull();
	});

	it("dispose prevents any pending fetch from updating state", async () => {
		let resolveIndex!: (value: LicenseIndex) => void;
		const fetchIndex = vi.fn().mockReturnValue(
			new Promise<LicenseIndex>((resolve) => {
				resolveIndex = resolve;
			}),
		);
		const controller = new LicensesController({ fetchIndex });

		void controller.open();
		controller.dispose();

		expect(controller.isOpen).toBe(false);

		resolveIndex(sampleIndex);
		await Promise.resolve();

		expect(controller.index).toBeNull();
		expect(controller.isOpen).toBe(false);
	});
});
