import type { Locator } from "@playwright/test";

type Color = { red: number; green: number; blue: number; alpha: number };

export type ComputedBackgroundLayer = {
	backgroundColor: string;
	backgroundImage: string;
	maskImage: string;
	opacity: string;
	filter: string;
	backdropFilter: string;
	mixBlendMode: string;
};

function parseSrgb(value: string): Color {
	const match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/
		.exec(value);
	if (!match) throw new Error(`Unsupported computed CSS color: ${value}`);
	const channels = match.slice(1, 4).map(Number);
	const alpha = match[4] === undefined ? 1 : Number(match[4]);
	if (
		channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1) ||
		!Number.isFinite(alpha) || alpha < 0 || alpha > 1
	) {
		throw new Error(`Invalid computed CSS color: ${value}`);
	}
	return {
		red: channels[0] * 255,
		green: channels[1] * 255,
		blue: channels[2] * 255,
		alpha,
	};
}

function parseRgb(value: string): Color {
	const match = /^rgba?\(([^)]+)\)$/.exec(value);
	if (!match) throw new Error(`Unsupported computed CSS color: ${value}`);

	const channels = match[1].replaceAll(",", " ").replace("/", " / ").trim().split(/\s+/);
	const slash = channels.indexOf("/");
	const channelValues = slash < 0 ? channels : channels.slice(0, slash);
	const alphaValue = slash < 0
		? channelValues.length === 4 ? channelValues.pop() : undefined
		: channels[slash + 1];
	if (channelValues.length !== 3 || (slash >= 0 && channels.length !== slash + 2)) {
		throw new Error(`Unsupported computed CSS color: ${value}`);
	}

	const numbers = channelValues.map(Number);
	const alpha = alphaValue?.endsWith("%")
		? Number(alphaValue.slice(0, -1)) / 100
		: alphaValue === undefined
		? 1
		: Number(alphaValue);
	if (
		numbers.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255) ||
		!Number.isFinite(alpha) || alpha < 0 || alpha > 1
	) {
		throw new Error(`Invalid computed CSS color: ${value}`);
	}

	return { red: numbers[0], green: numbers[1], blue: numbers[2], alpha };
}

function parseComputedColor(value: string): Color {
	const normalized = value.trim();
	return normalized.startsWith("color(srgb ") ? parseSrgb(normalized) : parseRgb(normalized);
}

function composite(foreground: Color, background: Color): Color {
	const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
	if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
	return {
		red: (foreground.red * foreground.alpha +
			background.red * background.alpha * (1 - foreground.alpha)) / alpha,
		green: (foreground.green * foreground.alpha +
			background.green * background.alpha * (1 - foreground.alpha)) / alpha,
		blue: (foreground.blue * foreground.alpha +
			background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
		alpha,
	};
}

function luminance(color: Color): number {
	const linear = (channel: number) => {
		const srgb = channel / 255;
		return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) +
		0.0722 * linear(color.blue);
}

export function contrastRatio(foreground: string, backgrounds: readonly string[]): number {
	if (backgrounds.length === 0) throw new Error("No computed background colors were provided");
	const layers: Color[] = [];
	for (const value of backgrounds) {
		const layer = parseComputedColor(value);
		layers.push(layer);
		if (layer.alpha === 1) break;
	}
	const background = layers.reverse().reduce(
		(composed, layer) => composite(layer, composed),
		{ red: 0, green: 0, blue: 0, alpha: 0 },
	);
	if (background.alpha !== 1) {
		throw new Error("Effective computed background is transparent; cannot measure contrast");
	}
	const renderedForeground = composite(parseComputedColor(foreground), background);
	const values = [luminance(renderedForeground), luminance(background)];
	return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

function assertSupportedSubtreeEffects(layer: ComputedBackgroundLayer): void {
	if (
		layer.maskImage !== "none" || layer.opacity !== "1" || layer.filter !== "none" ||
		layer.mixBlendMode !== "normal"
	) {
		throw new Error("Contrast measurement does not support subtree paint effects");
	}
}

function assertSupportedBackgroundEffects(layer: ComputedBackgroundLayer): void {
	if (layer.backgroundImage !== "none" || layer.backdropFilter !== "none") {
		throw new Error("Contrast measurement supports only solid-color background layers");
	}
}

// Measures solid backgrounds to the nearest opaque layer; subtree effects are checked across all ancestors.
export function contrastForSolidBackgroundLayers(
	foreground: string,
	layers: readonly ComputedBackgroundLayer[],
): number {
	for (const layer of layers) assertSupportedSubtreeEffects(layer);

	const colors: string[] = [];
	for (const layer of layers) {
		assertSupportedBackgroundEffects(layer);
		colors.push(layer.backgroundColor);
		if (parseComputedColor(layer.backgroundColor).alpha === 1) break;
	}
	return contrastRatio(foreground, colors);
}

export async function renderedContrast(element: Locator): Promise<number> {
	const { foreground, layers } = await element.evaluate((node) => {
		const layers: ComputedBackgroundLayer[] = [];
		for (let current: Element | null = node; current; current = current.parentElement) {
			const style = getComputedStyle(current);
			layers.push({
				backgroundColor: style.backgroundColor,
				backgroundImage: style.backgroundImage,
				maskImage: style.maskImage,
				opacity: style.opacity,
				filter: style.filter,
				backdropFilter: style.backdropFilter,
				mixBlendMode: style.mixBlendMode,
			});
		}
		return { foreground: getComputedStyle(node).color, layers };
	});
	return contrastForSolidBackgroundLayers(foreground, layers);
}
