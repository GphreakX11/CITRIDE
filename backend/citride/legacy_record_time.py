"""Read-only compatibility boundary for saved pre-real-time record metadata.

Retired field names live only here, not in the runtime clock/API contract.
These functions return detached projections: they never save, reset, rebase
absolute timestamps, or rewrite stored cases/runs. New canonical values win.
"""
from copy import deepcopy

from .scripted_validation import aware_time
from .storage import InvalidModelError

SAMPLE_TIMING = {'note': 'Sample record times are offsets from the sample-data anchor (one hour before load).'}


def project_saved_record(record):
    result = deepcopy(record)
    previous = result.pop('openedStoryAt', None)
    if 'openedAt' not in result and previous is not None:
        result['openedAt'] = previous
    return result


def project_saved_meta(meta):
    result = deepcopy(meta)
    # Validate historical metadata without ever using it to advance wall time.
    for field in ('storyStartedAt', 'wallStartedAt', 'incidentOrigin', 'sampleDataAnchor'):
        if field in result and not aware_time(result[field]):
            raise InvalidModelError(f'{field} must be an aware ISO timestamp')
    if 'sampleDataAnchor' not in result and 'incidentOrigin' in result:
        result['sampleDataAnchor'] = result['incidentOrigin']
    for field in ('storyStartedAt', 'wallStartedAt'):
        result.pop(field, None)
    # Old timing dictionaries are documentation/settings, not record timestamps.
    result['config']['timing'] = deepcopy(SAMPLE_TIMING)
    return result
