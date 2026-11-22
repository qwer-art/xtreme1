import * as THREE from 'three';
import type Editor from './Editor';
import { utils } from 'pc-editor';
import { readLocalObjects } from './trialAnnotations';

export type Triple = [number, number, number];
export interface Shape { center: Triple; size: Triple; yaw: number; elapsed_ms: number }
export interface Candidate extends Shape {
    id: string; scanId: string; trackId: string; trackName: string; category: string;
    indices: number[]; prompts?: Prompt[]; cameraGuided?: boolean;
}
export interface Prompt { index: number; positive: boolean }

export function scanCloud(editor: Editor) {
    const cloud = editor.pc.groupPoints.children[0] as THREE.Points | undefined;
    if (!cloud?.geometry.getAttribute('position')?.count) throw new Error('当前扫描点未加载');
    return cloud;
}

export function pickVertex(cloud: THREE.Points, camera: THREE.Camera, rect: DOMRect, x: number, y: number) {
    const positions = cloud.geometry.getAttribute('position');
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(cloud.matrixWorld);
    const point = new THREE.Vector3();
    let best = -1, distance = 36, depth = Infinity;
    for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(projection);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
        const dx = rect.left + (point.x + 1) * rect.width / 2 - x;
        const dy = rect.top + (1 - point.y) * rect.height / 2 - y;
        const squared = dx * dx + dy * dy;
        if (squared > 36) continue;
        if (point.z < depth || (point.z === depth && squared < distance)) {
            best = index; distance = squared; depth = point.z;
        }
    }
    return best;
}

export function checkedShape(value: { center: number[]; size: number[]; yaw: number; elapsed_ms: number } | null): Shape {
    const triple = (array: unknown): array is Triple => Array.isArray(array) && array.length === 3 && array.every(Number.isFinite);
    if (!value || !triple(value.center) || !triple(value.size) || value.size.some(n => n <= 0) ||
        !Number.isFinite(value.yaw) || !Number.isFinite(value.elapsed_ms) || value.elapsed_ms < 0)
        throw new Error('候选框返回的几何或耗时无效');
    return { center: value.center, size: value.size, yaw: value.yaw, elapsed_ms: value.elapsed_ms };
}

export async function segment(scanId: string, cloud: THREE.Points, prompts: Prompt[], signal: AbortSignal) {
    const positions = cloud.geometry.getAttribute('position');
    const points = Array.from({ length: positions.count }, (_, index) =>
        [positions.getX(index), positions.getY(index), positions.getZ(index)]);
    const response = await fetch('/trial-model/segment', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan_id: scanId, points, prompts }) });
    if (!response.ok) throw new Error(`模型分割 HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const result = await response.json();
    const shape = checkedShape(result);
    if (!Array.isArray(result.indices) || !result.indices.length ||
        !result.indices.every((index: number) => Number.isInteger(index) && index >= 0 && index < points.length))
        throw new Error('模型未返回有效点掩码');
    if (shape.size[2] < 0.12 && Math.max(shape.size[0], shape.size[1]) > 1.5)
        throw new Error(`结果像地面回波，不是立体目标（高 ${shape.size[2].toFixed(2)} m）；请把前景点移到目标立面`);
    return { ...shape, indices: result.indices as number[] };
}

export function acceptCandidates(editor: Editor, candidates: Candidate[]) {
    if (!candidates.length) return;
    const targets = candidates.map(candidate => {
        checkedShape(candidate);
        const frame = editor.state.frames.find(item => item.id === candidate.scanId);
        if (!frame) throw new Error('请切换到全部帧后接受该候选');
        return frame;
    });
    const missing = [...new Set(targets)].filter(frame => !editor.dataManager.getFrameObject(frame.id));
    if (missing.length) {
        const { objectsMap } = readLocalObjects(missing);
        for (const frame of missing) {
            const objects = utils.convertObject2Annotate(objectsMap[frame.id], editor);
            editor.dataManager.setFrameObject(frame.id, objects);
            editor.dataManager.updateFrameId(frame.id);
        }
    }
    const seen = new Set<string>();
    candidates.forEach(candidate => {
        const key = `${candidate.scanId}:${candidate.trackId}`;
        if (seen.has(key) || editor.dataManager.getFrameObject(candidate.scanId)?.some(obj =>
            obj.uuid === candidate.id || obj.userData.trackId === candidate.trackId))
            throw new Error(`目标帧已有该框或轨迹：${candidate.trackId}`);
        seen.add(key);
    });
    const additions = candidates.map((candidate, index) => ({ frame: targets[index], objects:
        editor.createAnnotate3D(new THREE.Vector3(...candidate.center), new THREE.Vector3(...candidate.size),
            new THREE.Euler(0, 0, candidate.yaw), { id: candidate.id, trackId: candidate.trackId,
                trackName: candidate.trackName, classId: candidate.category, classType: candidate.category }) }));
    editor.cmdManager.execute('add-object', additions);
}

export function preview(editor: Editor, candidate: Candidate | undefined, prompts: Prompt[]) {
    const group = new THREE.Group();
    group.name = 'trial-candidate-preview';
    group.userData.cameraGuided = candidate?.cameraGuided;
    if (candidate) {
        const cube = new THREE.BoxGeometry(...candidate.size);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube), new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false }));
        cube.dispose();
        edges.position.set(...candidate.center);
        edges.rotation.z = candidate.yaw;
        group.add(edges);
    }
    const markers = (indices: number[], color: number, size: number) => {
        if (!indices.length) return;
        const positions = scanCloud(editor).geometry.getAttribute('position');
        const coords = new Float32Array(indices.length * 3);
        indices.forEach((index, offset) => coords.set([positions.getX(index), positions.getY(index), positions.getZ(index)], offset * 3));
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(coords, 3));
        group.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })));
    };
    markers(candidate?.indices || [], 0xffcc00, 4);
    markers(prompts.filter(item => item.positive).map(item => item.index), 0x00ffbb, 9);
    markers(prompts.filter(item => !item.positive).map(item => item.index), 0xff367d, 9);
    editor.pc.scene.add(group);
    editor.pc.render();
    return () => {
        group.removeFromParent();
        for (const child of group.children) {
            const object = child as THREE.Points<THREE.BufferGeometry, THREE.Material>;
            object.geometry.dispose(); object.material.dispose();
        }
        editor.pc.render();
    };
}