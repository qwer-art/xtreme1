type Intrinsics = { fx: number; fy: number; cx: number; cy: number };
type Sample = { x: number; y: number; depth: number; cell: number };

export function visibleLidarSamples(positions: ArrayLike<number>, external: readonly number[],
    intrinsics: Intrinsics, width: number, height: number) {
    const { fx, fy, cx, cy } = intrinsics;
    const cellSize = Math.max(1, Math.round(fx * 0.004));
    const columns = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize);
    const nearest = new Float32Array(columns * rows).fill(Infinity);
    const samples: Sample[] = [];
    for (let offset = 0; offset < positions.length; offset += 3) {
        const px = positions[offset], py = positions[offset + 1], pz = positions[offset + 2];
        const depth = external[8] * px + external[9] * py + external[10] * pz + external[11];
        if (!(depth > 0 && Number.isFinite(depth))) continue;
        const x = fx * (external[0] * px + external[1] * py + external[2] * pz + external[3]) / depth + cx;
        const y = fy * (external[4] * px + external[5] * py + external[6] * pz + external[7]) / depth + cy;
        if (!(x >= 0 && y >= 0 && x < width && y < height)) continue;
        const column = Math.floor(Math.min(width - 1, Math.round(x)) / cellSize);
        const row = Math.floor(Math.min(height - 1, Math.round(y)) / cellSize);
        const cell = row * columns + column;
        nearest[cell] = Math.min(nearest[cell], depth);
        samples.push({ x, y, depth, cell });
    }
    function frontDepth(column: number, row: number, dx: number, dy: number, limit: number) {
        for (let step = 1; step <= 4; step++) {
            column += dx; row += dy;
            if (column < 0 || column >= columns || row < 0 || row >= rows) break;
            const value = nearest[row * columns + column];
            if (value < limit) return value;
        }
        return Infinity;
    }
    const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
    return samples.filter(({ cell, depth }) => {
        const limit = depth - Math.max(0.35, depth * 0.025);
        if (nearest[cell] < limit) return false;
        const column = cell % columns, row = Math.floor(cell / columns);
        return !axes.some(([dx, dy]) => {
            const left = frontDepth(column, row, dx, dy, limit);
            if (!Number.isFinite(left)) return false;
            const right = frontDepth(column, row, -dx, -dy, limit);
            return Math.abs(left - right) <= Math.max(0.35, Math.min(left, right) * 0.04);
        });
    }).sort((first, second) => second.depth - first.depth);
}