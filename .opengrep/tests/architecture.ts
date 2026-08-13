// ruleid: radiora.ui-no-storage-or-desktop-import
import "../storage/example.ts";

// ok: radiora.ui-no-storage-or-desktop-import
import "../services/example.ts";

// ruleid: radiora.ui-no-deno-io
Deno.readTextFile("data.json");
