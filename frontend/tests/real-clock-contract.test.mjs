import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as display from '../src/displayTime.ts';
import { clockLabel } from '../src/useRealClock.ts';
test('frontend active source contains no retired clock contract or hard-coded incident default', () => {
 for (const file of readdirSync(new URL('../src/', import.meta.url), { recursive: true })) {
  if (!/\.(ts|tsx|css)$/.test(file)) continue;
  const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(text, /storyNow|storyClock|story-clock|openedStoryAt|formatTimeCT|alertTimeCT|\bctClock\b|\bctTime\b|\bCT\b|TX-26-0412/, file);
 }
});
test('real clock uses explicit customer timezone, otherwise browser timezone', () => {
 const now = Date.parse('2026-11-17T09:10:00Z');
 const expected = zone => new Intl.DateTimeFormat('en-US', {timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(now);
 assert.equal(display.formatTime(new Date(now), 'America/New_York'), expected('America/New_York'));
 assert.equal(display.formatTime(new Date(now)), expected(undefined));
 assert.equal(clockLabel(now, 'Asia/Tokyo'), expected('Asia/Tokyo'));
 assert.equal(clockLabel(now), expected(undefined));
 assert.equal(display.formatTime('2026-11-17T09:10:00'), '—');
});
