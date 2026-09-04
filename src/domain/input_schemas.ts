import * as v from "valibot";
import { RelationTypeNameSchema } from "./relation_type.ts";
import {
	IdSchema,
	LinkEndpointSchema,
	LinkStatusSchema,
	PersistedLinkOriginSchema,
} from "./schemas.ts";

export const CreateItemInputSchema = v.object({
	text: v.string("Item text must be a string"),
	parentId: v.nullable(IdSchema),
	afterId: v.optional(v.nullable(IdSchema)),
});

export const QuickCaptureInputSchema = v.pipe(
	v.string("Quick capture text must be a string"),
	v.check((val) => val.trim().length > 0, "Quick Capture text must not be blank"),
);

export const CreateOccurrenceInputSchema = v.object({
	workId: IdSchema,
	parentId: v.nullable(IdSchema),
	afterId: v.optional(v.nullable(IdSchema)),
	branchId: v.optional(IdSchema),
	contextualHeading: v.optional(v.string()),
});

export const MoveItemInputSchema = v.object({
	id: IdSchema,
	parentId: v.nullable(IdSchema),
	afterId: v.optional(v.nullable(IdSchema)),
});

export const CreateLinkInputSchema = v.object({
	fromId: IdSchema,
	toId: IdSchema,
	type: RelationTypeNameSchema,
	status: v.optional(LinkStatusSchema),
	origin: v.optional(PersistedLinkOriginSchema),
	reason: v.optional(v.string()),
	fromEndpoint: v.optional(LinkEndpointSchema),
	toEndpoint: v.optional(LinkEndpointSchema),
});
