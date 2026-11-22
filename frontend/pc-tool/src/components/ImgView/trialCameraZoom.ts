import { Transform2DAction, type Image2DRenderView } from 'pc-render';
import { Vector4 } from 'three';

export const maxCameraZoom = 16;

export function attachTrialCameraZoom(view: Image2DRenderView, changed: (scale: number) => void) {
    const { container, containerMatrix } = view;
    const transform = new Transform2DAction(view);
    const elements = containerMatrix.elements;
    const setViewport = view.setViewport;
    const imageRect = new Vector4();
    view.setViewport = () => {
        setViewport.call(view);
        if (elements[0] === 1) return;
        const stage = view.clientRect, rail = view.proxy.clientRect;
        const renderer = view.proxy.renderer;
        renderer.getScissor(imageRect);
        const left = Math.max(imageRect.x, stage.left - rail.left);
        const bottom = Math.max(imageRect.y, rail.bottom - stage.bottom);
        renderer.setScissor(left, bottom,
            Math.max(0, Math.min(imageRect.x + imageRect.z, stage.right - rail.left) - left),
            Math.max(0, Math.min(imageRect.y + imageRect.w, rail.bottom - stage.top) - bottom));
    };

    function zoom(factor: number, clientX?: number, clientY?: number) {
        const rect = container.getBoundingClientRect();
        const scale = Math.max(1, Math.min(maxCameraZoom, elements[0] * factor));
        if (scale === elements[0]) return;
        if (scale === 1) return reset();
        const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
        const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
        const ratio = scale / elements[0];
        containerMatrix.setPosition(x + (elements[12] - x) * ratio, y + (elements[13] - y) * ratio, 0);
        elements[0] = elements[5] = scale;
        transform.onRender();
        changed(scale);
    }

    function reset() {
        transform.reset();
        changed(1);
    }

    function wheel(event: WheelEvent) {
        if (!event.deltaY) return;
        event.preventDefault();
        event.stopPropagation();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
        zoom(Math.exp(-Math.max(-400, Math.min(400, event.deltaY * unit)) / 400), event.clientX, event.clientY);
    }

    let drag: { pointer: number; x: number; y: number } | undefined;
    function down(event: PointerEvent) {
        if (elements[0] === 1 || !event.isPrimary || event.button !== 0) return;
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        container.setPointerCapture(event.pointerId);
    }
    function move(event: PointerEvent) {
        if (!drag || drag.pointer !== event.pointerId) return;
        const { width, height } = container.getBoundingClientRect();
        const scale = elements[0];
        const x = Math.min(0, Math.max(width * (1 - scale), elements[12] + event.clientX - drag.x));
        const y = Math.min(0, Math.max(height * (1 - scale), elements[13] + event.clientY - drag.y));
        containerMatrix.setPosition(x, y, 0);
        drag.x = event.clientX;
        drag.y = event.clientY;
        transform.onRender();
    }
    function end(event: PointerEvent) {
        if (drag?.pointer !== event.pointerId) return;
        drag = undefined;
        if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    }

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    container.addEventListener('wheel', wheel, { ...options, passive: false });
    container.addEventListener('pointerdown', down, options);
    container.addEventListener('pointermove', move, options);
    container.addEventListener('touchmove', event => {
        if (drag && event.cancelable) event.preventDefault();
    }, { ...options, passive: false });
    container.addEventListener('pointerup', end, options);
    container.addEventListener('pointercancel', end, options);
    container.addEventListener('lostpointercapture', end, options);
    return { zoom, reset, dispose() {
        listeners.abort();
        view.setViewport = setViewport;
    } };
}