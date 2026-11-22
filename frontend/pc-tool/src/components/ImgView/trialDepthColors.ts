export const depthBands = [
    { until: 3, color: '#ff585f', label: '<3' },
    { until: 4, color: '#ffca42', label: '3–4' },
    { until: 6, color: '#36e2bb', label: '4–6' },
    { until: 10, color: '#46a9ff', label: '6–10' },
    { until: 20, color: '#ac8cff', label: '10–20' },
    { until: Infinity, color: '#b6c1cf', label: '≥20' },
] as const;

export function depthBandIndex(depth: number) {
    return depthBands.findIndex(band => depth < band.until);
}