import type Editor from '../../common/Editor';
import type { Image2DRenderView } from 'pc-render';
import { visibleLidarSamples } from './trialLidarDepth';
import { depthBandIndex, depthBands } from './trialDepthColors';

function depthDot(color: string, size: number) {
    const dot = document.createElement('canvas');
    dot.width = dot.height = size;
    const context = dot.getContext('2d')!;
    const radius = size / 2;
    context.beginPath(); context.arc(radius, radius, radius, 0, Math.PI * 2);
    context.fillStyle = '#14202b'; context.fill();
    context.beginPath(); context.arc(radius, radius, radius * 0.73, 0, Math.PI * 2);
    context.fillStyle = color; context.fill();
    return dot;
}

export function attachTrialLidar(view: Image2DRenderView, editor: Editor, active: () => boolean) {
    const layer = document.createElement('canvas');
    let previousPoints: ArrayLike<number> | undefined;
    let previousCamera: typeof view.option | undefined;
    view.renderImageOverlay = () => {
        const { state } = editor;
        if (!state.config.renderProjectPoint || !active() || !view.img?.naturalWidth) return;
        const frame = state.frames[state.frameIndex];
        const resource = frame && editor.dataResource.dataMap[frame.id];
        const positions = resource?.pointsData?.position;
        const camera = view.option;
        if (!positions || !resource.viewConfig.some(config => config.imgUrl === camera.imgUrl && config.imgObject === view.img)) return;
        if (positions !== previousPoints || camera !== previousCamera) {
            layer.width = view.img.naturalWidth;
            layer.height = view.img.naturalHeight;
            const context = layer.getContext('2d')!;
            const size = Math.max(5, Math.round(layer.width / 235));
            const dots = depthBands.map(band => depthDot(band.color, size));
            for (const { x, y, depth } of visibleLidarSamples(positions, camera.cameraExternal,
                camera.cameraInternal, layer.width, layer.height)) {
                context.drawImage(dots[depthBandIndex(depth)], Math.round(x - size / 2), Math.round(y - size / 2));
            }
            previousPoints = positions;
            previousCamera = camera;
        }
        view.proxy.context.drawImage(layer, 0, 0);
    };
}