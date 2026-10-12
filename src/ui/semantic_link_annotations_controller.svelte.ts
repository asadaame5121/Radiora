import type { OutlineItem, OutlineLink, RelationTypeDefinition } from "../domain/models.ts";
import {
	projectSemanticLinkAnnotations,
	projectSemanticLinkDisplayNames,
	type SemanticLinkAnnotation,
} from "../services/semantic_link_annotations.ts";
import {
	indexSemanticLinkAnnotations,
	reuseSemanticLinkDisplayNames,
	type SemanticLinkAnnotationIndex,
} from "../services/semantic_link_annotation_index.ts";

interface AnnotationPorts {
	items(): readonly OutlineItem[];
	links(): readonly OutlineLink[];
	relationTypeDefinitions(): readonly RelationTypeDefinition[];
}

/** App-lifetime read model for per-placement link annotations. */
export class SemanticLinkAnnotationsController {
	// Non-reactive memoization only; snapshot and relation definitions retain their existing owners.
	private previousNames: ReadonlyMap<string, string> = new Map();
	private previousIndex: SemanticLinkAnnotationIndex = new Map();
	private displayNames = $derived.by(() => {
		this.previousNames = reuseSemanticLinkDisplayNames(
			projectSemanticLinkDisplayNames(this.ports.items()),
			this.previousNames,
		);
		return this.previousNames;
	});
	private byOccurrence = $derived.by(() => {
		this.previousIndex = indexSemanticLinkAnnotations(
			projectSemanticLinkAnnotations(
				this.ports.items(),
				this.ports.links(),
				this.ports.relationTypeDefinitions(),
				this.displayNames,
			),
			this.previousIndex,
		);
		return this.previousIndex;
	});

	constructor(private readonly ports: AnnotationPorts) {}

	forOccurrence(id: string): readonly SemanticLinkAnnotation[] {
		return this.byOccurrence.get(id) ?? EMPTY_ANNOTATIONS;
	}
}

const EMPTY_ANNOTATIONS: readonly SemanticLinkAnnotation[] = Object.freeze([]);
