-- Radiora storage schema version 0 fixture.
-- FROM is stored as parent (in) -> evolved_from -> child (out).

DEFINE TABLE outline_item SCHEMAFULL;
DEFINE FIELD text ON outline_item TYPE string;
DEFINE FIELD order_key ON outline_item TYPE number;
DEFINE FIELD collapsed ON outline_item TYPE bool DEFAULT false;
DEFINE FIELD created_at ON outline_item TYPE string;
DEFINE FIELD updated_at ON outline_item TYPE string;
DEFINE FIELD title ON outline_item TYPE string DEFAULT "";
DEFINE FIELD title_key ON outline_item TYPE string DEFAULT "";
DEFINE FIELD title_prefix ON outline_item TYPE string DEFAULT "";
DEFINE FIELD search_terms ON outline_item TYPE string DEFAULT "";
DEFINE TABLE evolved_from TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
DEFINE TABLE liked TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
DEFINE TABLE fixed TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
DEFINE TABLE conflicted TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
DEFINE TABLE in_knot TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
DEFINE FIELD created_at ON liked TYPE string;
DEFINE FIELD created_at ON fixed TYPE string;
DEFINE FIELD created_at ON conflicted TYPE string;
DEFINE FIELD created_at ON in_knot TYPE string;
DEFINE TABLE knot SCHEMAFULL;
DEFINE FIELD cycle_ids ON knot TYPE array<string>;
DEFINE FIELD created_at ON knot TYPE string;
DEFINE TABLE search_alias SCHEMAFULL;
DEFINE FIELD canonical ON search_alias TYPE string;
DEFINE FIELD variants ON search_alias TYPE array<string>;
DEFINE FIELD created_at ON search_alias TYPE string;
DEFINE FIELD updated_at ON search_alias TYPE string;
DEFINE TABLE emergence_feedback SCHEMAFULL;
DEFINE FIELD action ON emergence_feedback TYPE string;
DEFINE FIELD updated_at ON emergence_feedback TYPE string;
DEFINE TABLE saved_rule_query SCHEMAFULL;
DEFINE FIELD name ON saved_rule_query TYPE string;
DEFINE FIELD source ON saved_rule_query TYPE string;
DEFINE FIELD created_at ON saved_rule_query TYPE string;
DEFINE FIELD updated_at ON saved_rule_query TYPE string;
DEFINE TABLE schema_metadata SCHEMAFULL;
DEFINE FIELD version ON schema_metadata TYPE number;
DEFINE FIELD updated_at ON schema_metadata TYPE string;
DEFINE FIELD last_migration_id ON schema_metadata TYPE string;
DEFINE FIELD app_version ON schema_metadata TYPE string;
DEFINE TABLE migration_journal SCHEMAFULL;
DEFINE FIELD from_version ON migration_journal TYPE number;
DEFINE FIELD to_version ON migration_journal TYPE number;
DEFINE FIELD started_at ON migration_journal TYPE string;
DEFINE FIELD completed_at ON migration_journal TYPE option<string>;
DEFINE FIELD app_version ON migration_journal TYPE string;
DEFINE FIELD status ON migration_journal TYPE string;
DEFINE FIELD error ON migration_journal TYPE option<string>;
DEFINE ANALYZER title_prefix FILTERS lowercase, edgengram(1,64);
DEFINE ANALYZER lexical TOKENIZERS class, camel, punct FILTERS lowercase;
DEFINE ANALYZER japanese_terms TOKENIZERS blank FILTERS lowercase;
DEFINE INDEX outline_title_prefix ON outline_item FIELDS title_prefix
	FULLTEXT ANALYZER title_prefix;
DEFINE INDEX outline_title_lexical ON outline_item FIELDS title_key
	FULLTEXT ANALYZER lexical BM25;
DEFINE INDEX outline_text_lexical ON outline_item FIELDS text
	FULLTEXT ANALYZER lexical BM25;
DEFINE INDEX outline_terms_lexical ON outline_item FIELDS search_terms
	FULLTEXT ANALYZER japanese_terms BM25;

CREATE outline_item:`11111111-1111-4111-8111-111111111111` CONTENT {
	text: "原稿\n\n日本語・**Markdown**・radiora://item/22222222-2222-4222-8222-222222222222",
	order_key: 1024,
	collapsed: false,
	created_at: "2026-07-01T00:00:00.000Z",
	updated_at: "2026-07-02T00:00:00.000Z"
};
CREATE outline_item:`22222222-2222-4222-8222-222222222222` CONTENT {
	text: "派生稿\n改行を保持する",
	order_key: 2048,
	collapsed: true,
	created_at: "2026-07-03T00:00:00.000Z",
	updated_at: "2026-07-04T00:00:00.000Z"
};
CREATE outline_item:`33333333-3333-4333-8333-333333333333` CONTENT {
	text: "親が見つからない項目",
	order_key: 3072,
	collapsed: false,
	created_at: "2026-07-08T00:00:00.000Z",
	updated_at: "2026-07-08T00:00:00.000Z"
};
CREATE outline_item:`44444444-4444-4444-8444-444444444444` CONTENT {
	text: "循環項目A",
	order_key: 4096,
	collapsed: false,
	created_at: "2026-07-09T00:00:00.000Z",
	updated_at: "2026-07-09T00:00:00.000Z"
};
CREATE outline_item:`55555555-5555-4555-8555-555555555555` CONTENT {
	text: "循環項目B",
	order_key: 5120,
	collapsed: false,
	created_at: "2026-07-10T00:00:00.000Z",
	updated_at: "2026-07-10T00:00:00.000Z"
};
RELATE outline_item:`11111111-1111-4111-8111-111111111111`
	->evolved_from->outline_item:`22222222-2222-4222-8222-222222222222`;
RELATE outline_item:`99999999-9999-4999-8999-999999999999`
	->evolved_from->outline_item:`33333333-3333-4333-8333-333333333333`;
RELATE outline_item:`55555555-5555-4555-8555-555555555555`
	->evolved_from->outline_item:`44444444-4444-4444-8444-444444444444`;
RELATE outline_item:`44444444-4444-4444-8444-444444444444`
	->evolved_from->outline_item:`55555555-5555-4555-8555-555555555555`;
RELATE outline_item:`11111111-1111-4111-8111-111111111111`
	->liked->outline_item:`22222222-2222-4222-8222-222222222222`
	CONTENT { created_at: "2026-07-05T00:00:00.000Z" };
CREATE search_alias:`alias-1` CONTENT {
	canonical: "系譜",
	variants: ["来歴", "genealogy"],
	created_at: "2026-07-06T00:00:00.000Z",
	updated_at: "2026-07-06T00:00:00.000Z"
};
CREATE emergence_feedback:`suggestion-1` CONTENT {
	action: "pin",
	updated_at: "2026-07-06T00:00:00.000Z"
};
CREATE saved_rule_query:`query-1` CONTENT {
	name: "LIKEリンク",
	source: "?- link(\"LIKE\", From, To).",
	created_at: "2026-07-07T00:00:00.000Z",
	updated_at: "2026-07-07T00:00:00.000Z"
};
