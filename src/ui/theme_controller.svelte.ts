import {
	applyThemeToDocument,
	getSystemPrefersDark,
	listenSystemThemeChange,
	loadThemePreference,
	type ResolvedTheme,
	resolveTheme,
	saveThemePreference,
	type ThemePreference,
	type ThemePreferenceStorage,
} from "./theme_preference.ts";

export interface ThemeControllerPorts {
	storage?: ThemePreferenceStorage | null;
	applyTheme?: (preference: ThemePreference) => void;
	listenSystemChange?: (callback: (prefersDark: boolean) => void) => () => void;
	getSystemPrefersDark?: () => boolean;
}

export interface ThemeController {
	readonly preference: ThemePreference;
	readonly resolvedTheme: ResolvedTheme;
	setPreference(next: ThemePreference): void;
	init(): () => void;
}

export function createThemeController(ports: ThemeControllerPorts = {}): ThemeController {
	const storage = ports.storage;
	const applyTheme = ports.applyTheme ?? applyThemeToDocument;
	const listenSystemChange = ports.listenSystemChange ?? listenSystemThemeChange;
	const systemPrefersDark = ports.getSystemPrefersDark ?? getSystemPrefersDark;

	let preference = $state<ThemePreference>(loadThemePreference(storage));

	const resolvedTheme = $derived<ResolvedTheme>(
		resolveTheme(preference, systemPrefersDark()),
	);

	function setPreference(next: ThemePreference): void {
		preference = next;
		saveThemePreference(next, storage);
		applyTheme(next);
	}

	function init(): () => void {
		applyTheme(preference);
		const unlisten = listenSystemChange(() => {
			if (preference === "auto") {
				applyTheme("auto");
			}
		});
		return () => {
			unlisten();
		};
	}

	return {
		get preference() {
			return preference;
		},
		get resolvedTheme() {
			return resolvedTheme;
		},
		setPreference,
		init,
	};
}
