const assert = require('node:assert/strict');

function rawPoints(buffer) {
    const header = /(?:^|\n)DATA binary\r?\n/.exec(buffer.toString('latin1', 0, 4096));
    assert.ok(header, 'expected binary PCD');
    const fields = Object.fromEntries(buffer.toString('ascii', 0, header.index).trim().split(/\r?\n/)
        .map(line => line.trim().split(/\s+/)).map(([key, ...values]) => [key, values.join(' ')]));
    assert.equal(fields.FIELDS, 'x y z intensity');
    assert.equal(fields.TYPE, 'F F F F');
    assert.equal(fields.SIZE, '4 4 4 4');
    assert.equal(fields.COUNT, '1 1 1 1');
    const count = Number(fields.POINTS);
    const offset = header.index + header[0].length;
    assert.ok(count > 0 && buffer.length - offset === count * 16, 'truncated or empty raw XYZI');
    return Array.from({ length: count }, (_, index) => [0, 4, 8].map(axis => buffer.readFloatLE(offset + index * 16 + axis)));
}

function support(points, box) {
    const [length, width, height] = box.size;
    const cos = Math.cos(box.yaw), sin = Math.sin(box.yaw);
    const leftRight = [0, 0], returns = [];
    for (const point of points) {
        const [dx, dy, dz] = point.map((value, axis) => value - box.center[axis]);
        const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
        if (Math.abs(along) > length / 2 || Math.abs(dz) > height / 2) continue;
        if (Math.abs(across) <= width / 2) returns.push([along, across, dz]);
        for (const [index, offset] of [1.5 * width, -1.5 * width].entries()) {
            if (Math.abs(across - offset) <= width / 2) leftRight[index]++;
        }
    }
    const span = box.size.map((_, axis) => {
        const values = returns.map(point => point[axis]);
        return values.length ? Number((Math.max(...values) - Math.min(...values)).toFixed(3)) : 0;
    });
    const upperHalf = returns.filter(point => point[2] >= 0).length;
    return { id: box.id, trackId: box.trackId, category: box.category, center: box.center, size: box.size,
        yaw: box.yaw, score: box.score, inside: returns.length, upperHalf, span, leftRight,
        supported: returns.length >= 8 && upperHalf >= 2 && span[2] >= 0.3 &&
            (span[0] >= 0.25 * length || span[1] >= 0.25 * width) };
}

module.exports = { rawPoints, support };