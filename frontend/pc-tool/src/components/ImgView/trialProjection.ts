import * as THREE from 'three';
import type { Image2DRenderView } from 'pc-render';

export function attachTrialProjection(view: Image2DRenderView, thumbnail?: () => HTMLImageElement | undefined) {
    const outline = new THREE.LineSegments();
    outline.matrixAutoUpdate = false;
    let renderingThumbnail = false;
    view.renderPreviewBoxes = () => {
        const scene = view.pointCloud.scene;
        const formal = new Set(view.pointCloud.getAnnotate3D().map(box => box.uuid));
        const preview = scene.getObjectByName('centerpoint-preview');
        const selectedId = preview?.userData.selectedId;
        const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
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
                if (!renderingThumbnail && name === 'centerpoint-preview') {
                    const box = edge.getObjectByName('centerpoint-bounds') as THREE.Mesh | null;
                    const label = edge.getObjectByName('centerpoint-label');
                    if (!box || !label) continue;
                    const { center, size } = view.getBoxRect(box as any);
                    const left = center.x - size.x / 2, right = center.x + size.x / 2;
                    const top = center.y - size.y / 2, bottom = center.y + size.y / 2;
                    if (right < 0 || left > view.imgSize.x || bottom < 0 || top > view.imgSize.y) continue;
                    const text = label.userData.text as string;
                    const context = view.proxy.context;
                    context.save();
                    context.font = 'bold 34px sans-serif';
                    context.textAlign = 'left';
                    context.textBaseline = 'middle';
                    const textWidth = context.measureText(text).width;
                    const paddingX = 10, paddingY = 7, labelWidth = textWidth + paddingX * 2, labelHeight = 42;
                    const gap = 5, maxTop = view.imgSize.y - labelHeight - 4;
                    const leftX = Math.max(4, Math.min(left, view.imgSize.x - labelWidth - 4));
                    const rightX = Math.max(4, Math.min(right - labelWidth, view.imgSize.x - labelWidth - 4));
                    const centerX = Math.max(4, Math.min(center.x - labelWidth / 2, view.imgSize.x - labelWidth - 4));
                    const above = Math.min(maxTop, Math.max(4, top - labelHeight - gap));
                    const below = Math.min(maxTop, Math.max(4, bottom + gap));
                    const placements: Array<{ x: number; y: number }> = [];
                    for (let offset = 0; offset <= maxTop / (labelHeight + gap); offset++) {
                        for (const x of [leftX, rightX, centerX]) {
                            placements.push({ x, y: above - offset * (labelHeight + gap) });
                            placements.push({ x, y: below + offset * (labelHeight + gap) });
                        }
                    }
                    const placement = placements.find(({ x, y }) => y >= 4 && y <= maxTop &&
                        placedLabels.every(other => x + labelWidth + gap <= other.left || x >= other.right + gap ||
                            y + labelHeight + gap <= other.top || y >= other.bottom + gap));
                    const labelX = placement?.x ?? leftX;
                    const labelY = placement?.y ?? above;
                    placedLabels.push({ left: labelX, top: labelY, right: labelX + labelWidth, bottom: labelY + labelHeight });
                    const selected = edge.name === selectedId;
                    const categoryColor = (edge.material as THREE.LineBasicMaterial).color.getStyle();
                    const anchorX = Math.max(left, Math.min(center.x, right));
                    const anchorY = labelY + labelHeight < top ? top : labelY > bottom ? bottom : Math.max(top, Math.min(center.y, bottom));
                    context.beginPath();
                    context.moveTo(labelX + labelWidth / 2, labelY + labelHeight / 2);
                    context.lineTo(anchorX, anchorY);
                    context.lineWidth = selected ? 4 : 3;
                    context.strokeStyle = selected ? '#faff48' : categoryColor;
                    context.stroke();
                    context.fillStyle = selected ? '#faff48' : 'rgba(11, 17, 24, 0.94)';
                    context.fillRect(labelX, labelY, labelWidth, labelHeight);
                    context.lineWidth = selected ? 4 : 3;
                    context.strokeStyle = selected ? '#fff3a0' : categoryColor;
                    context.strokeRect(labelX, labelY, labelWidth, labelHeight);
                    context.fillStyle = selected ? '#172328' : '#ffffff';
                    context.fillText(text, labelX + paddingX, labelY + labelHeight / 2);
                    context.restore();
                }
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
        renderingThumbnail = true;
        try { view.renderObjects(); }
        finally { renderingThumbnail = false; }
    };
}