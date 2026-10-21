// Replay an unmodified, externally captured local synthetic consequence projection.
// This fixture has no application backend, credentials or production access.
import { createRoot } from 'react-dom/client';
import IncidentInfrastructureDetail from '../src/IncidentInfrastructureDetail.tsx';
import type { ConsequenceProjection } from '../src/consequencesModel.ts';
import '../src/styles.css';
import '../src/command-center-views.css';
import '../src/incident-view.css';
import '../src/shared-components.css';
import '../src/visual-shell.css';
import '../src/theme.css';
const value: ConsequenceProjection = await (await fetch('/projection.json')).json();
const selections: (string | null)[] = [];
createRoot(document.getElementById('root')!).render(<IncidentInfrastructureDetail value={value} onInspect={() => {}} onSelectEntity={id => selections.push(id)} />);
(window as typeof window & { selectionFixture?: unknown }).selectionFixture = { incidentId: value.incident?.id, selections };
