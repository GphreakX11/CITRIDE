/** Boundaries for existing direct-function/fake-hook legacy host unit suites.
 * These suites do not mount a React Provider. Real chooser/incident-screen
 * behavior is covered by their own SSR suites and the browser link audit.
 */
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stubs = new Map([
  ['./analystIncidentContext.ts', 'export const useAnalystIncident=()=>null;export function AnalystIncidentProvider({children}){return children}'],
  ['./AnalystIncidentChooser.tsx', 'export function AnalystIncidentContextBar(){return null}export function AnalystIncidentChooser(){return null}'],
  ['./AnalystIncidentScreens.tsx', 'export default function AnalystIncidentScreens(){return null}export const handlesAnalystIncidentView=()=>false;'],
]);
export const analystHostUnitStub = spec => stubs.has(spec) ? data(stubs.get(spec)) : undefined;
