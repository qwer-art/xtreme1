import { Matrix4, Vector3 } from 'three';
import type { BufferAttribute, InterleavedBufferAttribute } from 'three';
import type { TrialCamera } from './trialScene';
import type { Triple } from './trialCandidates';

type ImageRect = { left: number; top: number; right: number; bottom: number };
type Projected = { index: number; x: number; y: number; z: number; depth: number; u: number; v: number };

function quantile(values: number[], fraction: number) {
    values.sort((first, second) => first - second);
    return values[Math.floor((values.length - 1) * fraction)];
}

export function cameraPedestrian(positions: BufferAttribute | InterleavedBufferAttribute,
    camera: Pick<TrialCamera, 'cameraInternal' | 'cameraExternal' | 'imgSize'>, rect: ImageRect) {
    const start = performance.now();
    const { left, right, top, bottom } = rect, width = right - left, height = bottom - top;
    const { fx, fy, cx, cy } = camera.cameraInternal;
    if (width < 6 || height < 12 || left < 0 || top < 0 || right > camera.imgSize[0] || bottom > camera.imgSize[1])
        throw new Error('请在图像内框住单个行人');
    const transform = new Matrix4().fromArray(camera.cameraExternal).transpose(), pixel = new Vector3();
    const projected: Projected[] = [], core: Projected[] = [];
    const clippedFoot = bottom >= camera.imgSize[1] - Math.max(3, height * .04);
    for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
        pixel.set(x, y, z).applyMatrix4(transform);
        if (pixel.z <= .1) continue;
        const u = fx * pixel.x / pixel.z + cx, v = fy * pixel.y / pixel.z + cy;
        if (u < left || u > right || v < top || v > bottom + (clippedFoot ? height * .6 : 0)) continue;
        const point = { index, x, y, z, depth: pixel.z, u, v };
        projected.push(point);
        if (u >= left + width * .25 && u <= right - width * .25 && v >= top + height * .2 && v <= top + height * .76) core.push(point);
    }
    core.sort((first, second) => first.depth - second.depth);
    let first = 0, bestFirst = 0, bestCount = 0;
    for (let last = 0; last < core.length; last++) {
        while (core[last].depth - core[first].depth > .55) first++;
        const count = last - first + 1;
        if (count > bestCount) { bestFirst = first; bestCount = count; }
    }
    if (bestCount < 4 || bestCount < core.length * .45) throw new Error('框内没有集中在同一深度的行人回波，请收紧图框或换机位');
    const layer = core.slice(bestFirst, bestFirst + bestCount), depth = layer[Math.floor(bestCount / 2)].depth;
    const anchorX = quantile(layer.map(point => point.x), .5), anchorY = quantile(layer.map(point => point.y), .5);
    const metresWide = width * depth / fx;
    if (metresWide < .15 || metresWide > 1.8) throw new Error('图框与单人宽度不符，请贴着人体两侧重画');
    const radius = Math.min(.7, Math.max(.32, metresWide * .6));
    const nearby = projected.filter(point => Math.abs(point.depth - depth) <= radius && Math.hypot(point.x - anchorX, point.y - anchorY) <= radius);
    const ground: number[] = [];
    for (let index = 0; index < positions.count; index++) {
        const distance = Math.hypot(positions.getX(index) - anchorX, positions.getY(index) - anchorY);
        if (distance >= .65 && distance <= 1.25) ground.push(positions.getZ(index));
    }
    const low = quantile(nearby.map(point => point.z), .02), high = quantile(nearby.map(point => point.z), .98);
    const floor = ground.length >= 8 ? quantile(ground, .1) : low;
    const base = Math.abs(floor - low) < .35 ? Math.min(floor, low) : low;
    const body = nearby.filter(point => point.z >= base + .1 && point.z <= high + .05);
    if (body.length < 6 || high - base < .65 || high - base > 2.4) throw new Error('人体高度方向的回波不足或混入背景，请换机位或使用手工框');
    const bounds = (axis: 'x' | 'y') => [quantile(body.map(point => point[axis]), .02) - .05, quantile(body.map(point => point[axis]), .98) + .05];
    const [minX, maxX] = bounds('x'), [minY, maxY] = bounds('y'), head = high + .08;
    const indices = nearby.filter(point => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY && point.z >= base + .06 && point.z <= head).map(point => point.index);
    return { center: [(minX + maxX) / 2, (minY + maxY) / 2, (base + head) / 2] as Triple,
        size: [maxX - minX, maxY - minY, head - base] as Triple, yaw: 0, indices, elapsed_ms: performance.now() - start };
}