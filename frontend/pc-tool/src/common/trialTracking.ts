import { Matrix4, Vector3 } from 'three';
import { scans, loadTrialScene } from './trialScene';

type Box = { center: number[]; size: number[]; yaw: number };
type Point = Vector3;
const cell = 0.2;
const voxelKey = (column: number, row: number, layer: number) => (column * 512 + row) * 256 + layer;

async function cloud(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Tracking cloud: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const header = new TextDecoder().decode(buffer.slice(0, 512));
    const marker = 'DATA binary\n', offset = header.indexOf(marker) + marker.length;
    const count = Number(/^POINTS (\d+)$/m.exec(header)?.[1]);
    if (offset < marker.length || !header.startsWith('VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\n') || buffer.byteLength !== offset + 16 * count) {
        throw new Error('Unexpected tracking PCD format');
    }
    return new DataView(buffer, offset);
}

function crop(data: DataView, center: Vector3, radius: number, height: number, inside?: (dx: number, dy: number) => boolean) {
    const points: Point[] = [];
    for (let offset = 0; offset < data.byteLength; offset += 16) {
        const dx = data.getFloat32(offset, true) - center.x, dy = data.getFloat32(offset + 4, true) - center.y;
        const dz = data.getFloat32(offset + 8, true) - center.z;
        if (dx * dx + dy * dy <= radius * radius && dz >= -height * 0.04 && dz <= height / 2 && (!inside || inside(dx, dy))) {
            points.push(new Vector3(dx, dy, dz));
        }
    }
    return points;
}

function components(points: Point[]) {
    const bins = new Map<number, Point[]>();
    for (const point of points) {
        const key = Math.floor(point.x / 0.4) * 1024 + Math.floor(point.y / 0.4);
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key)!.push(point);
    }
    const groups: Point[][] = [];
    while (bins.size) {
        const queue: number[] = [bins.keys().next().value], group: Point[] = [];
        while (queue.length) {
            const key = queue.pop()!, bin = bins.get(key);
            if (!bin) continue;
            bins.delete(key);
            group.push(...bin);
            for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
                const next = key + dx * 1024 + dy;
                if (bins.has(next)) queue.push(next);
            }
        }
        if (group.length >= 15) groups.push(group);
    }
    return groups;
}

function template(points: Point[]) {
    const origin = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);
    const voxels = new Map<number, Point>(), field = new Map<number, number>();
    for (const raw of points) {
        const point = raw.clone().sub(origin);
        const column = Math.round(point.x / cell), row = Math.round(point.y / cell), layer = Math.round(point.z / cell);
        const key = voxelKey(column, row, layer);
        if (voxels.has(key)) continue;
        voxels.set(key, point);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
            const weight = 1 - (dx * dx + dy * dy + dz * dz) / 6;
            const index = voxelKey(column + dx, row + dy, layer + dz);
            if (weight > (field.get(index) || 0)) field.set(index, weight);
        }
    }
    return { origin, points: [...voxels.values()], field };
}

function overlap(points: Point[], field: Map<number, number>, cos: number, sin: number, dx: number, dy: number, dz: number) {
    let score = 0;
    for (const point of points) {
        score += field.get(voxelKey(Math.round((cos * point.x - sin * point.y + dx) / cell),
            Math.round((sin * point.x + cos * point.y + dy) / cell), Math.round((point.z + dz) / cell))) || 0;
    }
    return score / points.length;
}

export async function trackNext(sourceScanId: string, targetScanId: string, box: Box): Promise<Box & { elapsed_ms: number }> {
    const start = performance.now();
    const scene = scans.length ? scans : await loadTrialScene();
    const source = scene.find(scan => scan.id === sourceScanId), target = scene.find(scan => scan.id === targetScanId);
    if (!source || !target || target.timestamp <= source.timestamp || target.timestamp - source.timestamp > 750000) throw new Error('Expected consecutive forward scans');
    if (box.center.length !== 3 || box.size.length !== 3 || ![...box.center, box.yaw].every(Number.isFinite) || !box.size.every(value => Number.isFinite(value) && value > 0 && value <= 20)) throw new Error('Invalid tracking box');
    const relative = new Matrix4().fromArray(target.worldFromLidar).invert().multiply(new Matrix4().fromArray(source.worldFromLidar));
    const center = new Vector3().fromArray(box.center), predicted = center.clone().applyMatrix4(relative);
    const cos = Math.cos(box.yaw), sin = Math.sin(box.yaw);
    const heading = new Vector3(cos, sin, 0).transformDirection(relative);
    const [length, width, height] = box.size, radius = Math.hypot(length, width) / 2;
    const travel = (target.timestamp - source.timestamp) * 0.000018 + 0.35;
    const [before, after] = await Promise.all([cloud(source.pointsUrl), cloud(target.pointsUrl)]);
    const masked = crop(before, center, radius, height, (dx, dy) => Math.abs(dx * cos + dy * sin) <= length / 2 && Math.abs(dy * cos - dx * sin) <= width / 2);
    const groups = components(masked).sort((first, second) => second.length - first.length);
    if (!groups.length || groups[0].length < masked.length * 0.8) throw new Error('Insufficient isolated source foreground');
    const original = template(groups[0].map(point => point.add(center).applyMatrix4(relative).sub(predicted)));
    if (original.points.length < 12 || Math.max(...original.points.map(point => point.z)) - Math.min(...original.points.map(point => point.z)) < 0.2) throw new Error('Insufficient source shape');
    const matches = [];
    for (const group of components(crop(after, predicted, radius + travel, height))) {
        if (group.length < groups[0].length / 4 || group.length > groups[0].length * 4) continue;
        const candidate = template(group);
        if (candidate.points.length < 12 || candidate.origin.distanceTo(original.origin) > travel + 0.8) continue;
        const dz = original.origin.z - candidate.origin.z;
        let best = { score: 0, dx: 0, dy: 0, angle: 0 };
        for (let turn = -5; turn <= 5; turn++) {
            const angle = turn * 0.08, cosine = Math.cos(angle), sine = Math.sin(angle);
            for (let column = -3; column <= 3; column++) for (let row = -3; row <= 3; row++) {
                const dx = column * cell, dy = row * cell;
                const forward = overlap(original.points, candidate.field, cosine, sine, dx, dy, dz);
                if (forward < best.score) continue;
                const backward = overlap(candidate.points, original.field, cosine, -sine, -cosine * dx - sine * dy, sine * dx - cosine * dy, -dz);
                const score = Math.min(forward, backward);
                if (score > best.score) best = { score, dx, dy, angle };
            }
        }
        const cosine = Math.cos(best.angle), sine = Math.sin(best.angle), anchor = original.origin;
        const dx = candidate.origin.x + best.dx - cosine * anchor.x + sine * anchor.y;
        const dy = candidate.origin.y + best.dy - sine * anchor.x - cosine * anchor.y;
        if (Math.hypot(dx, dy) <= travel) matches.push({ ...best, dx, dy });
    }
    matches.sort((first, second) => second.score - first.score);
    if (!matches.length || matches[0].score < 0.62) throw new Error('No matching target foreground');
    if (matches[1] && matches[0].score - matches[1].score < 0.09) throw new Error('Ambiguous target foreground');
    const match = matches[0], yaw = Math.atan2(heading.y, heading.x) + match.angle;
    return { center: [predicted.x + match.dx, predicted.y + match.dy, predicted.z], size: [...box.size],
        yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), elapsed_ms: performance.now() - start };
}