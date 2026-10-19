"""Pure harness regressions: extract helpers without executing Playwright scripts."""
import ast
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

HERE = Path(__file__).parent

def helper(script, name, bindings=None):
    tree = ast.parse((HERE / script).read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
    if not nodes:
        raise AssertionError(f'{script} missing pure helper {name}')
    namespace = {'json': json}
    namespace.update(bindings or {})
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(HERE / script), 'exec'), namespace)
    return namespace[name]

class ReceiptTests(unittest.TestCase):
    def validate(self, receipt):
        return helper('part-b-supplement.py', 'validate_customer_receipt')(receipt)

    def test_success_retains_incident(self):
        receipt = {'incident': 'third-incident', 'pass': True, 'screens': [], 'search': []}
        self.assertIs(self.validate(receipt), receipt)

    def test_original_missing_incident_is_causal_not_keyerror(self):
        with self.assertRaisesRegex(ValueError, 'missing.*incident'):
            self.validate({'pass': True, 'screens': [], 'search': []})

    def test_empty_assertion_error_uses_traceback(self):
        with self.assertRaisesRegex(ValueError, 'assert len.created.*==1'):
            self.validate({'error': '', 'traceback': 'AssertionError: assert len(created)==1'})

    def test_failure_stays_failure_even_with_context(self):
        with self.assertRaisesRegex(ValueError, 'POST.*409'):
            self.validate({'incident': 'third', 'pass': True, 'error': 'POST returned 409'})

    def test_invalid_structure(self):
        for receipt in [None, [], {'incident': ''}, {'incident': 'third', 'pass': 'true', 'screens': []}, {'incident': 'third', 'pass': True, 'screens': 'bad'}]:
            with self.subTest(receipt=receipt), self.assertRaises(ValueError):
                self.validate(receipt)

    def test_failed_separation_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, 'separation.*failed'):
            self.validate({'incident': 'third', 'pass': False, 'screens': []})

    def test_failure_preserves_context_and_names_empty_assertion(self):
        build = helper('part-b-continuation.py', 'customer_failure')
        context = {'incident': 'third', 'screens': [{'view': 'cop'}], 'pass': True}
        failed = build(context, AssertionError(), 'original traceback')
        self.assertEqual(failed['incident'], 'third')
        self.assertEqual(failed['screens'], context['screens'])
        self.assertEqual(failed['error'], 'AssertionError')
        self.assertEqual(failed['traceback'], 'original traceback')
        self.assertFalse(failed['pass'])
        self.assertTrue(context['pass'])

class CreateSynchronizationTests(unittest.TestCase):
    def exercise(self, status=201, cases=None):
        state = {'allowCreate': False}
        events = []
        response = SimpleNamespace(status=status, ok=status < 400, text=lambda: 'actual response')
        class Pending:
            value = response
            def __enter__(self):
                events.append('response-wait-armed')
                return self
            def __exit__(self, *args):
                events.append('response-completed')
        page = Mock()
        page.expect_response.return_value = Pending()
        form = Mock()
        def click():
            self.assertTrue(state['allowCreate'])
            events.append('click')
        form.get_by_role.return_value.click.side_effect = click
        form.wait_for.side_effect = lambda **kwargs: events.append('ui-completed')
        def get(origin, path):
            self.assertTrue(state['allowCreate'])
            self.assertEqual(events, ['response-wait-armed', 'click', 'response-completed', 'ui-completed'])
            return {'incidents': [{'id': 'new'}] if cases is None else cases}
        create = helper('part-b-continuation.py', 'create_from_form', {'get': get})
        return create, page, form, state

    def test_api_read_occurs_after_response_and_ui_completion(self):
        create, page, form, state = self.exercise()
        context = {}
        self.assertEqual(create(page, state, 'http://127.0.0.1:1234', form, set(), context)['id'], 'new')
        self.assertFalse(state['allowCreate'])
        self.assertEqual(context['createResponse']['status'], 201)

    def test_failed_post_retains_response_and_disables_writes(self):
        create, page, form, state = self.exercise(status=409)
        context = {}
        with self.assertRaisesRegex(AssertionError, 'POST returned 409'):
            create(page, state, 'http://127.0.0.1:1234', form, set(), context)
        form.wait_for.assert_not_called()
        self.assertFalse(state['allowCreate'])
        self.assertEqual(context['createResponse']['body'], 'actual response')

    def test_zero_created_is_strict_and_causal(self):
        create, page, form, state = self.exercise(cases=[])
        with self.assertRaisesRegex(AssertionError, 'Expected exactly one persisted new case'):
            create(page, state, 'http://127.0.0.1:1234', form, set(), {})
        self.assertFalse(state['allowCreate'])

if __name__ == '__main__':
    unittest.main()
