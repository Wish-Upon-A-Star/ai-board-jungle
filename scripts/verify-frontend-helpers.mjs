import assert from "node:assert/strict";
import {
  buildSystemReadinessCards,
  getRunStatus,
  mergePostsById,
  parseRunResult,
  summarizeRunResult,
} from "../frontend/src/viewModel.js";

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
});
assert.equal(cards.length, 8);
assert.deepEqual(cards.find((card) => card.label === "RAG"), { label: "RAG", value: "3 sources", ok: true });
assert.deepEqual(cards.find((card) => card.label === "Agent"), { label: "Agent", value: "1 automations", ok: true });
assert.deepEqual(cards.find((card) => card.label === "Live APIs"), { label: "Live APIs", value: "1/2 ready", ok: true });

const emptyCards = buildSystemReadinessCards();
assert.deepEqual(emptyCards.find((card) => card.label === "Live APIs"), { label: "Live APIs", value: "0/0 ready", ok: false });

console.log(JSON.stringify({ ok: true, checked: ["parseRunResult", "summarizeRunResult", "getRunStatus", "mergePostsById", "buildSystemReadinessCards"] }, null, 2));
