import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  automationPresets,
  integrationConnectionPresets,
} from "../frontend/src/presets.js";

const read = (path) => readFileSync(path, "utf8");

const appSource = read("frontend/src/App.jsx");
const readme = read("README.md");
const backendServices = read("backend/app/services.py");
const backendMain = read("backend/app/main.py");
const liveWriters = read("backend/app/live_writers.py");

const requiredServices = ["github", "notion", "figma", "google_calendar", "custom"];
const requiredPresetKeys = ["github_notion", "team_notion_board_to_github", "team_notion_gantt_to_calendar", "figma_calendar", "custom"];
const requiredAutomationButtons = [
  "GitHub → Notion",
  "Notion → GitHub",
  "GANTT → Calendar",
  "Figma → Calendar",
  "내 기본값 적용",
  "직접 구성",
];
const serviceLabels = {
  github: "GitHub",
  notion: "Notion",
  figma: "Figma",
  google_calendar: "Google Calendar",
  custom: "Custom API",
};

const presetKeys = automationPresets.map((preset) => preset.template_preset);
assert.deepEqual([...new Set(presetKeys)].sort(), requiredPresetKeys.sort(), "automation preset keys must match the documented built-in presets");
assert.deepEqual(Object.keys(integrationConnectionPresets).sort(), requiredServices.sort(), "connection preset services must match the supported service set");

for (const preset of automationPresets) {
  assert.ok(requiredPresetKeys.includes(preset.template_preset), `${preset.template_preset} must be a supported template preset`);
  assert.ok(preset.name && preset.source && preset.destination, `${preset.template_preset} must describe the route`);
  assert.ok(preset.ai_provider && preset.ai_model && preset.ai_api_base, `${preset.template_preset} must carry AI settings`);
  assert.ok(Array.isArray(preset.custom_connections) && preset.custom_connections.length > 0, `${preset.template_preset} must include executable connections`);

  for (const connection of preset.custom_connections) {
    assert.ok(requiredServices.includes(connection.service), `${preset.template_preset} uses unsupported service ${connection.service}`);
    assert.equal(integrationConnectionPresets[connection.service].service, connection.service, `${connection.service} must have a matching connection preset`);
    assert.ok(connection.api && connection.auth_key_name && connection.operation, `${connection.service} connection must include API/auth/operation`);
    assert.ok(connection.template.includes("{") && connection.template.includes("}"), `${connection.service} connection template must include placeholders`);
  }
}

for (const [service, connection] of Object.entries(integrationConnectionPresets)) {
  assert.equal(connection.service, service, `${service} connection preset service must match its key`);
  assert.ok(connection.label && connection.url !== undefined, `${service} connection preset must be user-configurable`);
  assert.ok(connection.api && connection.auth_key_name && connection.operation, `${service} connection preset must be executable`);
  assert.ok(connection.template.includes("{") && connection.template.includes("}"), `${service} connection preset template must include placeholders`);
}

for (const button of requiredAutomationButtons) {
  assert.ok(appSource.includes(button), `automation form must expose preset button: ${button}`);
}

for (const service of requiredServices) {
  assert.ok(appSource.includes(`value="${service}"`) || appSource.includes(`addProfileConnection(kind)`) || appSource.includes(`addIntegrationConnection(kind)`), `UI must expose service ${service}`);
  assert.ok(appSource.includes(`integrationConnectionPresets`), "UI must use integrationConnectionPresets for profile/default connection builders");
  assert.ok(readme.includes(service) || readme.includes(serviceLabels[service]), `README must document ${service}`);
  assert.ok(backendServices.includes(service), `automation agent planner must understand ${service}`);
  assert.ok(backendMain.includes(service) || liveWriters.includes(service), `backend routes/live writers must expose ${service}`);
}

assert.ok(appSource.includes("defaultAutomation"), "UI must import/use GitHub + Notion preset");
assert.ok(appSource.includes("figmaCalendarPreset"), "UI must import/use Figma + Calendar preset");
assert.ok(appSource.includes("customPreset"), "UI must import/use custom API preset");
assert.ok(readme.includes("사용자 기본값 적용"), "README must explain user default automation settings");
assert.ok(readme.includes("자동화 연결 미리보기"), "README must explain automation connection preview");

console.log(JSON.stringify({
  ok: true,
  checked: {
    automationPresetKeys: presetKeys,
    connectionServices: Object.keys(integrationConnectionPresets),
    automationButtons: requiredAutomationButtons,
    backendPlanner: "backend/app/services.py",
    docs: "README.md",
  },
}, null, 2));
