import { RNG_STEP } from "./model.ts";

export function createRandom(seed: number, salt: number): () => number {
	let state = (seed ^ salt) >>> 0;
	return () => {
		state = (state + RNG_STEP) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
	};
}
