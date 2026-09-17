// Compare saved per-hole allowances for scorecard highlighting.
export function strokeAdvantage(hole) {
    if (!Number.isInteger(hole?.strokes1) || !Number.isInteger(hole?.strokes2)) {
        return { side: null, difference: null, label: 'Unknown' };
    }
    const difference = hole.strokes2 - hole.strokes1;
    return { difference, side: difference > 0 ? 2 : difference < 0 ? 1 : 0,
        label: difference > 0 ? 'Player B' : difference < 0 ? 'Player A' : 'None' };
}

