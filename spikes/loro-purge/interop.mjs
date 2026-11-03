import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoroDoc, VersionVector } from "loro-crdt";

const dir = process.argv[2];
assert.ok(dir, "expected fixture output directory");
const read = (name) => readFileSync(join(dir, name));
const write = (name, bytes) => writeFileSync(join(dir, name), bytes);
const doc = new LoroDoc();
doc.import(read("rust.snapshot"));
assert.deepEqual(doc.toJSON(), JSON.parse(read("rust-base.json")));
assert.equal(doc.version().compare(VersionVector.decode(read("rust-base.vv"))), 0);
doc.import(read("rust.update"));
assert.deepEqual(doc.toJSON(), JSON.parse(read("rust-final.json")));
assert.equal(doc.version().compare(VersionVector.decode(read("rust-final.vv"))), 0);
write("wasm.snapshot", doc.export({ mode: "snapshot" }));
const from = doc.version();
doc.setPeerId("384");
doc.getText("body").insert(0, "WASM:");
doc.getMap("references").set("display-d", "owner-a");
doc.getList("order").insert(1, "display-d");
doc.commit();
write("wasm.update", doc.export({ mode: "update", from }));
write("wasm-final.snapshot", doc.export({ mode: "snapshot" }));
write("wasm-final.vv", doc.version().encode());
write("wasm-final.json", JSON.stringify(doc.toJSON()));
if (process.argv[3] === "verify") {
  assert.deepEqual(JSON.parse(read("roundtrip.json")), doc.toJSON());
  assert.equal(doc.version().compare(VersionVector.decode(read("roundtrip.vv"))), 0);
}
console.log("WASM/Rust normalized data, references, order, version: PASS");
