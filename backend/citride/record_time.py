"""Per-field timestamp resolution. Absolute feed/operator timestamps always win."""
from copy import deepcopy
from datetime import datetime, timedelta


def parse_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def resolve_record_times(record, sample_anchor, opened=None):
    record = deepcopy(record)
    anchor = record.get('sampleDataAnchor', sample_anchor)
    opened = record.get('openedAt', record.get('openedStoryAt', opened))
    for key, value in list(record.items()):
        if isinstance(value, list):
            record[key] = [resolve_record_times(v, anchor, opened) if isinstance(v, dict) else v for v in value]
        elif isinstance(value, dict) and key != 'timeOrigins':
            record[key] = resolve_record_times(value, anchor, opened)
    origins = record.setdefault('timeOrigins', {})
    for offset, target, unit, base, basis in (
        ('relativeTimeHours', 'at', 'hours', anchor, 'sample-data anchor'),
        ('startedRelativeHours', 'startedAt', 'hours', anchor, 'sample-data anchor'),
        ('reportedRelativeHours', 'reportedAt', 'hours', anchor, 'sample-data anchor'),
        ('closedRelativeHours', 'closedAt', 'hours', anchor, 'sample-data anchor'),
        ('offsetMinutes', 'at', 'minutes', opened or anchor, 'case opened' if opened else 'sample-data anchor'),
        ('dueOffsetMinutes', 'dueAt', 'minutes', opened or anchor, 'case opened' if opened else 'sample-data anchor'),
        ('doneOffsetMinutes', 'doneAt', 'minutes', opened or anchor, 'case opened' if opened else 'sample-data anchor'),
        ('etaOffsetMinutes', 'etaAt', 'minutes', opened or anchor, 'case opened' if opened else 'sample-data anchor'),
    ):
        if target in record:
            origins.setdefault(target, {'basis': 'absolute timestamp'})
        elif offset in record and base:
            record[target] = (parse_time(base) + timedelta(**{unit: record[offset]})).isoformat()
            origins[target] = {'basis': basis, 'anchor': base, 'offsetField': offset, 'offset': record[offset], 'unit': unit}
    if not origins:
        record.pop('timeOrigins', None)
    return record
