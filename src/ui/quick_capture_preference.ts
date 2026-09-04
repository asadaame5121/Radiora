import { type InferOutput, picklist, object, safeParse } from "valibot";

export type QuickCaptureDestination = InferOutput<
  typeof QuickCaptureDestinationSchema
>;

export const QuickCaptureDestinationSchema = picklist(["root", "unplaced"]);

export const QuickCapturePreferenceSchema = object({
  destination: QuickCaptureDestinationSchema,
});

export const QUICK_CAPTURE_PREFERENCE_STORAGE_KEY =
  "radiora.quickCapturePreference";

export type QuickCapturePreference = Readonly<
  InferOutput<typeof QuickCapturePreferenceSchema>
>;

export interface QuickCapturePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_QUICK_CAPTURE_PREFERENCE: QuickCapturePreference =
  Object.freeze({
    destination: "root",
  });

export function loadQuickCapturePreference(
  storage: QuickCapturePreferenceStorage | null = browserStorage(),
): QuickCapturePreference {
  try {
    const raw = storage?.getItem(QUICK_CAPTURE_PREFERENCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
    const result = safeParse(QuickCapturePreferenceSchema, JSON.parse(raw));
    return result.success
      ? result.output
      : { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
  } catch {
    return { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
  }
}

export function saveQuickCapturePreference(
  preference: QuickCapturePreference,
  storage: QuickCapturePreferenceStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(
      QUICK_CAPTURE_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preference),
    );
    // biome-ignore lint/plugin/noSwallowedRejection: Quick-capture preferences are optional and storage failure must not block input.
  } catch {
    // Quick capture preferences are best-effort and must not block input.
  }
}

function browserStorage(): QuickCapturePreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
