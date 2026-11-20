import * as THREE from 'three';
import PCDLoader from '../packages/pc-render/loader/PCDLoader';
import type Editor from './Editor';

interface Scan {
    id: string;
    pointsUrl: string;
    worldFromLidar: ArrayLike<number>;
}

type OverlayEditor = { pc: Pick<Editor['pc'], 'scene' | 'render'> };

class Overlay {
    group = new THREE.Group();
    material = new THREE.PointsMaterial({
        color: 0x586267, size: 1, sizeAttenuation: false, depthWrite: false,
    });
    request = new AbortController();

    dispose() {
        this.request.abort();
        this.group.removeFromParent();
        this.group.children.forEach(child => (child as THREE.Points).geometry.dispose());
        this.material.dispose();
    }
}

const active = new WeakMap<OverlayEditor, Overlay>();
const caches = new WeakMap<OverlayEditor, Map<string, Float32Array>>();

export async function setTrialOverlay(
    editor: OverlayEditor, scans: readonly Scan[], currentId: string, radius: number,
): Promise<void> {
    const previous = active.get(editor);
    previous?.dispose();
    active.delete(editor);
    if (previous) editor.pc.render();

    const index = scans.findIndex(scan => scan.id === currentId);
    const reach = Math.floor(radius);
    if (!Number.isFinite(reach) || reach < 1 || index < 0) {
        caches.delete(editor);
        return;
    }

    const overlay = new Overlay();
    active.set(editor, overlay);
    overlay.group.name = 'trial-background-scans';
    overlay.group.renderOrder = -1;
    const cache = caches.get(editor) || new Map<string, Float32Array>();
    caches.set(editor, cache);
    const signal = overlay.request.signal;

    try {
        const currentFromWorld = new THREE.Matrix4().fromArray(scans[index].worldFromLidar).invert();
        for (const scan of scans.slice(Math.max(0, index - reach), index + reach + 1)) {
            if (scan.id === currentId) continue;
            let positions = cache.get(scan.pointsUrl);
            if (!positions) {
                const response = await fetch(scan.pointsUrl, { signal });
                if (!response.ok) throw new Error(`Overlay PCD ${response.status}: ${scan.pointsUrl}`);
                const data = await response.arrayBuffer();
                if (signal.aborted) return;
                positions = new PCDLoader().parse2(data).position;
            }
            cache.delete(scan.pointsUrl);
            cache.set(scan.pointsUrl, positions);
            if (cache.size > 8) cache.delete(cache.keys().next().value);

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const points = new THREE.Points(geometry, overlay.material);
            points.name = scan.id;
            points.raycast = () => {};
            points.matrix.fromArray(scan.worldFromLidar).premultiply(currentFromWorld);
            points.matrixAutoUpdate = false;
            points.matrixWorldNeedsUpdate = true;
            overlay.group.add(points);
        }
        const scene = editor.pc.scene;
        scene.add(overlay.group);
        scene.children.splice(scene.children.indexOf(overlay.group), 1);
        scene.children.unshift(overlay.group);
        editor.pc.render();
    } catch (error) {
        if (signal.aborted) return;
        overlay.dispose();
        active.delete(editor);
        throw error;
    }
}