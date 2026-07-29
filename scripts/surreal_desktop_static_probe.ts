import "./surreal_desktop_static_marker.ts";
import { SurrealGraphStore } from "../src/storage/surreal_store.ts";

// The static import above is the behavior under test. The normal probe imports the same
// module dynamically later, after its persistent logger is available.
void SurrealGraphStore;
Deno.env.set("RADIORA_SURREAL_PROBE_STAGE", "p5");
await import("./surreal_desktop_probe.ts");
