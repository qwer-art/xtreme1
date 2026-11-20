const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Matrix4, Vector3 } = require('three');
const publicDir = path.resolve(__dirname, '../public');
const manifest = require('../public/local-scene/index.json');
const keys = manifest.scans.filter(scan => scan.keyframe);
const pose = scan => new Matrix4().fromArray(scan.worldFromLidar);

function landmarks(scan) {
    const data = fs.readFileSync(path.join(publicDir, scan.pointsUrl));
    const offset = data.indexOf('DATA binary\n') + 12;
    const cells = new Map();
    for (let cursor = offset; cursor < data.length; cursor += 16) {
        const point = new Vector3(data.readFloatLE(cursor), data.readFloatLE(cursor + 4), data.readFloatLE(cursor + 8));
        if (point.z < -0.75 || point.z > 0.15 || Math.hypot(point.x, point.y) > 40) continue;
        const key = [Math.floor(point.x / 0.45), Math.floor(point.y / 0.45)].join(',');
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(point);
    }
    const groups = [];
    while (cells.size) {
        const queue = [cells.keys().next().value], points = [];
        while (queue.length) {
            const key = queue.pop(), cell = cells.get(key);
            if (!cell) continue;
            cells.delete(key);
            points.push(...cell);
            const [column, row] = key.split(',').map(Number);
            for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
                const next = `${column + dx},${row + dy}`;
                if (cells.has(next)) queue.push(next);
            }
        }
        if (points.length < 20) continue;
        const mid = new Vector3(), spans = [];
        for (const axis of ['x', 'y', 'z']) {
            const values = points.map(point => point[axis]).sort((a, b) => a - b);
            const low = values[Math.floor(values.length * 0.02)], high = values[Math.floor(values.length * 0.98)];
            mid[axis] = (low + high) / 2;
            spans.push(high - low);
        }
        if (Math.max(...spans) > 7) continue;
        groups.push({ mid, spans, count: points.length, world: mid.clone().applyMatrix4(pose(scan)) });
    }
    return groups;
}

function tracker(scans) {
    const ts = require('typescript');
    const source = fs.readFileSync(path.resolve(__dirname, '../src/common/trialTracking.ts'), 'utf8');
    const code = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
    const api = {};
    new Function('require', 'exports', code)(name => name === './trialScene' ? { scans } : require(name), api);
    return api.trackNext;
}

function encode(points) {
    const header = Buffer.from(`VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nPOINTS ${points.length}\nDATA binary\n`);
    const body = Buffer.alloc(points.length * 16);
    points.forEach((point, index) => point.forEach((value, axis) => body.writeFloatLE(value, index * 16 + axis * 4)));
    return Buffer.concat([header, body]);
}

async function controlled() {
    const scans = ['before', 'after'].map((id, index) => ({ id, pointsUrl: id, timestamp: index * 500000, worldFromLidar: new Matrix4().toArray() }));
    const track = tracker(scans), template = [];
    for (let column = -8; column <= 8; column++) for (const height of [0.1, 0.4, 0.7]) {
        template.push([column * 0.2, -0.75, height]);
        if (column < 0) template.push([-1.6, (column + 4) * 0.18, height]);
    }
    const angle = 0.32;
    const moved = template.map(([forward, side, height]) => [2 + forward * Math.cos(angle) - side * Math.sin(angle),
        1 + forward * Math.sin(angle) + side * Math.cos(angle), height]);
    let target = moved, source = template;
    global.fetch = async url => new Response(encode(url === 'before' ? source : target));
    const step = () => track('before', 'after', { center: [0, 0, 0], size: [4, 2, 2], yaw: 0 });
    const result = await step();
    assert(Math.abs(result.yaw - angle) < 0.1);
    assert(Math.hypot(result.center[0] - 2, result.center[1] - 1) < 0.25);
    target = [...moved, ...moved.map(([forward, side, height]) => [forward - 6, side, height])];
    await assert.rejects(step, /Ambiguous/);
    target = template.map(([forward, side]) => [forward, side, -0.95]);
    await assert.rejects(step, /No matching/);
    target = [];
    await assert.rejects(step, /No matching/);
    source = [];
    await assert.rejects(step, /source foreground/);
}

async function real() {
    const sequence = keys.slice(33, 38), track = tracker(manifest.scans);
    const picks = [[-1.88, 8.48], [-2.47, 8.17], [-3.12, 7.78], [-3.58, 7.2]];
    const evidence = picks.map(([horizontal, vertical], index) => {
        const found = landmarks(sequence[index]).filter(group => Math.hypot(group.mid.x - horizontal, group.mid.y - vertical) < 0.35);
        assert.equal(found.length, 1);
        assert(found[0].count > 100);
        return found[0];
    });
    const urls = new Set(sequence.map(scan => scan.pointsUrl));
    global.fetch = async url => {
        assert(urls.has(url));
        return new Response(fs.readFileSync(path.join(publicDir, url)));
    };
    let box = { center: [-2.3, 9.1, -0.6], size: [4.9, 2.1, 1.95], yaw: 2.08 };
    const { cameraExternal, cameraInternal } = require(path.join(publicDir, sequence[0].viewsUrl)).find(view => view.name === 'CAM_FRONT');
    const cameraPoint = evidence[0].mid.clone().applyMatrix4(new Matrix4().fromArray(cameraExternal).transpose());
    const pixel = [cameraInternal.fx * cameraPoint.x / cameraPoint.z + cameraInternal.cx,
        cameraInternal.fy * cameraPoint.y / cameraPoint.z + cameraInternal.cy].map(Math.round);
    console.log('seed', sequence[0].id, box, 'CAM_FRONT native pixel', pixel);
    let previous = new Vector3().fromArray(box.center).applyMatrix4(pose(sequence[0]));
    for (let index = 1; index < picks.length; index++) {
        box = await track(sequence[index - 1].id, sequence[index].id, box);
        const world = new Vector3().fromArray(box.center).applyMatrix4(pose(sequence[index]));
        const measured = evidence[index].world.clone().sub(evidence[index - 1].world);
        const residual = world.clone().sub(previous).distanceTo(measured);
        assert(measured.length() > 0.75);
        assert(residual < 0.75, `World displacement discrepancy: ${residual}`);
        assert.deepEqual(box.size, [4.9, 2.1, 1.95]);
        assert(Number.isFinite(box.elapsed_ms) && box.elapsed_ms > 0);
        console.log('key', index + 33, 'returns', evidence[index].count, 'world step m', measured.length().toFixed(2),
            'displacement discrepancy m', residual.toFixed(2), 'yaw rad', box.yaw.toFixed(2), 'ms', box.elapsed_ms.toFixed(1));
        previous = world;
    }
    await assert.rejects(() => track(sequence[3].id, sequence[4].id, box), /No matching/);
}

(async () => { await controlled(); await real(); })().catch(error => { console.error(error); process.exitCode = 1; });