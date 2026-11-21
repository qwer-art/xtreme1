import * as THREE from 'three';
import type Editor from './Editor';
import type { CenterPointCandidate } from './trialCenterPoint';
import { detectionColors } from './trialDetectionColors';

export function centerPointPreview(editor: Editor, candidates: CenterPointCandidate[]) {
    const group = new THREE.Group();
    group.name = 'centerpoint-preview';
    const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const parts = candidates.map(item => {
        const [length, width, height] = item.size;
        const box = new THREE.Mesh(new THREE.BoxGeometry(length, width, height), hitMaterial);
        box.visible = false;
        const color = detectionColors[item.category];
        const material = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), material);
        edges.name = item.id;
        edges.position.set(...item.center); edges.rotation.z = item.yaw;
        const tip = length / 2, base = length / 5, wing = width / 3, top = height / 2;
        const arrow = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
            new THREE.Float32BufferAttribute([0,0,top, tip,0,top, base,wing,top, tip,0,top, base,-wing,top, tip,0,top], 3)), material);
        arrow.name = 'heading';
        const canvas = document.createElement('canvas');
        canvas.width = 224; canvas.height = 36;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#172328'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = color; context.font = 'bold 24px sans-serif'; context.textAlign = 'center';
        context.fillText(`${item.category} ${item.score.toFixed(2)}`, 112, 26);
        const texture = new THREE.CanvasTexture(canvas);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
        label.scale.set(.075, .012, 1); label.position.z = top + .3;
        edges.add(box, arrow, label); group.add(edges);
        return { box, item, material, edges, color, arrow, label, texture };
    });
    editor.pc.scene.add(group); group.updateMatrixWorld(true); editor.pc.render();
    return {
        setHidden(categories: ReadonlySet<string>) {
            for (const part of parts) part.edges.visible = !categories.has(part.item.category);
            editor.pc.render();
        },
        select(id: string) {
            parts.forEach(part => part.material.color.set(part.item.id === id ? '#faff48' : part.color));
            editor.pc.render();
        },
        pick(camera: THREE.Camera, mouse: THREE.Vector2) {
            const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera);
            const hit = ray.intersectObjects(parts.filter(part => part.edges.visible).map(part => part.box))[0];
            return hit?.object.parent?.name;
        },
        dispose() {
            group.removeFromParent(); hitMaterial.dispose();
            for (const { box, material, edges, arrow, label, texture } of parts) {
                box.geometry.dispose(); edges.geometry.dispose(); arrow.geometry.dispose(); material.dispose();
                label.material.dispose(); texture.dispose();
            }
            editor.pc.render();
        },
    };
}