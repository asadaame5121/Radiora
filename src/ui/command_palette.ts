import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
import {
	COMMAND_DEFINITIONS,
	type CommandAvailability,
	commandAvailability,
	type CommandContext,
	type CommandDefinition,
	type CommandId,
} from "./command_service.ts";

export interface CommandPaletteItem {
	id: CommandId;
	label: string;
	shortcut?: string;
	availability: CommandAvailability;
}

/** Projects the command service into the palette without defining commands or rules again. */
export function commandPaletteItems(
	query: string,
	context: CommandContext,
	vocabulary: UiVocabulary,
	definitions: readonly CommandDefinition[] = COMMAND_DEFINITIONS,
): readonly CommandPaletteItem[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const availability = commandAvailability(context, definitions);
	return definitions
		.map((command) => ({
			id: command.id,
			label: command.label(vocabulary),
			shortcut: command.shortcut,
			availability: availability[command.id],
		}))
		.filter((command) => command.label.toLocaleLowerCase().includes(normalizedQuery));
}
