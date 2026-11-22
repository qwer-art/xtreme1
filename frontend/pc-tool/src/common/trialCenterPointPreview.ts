import * as THREE from 'three';
import { SideRenderView } from 'pc-render';
import type Editor from './Editor';
import type { CenterPointCandidate } from './trialCenterPoint';
import { detectionColors } from './trialDetectionColors';

export function centerPointPreview(editor: Editor, candidates: CenterPointCandidate[]) {
    const group = new THREE.Group();
    group.name = 'centerpoint-preview';
    const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const parts = candidates.map((item, index) => {
        const [length, width, height] = item.size;
        const box = new THREE.Mesh(new THREE.BoxGeometry(length, width, height), hitMaterial);
        box.geometry.computeBoundingBox();
        box.visible = false;
        box.name = 'centerpoint-bounds';
        const color = detectionColors[item.category];
        const material = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), material);
        edges.name = item.id;
        edges.position.set(...item.center); edges.rotation.z = item.yaw;
        const tip = length / 2, base = length / 5, wing = width / 3, top = height / 2;
        const arrow = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
            new THREE.Float32BufferAttribute([0,0,top, tip,0,top, base,wing,top, tip,0,top, base,-wing,top, tip,0,top], 3)), material);
        arrow.name = 'heading';
        const shortId = (value: string) => value.match(/(\d+[^\/]*)$/)?.[1]?.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || value.slice(-8);
        const trackId = item.trackName === '未跟踪' ? item.trackName : shortId(item.trackName);
        const canvas = document.createElement('canvas');
        canvas.width = 180; canvas.height = 32;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#172328'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = color; context.font = 'bold 20px sans-serif'; context.textAlign = 'center';
        context.fillText(`#${index + 1} ID:${trackId}  ${item.score.toFixed(2)}`, 90, 23);
        const texture = new THREE.CanvasTexture(canvas);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
        label.name = 'centerpoint-label';
        label.userData.text = `#${index + 1} ID:${trackId}  ${item.score.toFixed(2)}`;
        label.scale.set(.075, .012, 1); label.position.z = top + .3;
        edges.add(box, arrow, label); group.add(edges);
        return { box, item, material, edges, color, arrow, label, texture };
    });
    editor.pc.scene.add(group); group.updateMatrixWorld(true); editor.pc.render();
    return {
        setHidden(categories: ReadonlySet<string>) {
            for (const part of parts) part.edges.visible = !categories.has(part.item.category);
            this.select(group.userData.selectedId || '');
        },
        select(id: string) {
            group.userData.selectedId = id;
            parts.forEach(part => part.material.color.set(part.item.id === id ? '#faff48' : part.color));
            const active = parts.find(part => part.item.id === id && part.edges.visible);
            for (const view of editor.pc.renderViews) {
                if (view instanceof SideRenderView) view.setPreviewTarget(active?.box || null, active?.edges || null);
                view.render();
            }
            editor.pc.render();
        },
        pick(camera: THREE.Camera, mouse: THREE.Vector2) {
            const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera);
            const hit = ray.intersectObjects(parts.filter(part => part.edges.visible).map(part => part.box))[0];
            return hit?.object.parent?.name;
        },
        dispose() {
            for (const view of editor.pc.renderViews) {
                if (view instanceof SideRenderView && view.previewTarget?.parent?.parent === group)
                    view.setPreviewTarget(null, null);
            }
            group.removeFromParent(); hitMaterial.dispose();
            for (const { box, material, edges, arrow, label, texture } of parts) {
                box.geometry.dispose(); edges.geometry.dispose(); arrow.geometry.dispose(); material.dispose();
                label.material.dispose(); texture.dispose();
            }
            editor.pc.render();
        },
    };
}