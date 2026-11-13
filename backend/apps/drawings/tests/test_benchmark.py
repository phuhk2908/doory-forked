import pytest

from apps.drawings.management.commands.benchmark_drawing_room import parse_sizes, percentile


def test_parse_sizes_expands_max_and_removes_duplicates():
    assert parse_sizes("2, max, 5, 2", 25) == [2, 25, 5]


@pytest.mark.parametrize("value", ["1", "26", "", "banana"])
def test_parse_sizes_rejects_invalid_values(value):
    with pytest.raises(ValueError):
        parse_sizes(value, 25)


def test_percentile_uses_the_nearest_observed_sample():
    assert percentile([4, 1, 3, 2], 0.5) == 2
    assert percentile([], 0.95) == 0
