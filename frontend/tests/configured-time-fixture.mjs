// Mirror runtime customer configuration, independent of the test machine's timezone.
import { readFileSync } from "node:fs";
import { configureDisplayTime } from "../src/displayTime.ts";
export const fixtureTimeZone = JSON.parse(readFileSync(new URL("../../data/scripted/c4_reference.json", import.meta.url), "utf8")).operationsTimeZone;
configureDisplayTime(fixtureTimeZone);
