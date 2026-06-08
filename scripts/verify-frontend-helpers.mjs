import assert from "node:assert/strict";
import {
  buildSystemReadinessCards,
  getHealthFailureMessage,
  getRunStatus,
  mergePostsById,
  parseRunResult,
  summarizeRunResult,
} from "../frontend/src/viewModel.js";
import {
  automationPresets,
  customPreset,
  defaultAutomation,
  defaultIntegration,
  defaultKnowledge,
  figmaCalendarPreset,
  integrationConnectionPresets,
} from "../frontend/src/presets.js";

const parsed = parseRunResult('{"agent":"SyncPlannerAgent","route":"GitHub -> Notion","targets":[1,2],"externalRagSources":[3],"status":"CHANGED"}');
assert.equal(parsed.agent, "SyncPlannerAgent");
assert.equal(summarizeRunResult(parsed), "SyncPlannerAgent / GitHub -> Notion / 2 targets / 1 RAG sources");
assert.equal(getRunStatus(parsed), "changed");

const invalid = parseRunResult("not json");
assert.deepEqual(invalid, { raw: "not json" });
assert.equal(getRunStatus("not json"), "not json");

const merged = mergePostsById([{ id: 1, title: "first" }, { id: 2, title: "second" }], [{ id: 2, title: "duplicate" }, { id: 3, title: "third" }]);
assert.deepEqual(merged.map((post) => post.title), ["first", "second", "third"]);

const cards = buildSystemReadinessCards({
  providerReadiness: [{ ready: true }, { ready: false }],
  knowledgeSources: [{ id: 1 }, { id: 2 }, { id: 3 }],
  tasks: [{ id: 10 }],
  healthStatus: { status: 200, ok: true, data: { database: { ok: true } } },
});
assert.equal(cards.length, 8);
assert.deepEqual(cards.find((card) => card.label === "FastAPI"), { label: "FastAPI", value: "HTTP 200", ok: true });
assert.deepEqual(cards.find((card) => card.label === "PostgreSQL"), { label: "PostgreSQL", value: "connected", ok: true });
assert.deepEqual(cards.find((card) => card.label === "RAG"), { label: "RAG", value: "3 sources", ok: true });
assert.deepEqual(cards.find((card) => card.label === "Agent"), { label: "Agent", value: "1 automations", ok: true });
assert.deepEqual(cards.find((card) => card.label === "Live APIs"), { label: "Live APIs", value: "1/2 ready", ok: true });

const emptyCards = buildSystemReadinessCards();
assert.deepEqual(emptyCards.find((card) => card.label === "PostgreSQL"), { label: "PostgreSQL", value: "not checked", ok: false });
assert.deepEqual(emptyCards.find((card) => card.label === "Live APIs"), { label: "Live APIs", value: "0/0 ready", ok: false });

const databaseBlockedCards = buildSystemReadinessCards({
  healthStatus: { status: 503, ok: false, data: { database: { ok: false, error: "PostgreSQL is not reachable" } } },
});
assert.deepEqual(databaseBlockedCards.find((card) => card.label === "FastAPI"), { label: "FastAPI", value: "HTTP 503", ok: false });
assert.deepEqual(databaseBlockedCards.find((card) => card.label === "PostgreSQL"), { label: "PostgreSQL", value: "blocked 503", ok: false });
assert.equal(getHealthFailureMessage({ status: 503, ok: false, data: { database: { error: "PostgreSQL is not reachable" } } }), "PostgreSQL is not reachable");
assert.equal(getHealthFailureMessage({ status: "error", ok: false, statusText: "network failed" }), "network failed");
assert.equal(getHealthFailureMessage({ status: 500, ok: false }), "HTTP 500");
assert.equal(getHealthFailureMessage({ status: 200, ok: true }), "");

for (const preset of automationPresets) {
  assert.equal(typeof preset.name, "string");
  assert.ok(preset.name.length >= 4, "automation preset name should be useful");
  assert.ok(Number.isInteger(preset.interval_minutes) && preset.interval_minutes >= 1, "automation interval should be a positive integer");
  assert.ok(preset.ai_provider && preset.ai_model && preset.ai_api_base, "automation preset should include AI provider/model/base");
  assert.ok(preset.template_preset, "automation preset should identify the template preset");
  assert.ok(Array.isArray(preset.custom_connections) && preset.custom_connections.length >= 1, "automation preset should include at least one connection");
  for (const connection of preset.custom_connections) {
    assert.ok(connection.label && connection.service && connection.api && connection.auth_key_name && connection.operation, "connection metadata should be complete");
    assert.ok(connection.template.includes("{"), "connection template should contain placeholders");
  }
}

assert.deepEqual(defaultAutomation.custom_connections.map((connection) => connection.service), ["github", "notion"]);
assert.deepEqual(figmaCalendarPreset.custom_connections.map((connection) => connection.service), ["figma", "google_calendar"]);
assert.deepEqual(customPreset.custom_connections.map((connection) => connection.service), ["custom"]);
assert.equal(defaultAutomation.template_preset, "github_notion");
assert.equal(figmaCalendarPreset.figma_file_url.includes("figma.com/design"), true);
assert.equal(customPreset.api_provider, "사용자 지정 API");
assert.equal(defaultKnowledge.source_type, "document");
assert.ok(defaultKnowledge.extracted_text.includes("GitHub 이슈"));
assert.equal(defaultIntegration.source_kind, "github");
assert.ok(defaultIntegration.rag_targets.includes("pull_requests"));
assert.deepEqual(defaultIntegration.custom_connections.map((connection) => connection.service), ["github"]);
assert.deepEqual(Object.keys(integrationConnectionPresets), ["github", "notion", "figma", "google_calendar", "custom"]);
for (const [kind, connection] of Object.entries(integrationConnectionPresets)) {
  assert.equal(connection.service, kind);
  assert.ok(connection.api && connection.auth_key_name && connection.operation, `${kind} connection preset must be executable`);
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "parseRunResult",
    "summarizeRunResult",
    "getRunStatus",
    "mergePostsById",
    "buildSystemReadinessCards",
    "getHealthFailureMessage",
    "automationPresets",
    "defaultKnowledge",
    "defaultIntegration",
    "integrationConnectionPresets",
  ],
}, null, 2));
