import { mount } from "svelte";
import { createBodyEditorController } from "./body_editor_controller.svelte.ts";
import { createTauriWorkspaceAdapter } from "./tauri_workspace_adapter.ts";
import V3App from "./V3App.svelte";
import "./v3.css";

/** Composition of the v3 body-slice page: Tauri adapter → controller → view. */
const target = document.getElementById("app");
if (!target) throw new Error("#app mount target was not found.");
const controller = createBodyEditorController(createTauriWorkspaceAdapter());
mount(V3App, { target, props: { controller } });
// load() records every failure in controller state and never rejects.
void controller.load();
