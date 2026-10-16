"""Measured IDT release gate selects bounded reasoning without weakening explicit validation."""
from citride.reasoning import _idt_mode


def test_measured_release_default_uses_assigned_closure(monkeypatch):
    monkeypatch.delenv('CITRIDE_IDT_LOAD_MODE',raising=False)
    assert _idt_mode() == 'assigned_closure'


def test_explicit_full_diagnostic_mode_and_configured_mode_remain_supported(monkeypatch):
    monkeypatch.setenv('CITRIDE_IDT_LOAD_MODE','full')
    assert _idt_mode() == 'full'
    assert _idt_mode('assigned_closure') == 'assigned_closure'
    assert _idt_mode('full') == 'full'
