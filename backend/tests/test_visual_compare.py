"""Offline contract tests: python3 -m unittest discover -s backend/tests -p test_visual_compare.py -v."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from copy import deepcopy
from unittest.mock import MagicMock, call, patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'visual_compare.py'
spec = importlib.util.spec_from_file_location('visual_compare', SCRIPT)
assert spec is not None and spec.loader is not None
vc = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = vc
spec.loader.exec_module(vc)


class VisualCompareTests(unittest.TestCase):
    def setUp(self):
        output = tempfile.TemporaryDirectory()
        self.addCleanup(output.cleanup)
        self.output = output.name

    def parse(self, *extra):
        return vc.parse_args(['--app-url', 'http://127.0.0.1:9999', '--output', self.output, *extra])

    def test_cli_requires_app_and_isolation_scope(self):
        for args in [[], ['--app-url', 'file:///tmp/app'],
                     ['--app-url', 'http://localhost:8777', '--reset-demo'],
                     ['--app-url', 'http://localhost:8777', '--prepare-isolated'],
                     ['--app-url', 'http://localhost:8777', '--prepare-isolated',
                      '--confirm-isolated', 'http://localhost:9999'],
                     ['--app-url', 'http://localhost:9999', '--mockup', 'x', '--mockup-dir', 'y']]:
            with self.subTest(args=args), self.assertRaises(SystemExit):
                vc.parse_args(args)
        a = self.parse('--case-id', 'case-existing')
        self.assertFalse(a.capture)
        self.assertFalse(a.reset_demo)
        a = self.parse('--capture', '--prepare-isolated', '--reset-demo',
                       '--confirm-isolated', 'http://127.0.0.1:9999')
        self.assertTrue(a.prepare_isolated)

    def test_all_routes_and_legacy_reference_mapping(self):
        screens = {s.name: s for s in vc.SCREENS}
        self.assertEqual(len(screens), 25)
        self.assertEqual(screens['C1'].board, 'Main')
        self.assertEqual(screens['C6'].board, 'Brief')
        self.assertEqual(screens['C7'].board, 'C6')
        self.assertEqual(screens['A5'].view, 'coordination')
        self.assertEqual(sum(s.name.startswith('Advanced-') for s in vc.SCREENS), 8)
        url = vc.app_route('http://localhost:9999/?stale=yes&tab=raw', screens['A3-hunt'], 'case-real', 'entity-real')
        self.assertIn('case=case-real', url)
        self.assertIn('tab=hunt', url)
        self.assertIn('mode=analyst', url)
        self.assertIn('view=cyber', url)
        self.assertNotIn('stale', url)

    def test_fallback_explicit_and_partial_unavailable_report(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / 'Main.dc.html').write_text('<h1>Original C1</h1>')
            (d / 'README.md').write_text('Original board provenance')
            a = self.parse('--mockup-dir', str(d), '--output', str(d / 'out'))
            rows, provenance = vc.preflight(a)
            self.assertEqual(len(rows), 25)
            self.assertEqual({(r['width'], r['height']) for r in rows}, {(1920, 1080)})
            self.assertTrue(all(r['full_page'] for r in rows))
            c1 = next(r for r in rows if r['screen'] == 'C1')
            self.assertEqual(c1['status'], 'preflight-only')
            self.assertTrue(c1['reference']['url'].startswith('file:///'))
            self.assertIn('README.md', str(provenance))
            self.assertTrue(any(r['status'] == 'reference-unavailable' for r in rows))
            vc.write_report(a.output, rows, provenance, {'capture': False})
            report = json.loads((a.output / 'report.json').read_text())
            self.assertEqual(report['valid_pairs'], 0)
            self.assertIn('reference-unavailable', (a.output / 'index.html').read_text())
            a = self.parse('--mockup', str(d / 'absent.html'))
            rows, _ = vc.preflight(a)
            self.assertTrue(all(r['status'] == 'reference-unavailable' for r in rows))

    def test_original_reference_static_and_runtime_failures(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'A3.dc.html'
            p.write_text('<script src="./support.js"></script><p>{{ value }}</p>')
            audit = vc.audit_reference(p)
            self.assertTrue(audit['template_tokens'])
            self.assertTrue(audit['missing_local_scripts'])
        self.assertIn('unresolved-template', vc.render_issues('{{ missing }}', [], []))
        self.assertIn('script-error', vc.render_issues('rendered', ['broken'], []))
        self.assertIn('blocked-egress', vc.render_issues('rendered', [], [{'url': 'https://fonts.googleapis.com'}]))
        self.assertEqual(vc.render_issues('rendered', [], []), [])
        error = vc.CaptureFailure('navigation blocked', {'blocked': [{'url': 'https://cdn.example'}]})
        self.assertEqual(error.diagnostics['blocked'][0]['url'], 'https://cdn.example')

    def test_no_egress_or_browser_writes(self):
        origin = 'http://127.0.0.1:9999'
        self.assertTrue(vc.request_allowed(origin + '/v1/bootstrap', 'GET', origin))
        self.assertFalse(vc.request_allowed('http://127.0.0.1:8777/v1/bootstrap', 'GET', origin))
        self.assertFalse(vc.request_allowed(origin + '/v1/demo/reset', 'POST', origin))
        self.assertFalse(vc.request_allowed('https://cdn.example/style.css', 'GET', None))
        self.assertTrue(vc.request_allowed('file:///tmp/original.html', 'GET', None))
        self.assertFalse(vc.request_allowed('https://evil.example', 'GET', origin))

    def test_side_by_side_exact_pixels(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            left, right, out = [d / f'{n}.png' for n in ('left', 'right', 'pair')]
            Image.new('RGB', (12, 8), 'red').save(left)
            Image.new('RGB', (12, 8), 'blue').save(right)
            vc.compose_pair(left, right, out)
            with Image.open(out) as image:
                self.assertEqual(image.size, (24, 8))
                self.assertEqual(image.getpixel((0, 0)), (255, 0, 0))
                self.assertEqual(image.getpixel((12, 0)), (0, 0, 255))
            Image.new('RGB', (10, 8)).save(right)
            with self.assertRaises(ValueError):
                vc.compose_pair(left, right, out)

    def test_unified_requires_discovered_board_not_app_substitution(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'original.html'
            p.write_text('<section id="Main">Original</section>')
            a = self.parse('--mockup', str(p))
            rows, _ = vc.preflight(a)
            c1 = next(r for r in rows if r['screen'] == 'C1')
            self.assertIsNone(c1['reference']['selector'])
            self.assertEqual(c1['reference']['url'], p.as_uri())
            self.assertFalse(c1['reference']['routed'])
            self.assertTrue(any(r['status'] == 'reference-unavailable' for r in rows))


    def test_readonly_existing_case_and_missing_state(self):
        args = self.parse('--capture', '--case-id', 'existing')
        incident = dict(id='existing', version=3, eventId='event-vpn-a',
                        contextSnapshot={'cyberAsset': {'id': 'real-asset'}},
                        runSnapshot={'id': 'saved-run', 'request': {'scenarioId': 'unsafe-water'}})
        with patch.object(vc, 'api', side_effect=[{}, [incident]]) as api:
            execution = {}
            self.assertEqual(vc.prepare_case(args, execution), 'real-asset')
            self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))
        with patch.object(vc, 'api', side_effect=[{}, []]):
            with self.assertRaisesRegex(RuntimeError, 'not found'):
                vc.prepare_case(args, {})

    @staticmethod
    def analyzed_case() -> dict:
        # Explicit offline fixture, not a claim about live API state. IDs are
        # intentionally noncanonical to catch dependency/entity hard-coding.
        return dict(
            id='new-case', title='Watershed', version=2, eventId='event-vpn-a',
            contextSnapshot={'cyberAsset': {'id': 'asset-real'}},
            runSnapshot=dict(
                id='run-real', baselineRevision=8,
                request=dict(scenarioId='unsafe-water', evaluationHour=1, horizonHours=12),
                baselineSnapshot=dict(
                    entities=[dict(id='dialysis-from-snapshot', label='Dialysis Center X')],
                    dependencies=[dict(id='water-from-snapshot', dependent='dialysis-from-snapshot',
                                       requiredService='treated_water')]),
                impacts=[dict(entityId='dialysis-from-snapshot', paths=[['water-from-snapshot']])]))

    @staticmethod
    def expected_what_if() -> dict:
        return dict(scenarioId='unsafe-water', evaluationHour=1, horizonHours=12,
                    expectedBaselineRevision=8, clientRequestId='stable-proof-what-if',
                    overrides=[dict(dependencyId='water-from-snapshot', backupMinHours=6,
                                    backupMaxHours=6, note='What-if from case Watershed')])

    def test_prepare_isolated_versions_and_identity(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.parse('--capture', '--prepare-isolated', '--reset-demo',
                              '--confirm-isolated', 'http://127.0.0.1:9999',
                              '--request-id', 'stable-proof', '--output', d)
            analyzed = self.analyzed_case()
            incident = dict(id='new-case', title='Watershed', version=1, eventId='event-vpn-a')
            execution = {}
            checkpoints = []
            responses = iter([{'baselineRevision': 7}, {}, {'baselineRevision': 8},
                              incident, analyzed, {'id': 'planning-real'}])

            def respond(*unused):
                journal = Path(d) / 'preparation.json'
                if journal.exists():
                    checkpoints.append(json.loads(journal.read_text()))
                return next(responses)

            with patch.object(vc, 'api', side_effect=respond) as api:
                self.assertEqual(vc.prepare_case(args, execution), 'asset-real')
                calls = api.call_args_list
                self.assertEqual([c.args[1] for c in calls], [
                    '/v1/bootstrap', '/v1/demo/reset', '/v1/bootstrap',
                    '/v1/command/incidents', '/v1/command/incidents/new-case/actions',
                    '/v1/cascade-runs'])
                self.assertEqual(calls[1].args[2]['expectedBaselineRevision'], 7)
                self.assertEqual(calls[1].args[2]['clientRequestId'], 'stable-proof-reset')
                self.assertEqual(calls[3].args[2]['expectedBaselineRevision'], 8)
                self.assertEqual(calls[3].args[2]['title'], 'Watershed')
                self.assertEqual(calls[3].args[2]['clientRequestId'], 'stable-proof-create')
                self.assertEqual(calls[4].args[2], dict(
                    action='analyze', scenarioId='unsafe-water', evaluationHour=1, horizonHours=12,
                    expectedVersion=1, clientRequestId='stable-proof-analyze'))
                self.assertEqual(calls[5].args[2], self.expected_what_if())
                self.assertEqual(args.case_id, 'new-case')
            journal = json.loads((Path(d) / 'preparation.json').read_text())
            self.assertEqual(journal, execution['preparation'])
            self.assertEqual(journal['completed'], ['reset', 'create', 'analyze', 'what-if'])
            self.assertTrue(all(s['status'] == 'accepted' for s in journal['steps']))
            self.assertEqual(journal['case_id'], 'new-case')
            self.assertEqual(journal['case_version'], 2)
            self.assertEqual(journal['run_id'], 'run-real')
            self.assertEqual(journal['what_if_run_id'], 'planning-real')
            pending = [j for j in checkpoints if j['steps'][-1]['status'] == 'pending']
            self.assertEqual([j['steps'][-1]['step'] for j in pending],
                             ['reset', 'create', 'analyze', 'what-if'])
            self.assertEqual(pending[-1]['run_id'], 'run-real')
            self.assertEqual(pending[-1]['steps'][-2]['response'], analyzed)
            self.assertEqual(execution['case']['run_id'], 'run-real')
            self.assertEqual(execution['case']['what_if_run_id'], 'planning-real')

    def test_ordered_subsets_expand_a3_and_reject_unknown_screens(self):
        args = self.parse('--screens', 'C4,C1,A3,A3-hunt,C4')
        self.assertEqual([s.name for s in vc.selected_screens(args)],
                         ['C4', 'C1', 'A3-timeline', 'A3-hunt', 'A3-raw'])
        self.assertEqual(len(vc.selected_screens(self.parse())), 25)
        with patch('sys.stderr'), self.assertRaises(SystemExit):
            self.parse('--screens', 'C4,not-a-screen')

    def test_unified_original_uses_own_hash_router_without_modification(self):
        with tempfile.TemporaryDirectory() as d:
            original = Path(d) / 'original.html'
            source = '<template id="tpl-C4">C4</template><template id="tpl-Main">C1</template>'
            source += '<template id="tpl-Advanced">Advanced</template>'
            original.write_text(source)
            args = self.parse('--mockup', str(original), '--screens', 'C4,C1,Advanced-lab')
            rows, provenance = vc.preflight(args)
            self.assertEqual([r['screen'] for r in rows], ['C4', 'C1', 'Advanced-lab'])
            self.assertEqual([r['reference']['url'] for r in rows],
                             [original.as_uri() + fragment
                              for fragment in ('#/C4', '#/Main', '#/Advanced/lab')])
            self.assertTrue(all(r['reference']['routed'] for r in rows))
            self.assertTrue(all(r['reference']['selector'] is None for r in rows))
            self.assertTrue(all(not r['capture_valid'] for r in rows))
            self.assertTrue(all(r['visual_conformance'] == 'not-reviewed' for r in rows))
            self.assertEqual(provenance['kind'], 'unified-original')
            self.assertEqual(original.read_text(), source)

    def test_unequal_heights_are_top_aligned_white_padding_only(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            left, right, out = [Path(d) / f'{name}.png' for name in ('left', 'right', 'pair')]
            for left_height, right_height in [(3, 7), (7, 3)]:
                with self.subTest(left_height=left_height, right_height=right_height):
                    Image.new('RGB', (4, left_height), 'red').save(left)
                    Image.new('RGB', (4, right_height), 'blue').save(right)
                    metadata = vc.compose_pair(left, right, out)
                    self.assertEqual(metadata, dict(reference=[4, left_height], app=[4, right_height],
                        composed=[8, 7], alignment='top', padding='white', rescaled=False, cropped=False))
                    with Image.open(out) as image:
                        self.assertEqual(image.size, (8, 7))
                        for y in range(7):
                            for x in range(8):
                                expected = ((255, 0, 0) if y < left_height else (255, 255, 255)) if x < 4 else (
                                    (0, 0, 255) if y < right_height else (255, 255, 255))
                                self.assertEqual(image.getpixel((x, y)), expected)

    def test_reports_merge_subsets_preserve_artifacts_and_separate_review(self):
        with tempfile.TemporaryDirectory() as d:
            output = Path(d)
            rows, provenance = vc.preflight(self.parse('--screens', 'C4,C1'))
            first = dict(rows[0], status='captured', artifact='C4.png', capture_valid=True,
                         valid_proof=True, case={'id': 'case-real'})
            vc.write_report(output, [first], provenance, {'capture': True, '_private': 'not serialized'})
            vc.write_report(output, [rows[1]], provenance, {'capture': False})
            failed = dict(rows[0], status='capture-failed', reason='offline test failure')
            vc.write_report(output, [failed], provenance, {'capture': True, 'error': 'offline test failure'})
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual([r['screen'] for r in report['rows']], ['C4', 'C1'])
            self.assertEqual(report['requested_pairs'], 2)
            self.assertEqual(report['latest_requested_pairs'], 1)
            self.assertEqual(report['valid_pairs'], 1)
            self.assertEqual(len(report['executions']), 3)
            self.assertNotIn('_private', report['executions'][0])
            retained = report['rows'][0]
            self.assertEqual(retained['artifact'], 'C4.png')
            self.assertEqual(retained['latest_attempt']['status'], 'capture-failed')
            self.assertEqual(retained['visual_conformance'], 'not-reviewed')
            index = (output / 'index.html').read_text()
            self.assertIn('C4.png', index)
            self.assertIn('C1', index)
            self.assertIn('Visual conformance: not-reviewed', index)
            self.assertIn('Capture validity does NOT assert visual conformance', index)

    def test_corrupt_report_is_not_silently_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'report.json'
            path.write_text('{incomplete')
            with self.assertRaises(json.JSONDecodeError):
                vc.write_report(Path(d), [], {}, {})
            self.assertEqual(path.read_text(), '{incomplete')

    def test_what_if_uses_captured_dependency_and_refuses_missing_or_ambiguous_data(self):
        incident = self.analyzed_case()
        before = deepcopy(incident)
        self.assertEqual(vc.what_if_payload(incident, 'stable-proof'), self.expected_what_if())
        self.assertEqual(incident, before)
        mutations = [
            lambda r: r['baselineSnapshot'].update(entities=[]),
            lambda r: r['baselineSnapshot']['entities'].append(dict(id='duplicate', label='Dialysis Center X')),
            lambda r: r['impacts'][0].update(paths=[]),
            lambda r: r['baselineSnapshot']['dependencies'][0].update(requiredService='electricity'),
        ]
        for mutate in mutations:
            candidate = deepcopy(incident)
            mutate(candidate['runSnapshot'])
            with self.subTest(candidate=candidate), self.assertRaisesRegex(RuntimeError, 'exactly one'):
                vc.what_if_payload(candidate, 'stable-proof')

    def save_resume_journal(self, output):
        journal = dict(target='http://127.0.0.1:9999', request_id='stable-proof',
                       completed=['analyze', 'what-if'], steps=[
                           dict(step='analyze', status='accepted', response=self.analyzed_case()),
                           dict(step='what-if', status='accepted', response={'id': 'planning-real'})])
        vc.atomic_json(Path(output) / 'preparation.json', journal)
        return journal

    def test_resume_recovers_accepted_ids_and_only_performs_gets(self):
        with tempfile.TemporaryDirectory() as d:
            self.save_resume_journal(d)
            args = self.parse('--capture', '--output', d)
            journal = vc.load_journal(args)
            self.assertEqual((journal['case_id'], journal['case_version'], journal['run_id'], journal['what_if_run_id']),
                             ('new-case', 2, 'run-real', 'planning-real'))
            planning = dict(id='planning-real', baselineRevision=8, request=self.expected_what_if())
            execution = {}
            with patch.object(vc, 'api', side_effect=[{}, [self.analyzed_case()], planning]) as api:
                self.assertEqual(vc.prepare_case(args, execution), 'asset-real')
                self.assertEqual(api.call_args_list, [call(args, '/v1/bootstrap'),
                    call(args, '/v1/command/incidents'), call(args, '/v1/cascade-runs/planning-real')])
            self.assertEqual(args.case_id, 'new-case')
            self.assertEqual(execution['case']['run_id'], 'run-real')
            self.assertEqual(execution['case']['what_if_run_id'], 'planning-real')

    def test_existing_journal_blocks_replay_and_scope_changes_before_api(self):
        with tempfile.TemporaryDirectory() as d:
            self.save_resume_journal(d)
            variants = [
                (['--prepare-isolated', '--reset-demo', '--confirm-isolated', 'http://127.0.0.1:9999'], 'no writes/reset replayed'),
                (['--case-id', 'another-case'], 'Selected case differs'),
            ]
            for flags, message in variants:
                args = self.parse('--capture', '--output', d, *flags)
                with self.subTest(flags=flags), patch.object(vc, 'api') as api:
                    with self.assertRaisesRegex(RuntimeError, message):
                        vc.prepare_case(args, {})
                    api.assert_not_called()
            args = vc.parse_args(['--app-url', 'http://127.0.0.1:9998', '--capture', '--output', d])
            with patch.object(vc, 'api') as api:
                with self.assertRaisesRegex(RuntimeError, 'target differs'):
                    vc.prepare_case(args, {})
                api.assert_not_called()

    def test_uncertain_write_preserves_ids_and_is_never_replayed(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.parse('--capture', '--prepare-isolated', '--confirm-isolated',
                              'http://127.0.0.1:9999', '--request-id', 'stable-proof', '--output', d)
            created = dict(id='accepted-case', version=1)
            with patch.object(vc, 'api', side_effect=[{'baselineRevision': 8}, created,
                                                    TimeoutError('uncertain response')]) as api:
                with self.assertRaisesRegex(TimeoutError, 'uncertain response'):
                    vc.prepare_case(args, {})
                self.assertEqual(api.call_count, 3)
            journal = json.loads((Path(d) / 'preparation.json').read_text())
            self.assertEqual(journal['case_id'], 'accepted-case')
            self.assertEqual(journal['completed'], ['create'])
            self.assertEqual(journal['steps'][-1]['status'], 'uncertain')
            self.assertEqual(journal['steps'][-1]['payload']['clientRequestId'], 'stable-proof-analyze')
            with patch.object(vc, 'api') as api:
                with self.assertRaisesRegex(RuntimeError, 'no writes/reset replayed'):
                    vc.prepare_case(args, {})
                api.assert_not_called()

    def test_pending_journal_without_accepted_case_never_retries(self):
        with tempfile.TemporaryDirectory() as d:
            vc.atomic_json(Path(d) / 'preparation.json', dict(target='http://127.0.0.1:9999',
                request_id='stable-proof', completed=[], steps=[dict(step='create', status='pending')]))
            args = self.parse('--capture', '--output', d)
            with patch.object(vc, 'api') as api:
                with self.assertRaisesRegex(RuntimeError, 'no accepted case ID'):
                    vc.prepare_case(args, {})
                api.assert_not_called()

    def test_resume_refuses_changed_captured_run_or_what_if(self):
        with tempfile.TemporaryDirectory() as d:
            self.save_resume_journal(d)
            incident = self.analyzed_case()
            planning = dict(id='planning-real', baselineRevision=8, request=self.expected_what_if())
            for mismatch in ('run', 'baseline', 'overrides'):
                current, saved = deepcopy(incident), deepcopy(planning)
                if mismatch == 'run':
                    current['runSnapshot']['id'] = 'different-run'
                elif mismatch == 'baseline':
                    saved['baselineRevision'] = 9
                else:
                    saved['request']['overrides'][0]['backupMinHours'] = 5
                args = self.parse('--capture', '--output', d)
                with self.subTest(mismatch=mismatch), patch.object(vc, 'api', side_effect=[{}, [current], saved]) as api:
                    with self.assertRaisesRegex(RuntimeError, 'changed|no longer matches'):
                        vc.prepare_case(args, {})
                    self.assertTrue(all(len(c.args) == 2 for c in api.call_args_list))

    def test_capture_page_requires_loaded_records_and_matching_case_run_version(self):
        # Test browser orchestration offline, not Chromium or a live server.
        args = self.parse('--capture', '--case-id', 'new-case')
        args.capture_case = dict(run_id='run-real', version=2)
        screen = next(s for s in vc.SCREENS if s.name == 'C4')
        url = vc.app_route(args.app_url, screen, args.case_id, 'asset-real')
        for variant in ('ready', 'missing-records', 'wrong-run', 'wrong-version'):
            with self.subTest(variant=variant):
                browser = MagicMock()
                context = browser.new_context.return_value
                page = context.new_page.return_value
                page.url = url
                page.locator.return_value.inner_text.return_value = 'Loaded saved case and records'
                page.locator.return_value.count.return_value = 0
                page.evaluate.return_value = False  # no unresolved attribute bindings
                callbacks = {}
                page.on.side_effect = lambda event, callback: callbacks.update({event: callback})
                incident = self.analyzed_case()
                if variant == 'wrong-run':
                    incident['runSnapshot']['id'] = 'different-run'
                if variant == 'wrong-version':
                    incident['version'] = 3
                endpoints = {'/v1/bootstrap': {}, '/v1/telemetry': {}, '/v1/cascade-runs': [],
                             '/v1/command/incidents': [incident], '/v1/command/records': [], '/v1/reference': {}}
                if variant == 'missing-records':
                    del endpoints['/v1/command/records']

                def navigate(*unused, **kwargs):
                    for endpoint, body in endpoints.items():
                        response = MagicMock(url=args.app_url + endpoint, status=200, ok=True)
                        response.json.return_value = body
                        callbacks['response'](response)

                page.goto.side_effect = navigate
                with tempfile.TemporaryDirectory() as d:
                    path = Path(d) / 'offline.png'
                    if variant == 'ready':
                        result = vc.capture_page(browser, url, args, 1920, 1080, path, screen=screen)
                        self.assertEqual(result['issues'], [])
                        self.assertEqual(result['readiness']['run_id'], 'run-real')
                        self.assertEqual(result['readiness']['case_version'], 2)
                        self.assertTrue(result['full_page'])
                        page.screenshot.assert_called_once_with(path=str(path), full_page=True, animations='disabled')
                    else:
                        message = {'missing-records': 'required saved records', 'wrong-run': 'different captured',
                                   'wrong-version': 'version changed'}[variant]
                        with self.assertRaisesRegex(vc.CaptureFailure, message):
                            vc.capture_page(browser, url, args, 1920, 1080, path, screen=screen)
                        page.screenshot.assert_not_called()
                context.close.assert_called_once()
                browser.new_context.assert_called_once_with(viewport={'width': 1920, 'height': 1080},
                    device_scale_factor=1, service_workers='block', reduced_motion='reduce')
                readiness_checks = [c.args[0] for c in page.wait_for_function.call_args_list]
                self.assertTrue(any('data-casework-loaded' in check and 'aria-busy' in check for check in readiness_checks))

    def test_capture_page_rejects_other_viewports_before_opening_context(self):
        browser = MagicMock()
        with self.assertRaisesRegex(RuntimeError, '1920×1080'):
            vc.capture_page(browser, 'file:///original.html', self.parse(), 1440, 900,
                            Path('unused.png'), is_reference=True)
        browser.new_context.assert_not_called()

    def test_capture_writes_screen_named_pair_without_asserting_conformance(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            args = self.parse('--capture', '--case-id', 'new-case', '--screens', 'C4', '--output', d)
            original = Path(d) / 'original.html'
            original.write_text('<template id="tpl-C4">Offline reference fixture</template>')
            args.mockup = original
            rows, _ = vc.preflight(args)
            execution = {}

            def prepare(unused, result):
                result['case'] = dict(id='new-case', version=2, run_id='run-real')
                return 'asset-real'

            def offline_capture(browser, url, args, width, height, path, **kwargs):
                # Composition fixture only; this is not a real screenshot.
                Image.new('RGB', (width, 12 if kwargs.get('is_reference') else 8), 'red').save(path)
                return dict(issues=[], full_page=True, url=url)

            with patch('playwright.sync_api.sync_playwright') as playwright, \
                    patch.object(vc, 'prepare_case', side_effect=prepare), \
                    patch.object(vc, 'capture_page', side_effect=offline_capture) as capture_page:
                vc.capture(args, rows, execution)
                browser = playwright.return_value.__enter__.return_value.chromium.launch.return_value
                browser.close.assert_called_once()
            self.assertEqual(capture_page.call_count, 2)
            self.assertEqual(rows[0]['artifact'], 'C4.png')
            self.assertTrue((Path(d) / 'C4.png').is_file())
            self.assertTrue(rows[0]['capture_valid'])
            self.assertEqual(rows[0]['visual_conformance'], 'not-reviewed')
            self.assertEqual(rows[0]['dimensions']['composed'], [3840, 12])

    def test_reference_capture_observes_original_router_and_captures_whole_page(self):
        browser = MagicMock()
        context = browser.new_context.return_value
        page = context.new_page.return_value
        page.url = 'file:///original.html#/C4'
        page.locator.return_value.inner_text.return_value = 'Original rendered board'
        page.evaluate.side_effect = lambda script, *args: script.startswith('board =>')
        screen = next(s for s in vc.SCREENS if s.name == 'C4')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'original.png'
            result = vc.capture_page(browser, page.url, self.parse(), 1920, 1080, path,
                                     is_reference=True, screen=screen)
            self.assertEqual(result['issues'], [])
            self.assertEqual(result['url'], 'file:///original.html#/C4')
            page.screenshot.assert_called_once_with(path=str(path), full_page=True, animations='disabled')
        page.set_content.assert_not_called()
        page.add_script_tag.assert_not_called()
        page.add_style_tag.assert_not_called()
        context.add_init_script.assert_not_called()
        context.close.assert_called_once()
        router_checks = [c for c in page.evaluate.call_args_list if c.args[0].startswith('board =>')]
        self.assertEqual(len(router_checks), 1)
        self.assertEqual(router_checks[0].args[1], 'C4')

    def test_preflight_main_is_offline_and_reports_subset_without_proof(self):
        with tempfile.TemporaryDirectory() as d:
            original = Path(d) / 'original.html'
            original.write_text('<template id="tpl-C4">Original</template>')
            output = Path(d) / 'output'
            with patch.object(vc, 'api') as api, patch.object(vc, 'capture') as capture, patch('builtins.print'):
                status = vc.main(['--app-url', 'http://127.0.0.1:9999', '--preflight',
                                  '--screens', 'C4', '--mockup', str(original), '--output', str(output)])
                api.assert_not_called()
                capture.assert_not_called()
            self.assertEqual(status, 2)
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual(report['requested_pairs'], 1)
            self.assertEqual(report['valid_pairs'], 0)
            self.assertFalse(report['execution']['browser_started'])
            self.assertFalse(report['execution']['writes_authorized'])
            self.assertEqual(report['rows'][0]['visual_conformance'], 'not-reviewed')

    def test_api_write_guard_and_source_contract(self):
        args = self.parse()
        with self.assertRaisesRegex(RuntimeError, 'write denied'):
            vc.api(args, '/v1/demo/reset', {'confirm': 'RESET DEMO'})
        self.assertTrue(all(c['confirmed'] for c in vc.source_contract()))


if __name__ == '__main__':
    unittest.main()
