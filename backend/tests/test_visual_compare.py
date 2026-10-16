"""Offline contract tests: python3 -m unittest discover -s backend/tests -p test_visual_compare.py -v."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'visual_compare.py'
spec = importlib.util.spec_from_file_location('visual_compare', SCRIPT)
assert spec is not None and spec.loader is not None
vc = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = vc
spec.loader.exec_module(vc)


class VisualCompareTests(unittest.TestCase):
    def parse(self, *extra):
        return vc.parse_args(['--app-url', 'http://127.0.0.1:9999', *extra])

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
            self.assertEqual(len(rows), 50)
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
            self.assertEqual(c1['reference']['selector'], '[id="Main"]')
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

    def test_prepare_isolated_versions_and_identity(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.parse('--capture', '--prepare-isolated', '--reset-demo',
                              '--confirm-isolated', 'http://127.0.0.1:9999',
                              '--request-id', 'stable-proof', '--output', d)
            incident = dict(id='new-case', version=1, eventId='event-vpn-a')
            analyzed = dict(incident, version=2, contextSnapshot={'cyberAsset': {'id': 'asset-real'}},
                            runSnapshot={'id': 'run-real', 'request': {'scenarioId': 'unsafe-water'}})
            execution = {'_rows': [], '_provenance': {}}
            with patch.object(vc, 'api', side_effect=[{'baselineRevision': 7}, {},
                        {'baselineRevision': 8}, incident, analyzed]) as api:
                self.assertEqual(vc.prepare_case(args, execution), 'asset-real')
                calls = api.call_args_list
                self.assertEqual(calls[1].args[2]['expectedBaselineRevision'], 7)
                self.assertEqual(calls[3].args[2]['expectedBaselineRevision'], 8)
                self.assertEqual(calls[4].args[2]['expectedVersion'], 1)
                self.assertEqual(calls[4].args[2]['clientRequestId'], 'stable-proof-analyze')
                self.assertEqual(args.case_id, 'new-case')
            self.assertIn('stable-proof', (Path(d) / 'report.json').read_text())

    def test_api_write_guard_and_source_contract(self):
        args = self.parse()
        with self.assertRaisesRegex(RuntimeError, 'write denied'):
            vc.api(args, '/v1/demo/reset', {'confirm': 'RESET DEMO'})
        self.assertTrue(all(c['confirmed'] for c in vc.source_contract()))


if __name__ == '__main__':
    unittest.main()
