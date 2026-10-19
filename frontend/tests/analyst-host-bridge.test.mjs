import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('Analyst host routes no-case screens by shared incident context, without changing Command routing', () => {
  const host = source('CommandWorkspace.tsx');
  assert.match(host, /const analystContext = useAnalystIncident\(\)/);
  assert.match(host, /mode === "analyst" && analystContext && handlesAnalystIncidentView\(view, analystContext.activeCase\)/);
  assert.match(host, /showAnalystIncidentScreen \? \(\s*<AnalystIncidentScreens/);
  assert.match(host, /if \(mode === "command"\)[\s\S]*<CommandCenterViews/);
});

test('Analyst host prefers the open-incident chooser over the saved-case-only header', () => {
  const host = source('CommandWorkspace.tsx');
  assert.match(host, /showIncidentContextBar && mode === "analyst" && analystContext \? \(\s*<AnalystIncidentContextBar/);
  assert.match(host, /mode === "analyst"\s*\? analystContext\?\.selectedIncident/);
  assert.match(host, /onOpenAlerts=\{\(\) => onNavigate\("command"\)\}/);
  assert.match(host, /onOpenAnalyst\("entity-profile", analystContext\?\.activeCase\?\.id \?\? null, id\)/);
});

test('shared legacy readouts and case history use the configured operations clock', () => {
  const readouts = source('CommandReadouts.tsx');
  assert.doesNotMatch(readouts, /\.toLocaleString\(\)/);
  assert.match(readouts, /formatTime\(eventTimestamp\(event, data, records\)\)/);
  const casework = source('CommandCasework.tsx');
  assert.match(casework, /Closed at \{recordClock\(selected.closedAt\)\}/);
  assert.match(casework, /<dd>\{recordClock\(run.createdAt\)\}<\/dd>/);
});
