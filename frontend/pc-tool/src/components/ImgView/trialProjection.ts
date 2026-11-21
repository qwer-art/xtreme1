import * as THREE from 'three';
import type { Image2DRenderView } from 'pc-render';

export function attachTrialProjection(view: Image2DRenderView, thumbnail?: () => HTMLImageElement | undefined) {
    const outline = new THREE.LineSegments();
    outline.matrixAutoUpdate = false;
    view.renderPreviewBoxes = () => {
        const scene = view.pointCloud.scene;
        const formal = new Set(view.pointCloud.getAnnotate3D().map(box => box.uuid));
        for (const name of ['trial-candidate-preview', 'centerpoint-preview']) {
            const group = scene.getObjectByName(name);
            if (!group?.visible) continue;
            for (const edge of group.children) {
                if (!(edge instanceof THREE.LineSegments) || !edge.visible || formal.has(edge.name)) continue;
                edge.updateWorldMatrix(true, false);
                outline.geometry = edge.geometry;
                outline.material = edge.material;
                outline.matrix.copy(edge.matrixWorld);
                outline.updateMatrixWorld(true);
                view.proxy.renderer.render(outline, view.camera);
            }
        }
    };
    if (thumbnail) view.renderThumbnail = () => {
        const image = thumbnail();
        if (!view.renderBox || !image?.naturalWidth || !image.naturalHeight || image.currentSrc !== view.img?.src) return;
        const rect = image.getBoundingClientRect();
        const { clientRect: rail, renderer } = view.proxy;
        if (!rect.width || !rect.height || rect.bottom <= rail.top || rect.top >= rail.bottom) return;
        const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        const left = rect.left - rail.left + (rect.width - width) / 2;
        const bottom = rail.bottom - rect.bottom + (rect.height - height) / 2;
        renderer.setViewport(left, bottom, width, height);
        renderer.setScissor(left, bottom, width, height);
        view.renderObjects();
    };
}