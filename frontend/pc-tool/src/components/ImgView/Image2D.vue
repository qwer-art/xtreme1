<template>
    <div
        class="img-view"
        @dblclick="onDBClick"
        :style="{
            borderColor: state.config.imgRegionIndex === props.imgIndex ? '#1890ff' : '#2e2525',
            aspectRatio: state.config.aspectRatio,
        }"
    >
        <div class="render" :class="{ 'camera-zoomed': localTrial && zoomScale > 1 }" ref="dom"></div>
        <div v-if="armed" class="pedestrian-drag" data-testid="camera-pedestrian-drag"
            @pointerdown.prevent="startDrag" @pointermove="moveDrag" @pointerup="finishDrag"
            @pointercancel="cancelDrag" @lostpointercapture="drag && cancelDrag()" @dblclick.stop @contextmenu.prevent>
            <div v-if="drag" class="pedestrian-rect" :style="rectStyle" />
        </div>
        <button v-if="localTrial && primary" type="button" class="pedestrian-tool" data-testid="camera-pedestrian-toggle"
            aria-label="图上框行人" :aria-pressed="armed" :title="armed ? '取消框选 (Esc)' : '在图像上拖框生成待审行人'"
            @dblclick.stop @click.stop="togglePedestrian"><BorderOutlined />{{ armed ? '取消框选' : '图上框行人' }}</button>
        <TrialDepthLegend v-if="localTrial && primary && state.config.renderProjectPoint" />
        <div v-if="localTrial" class="camera-zoom" role="group" aria-label="相机图像工具" @dblclick.stop>
            <button type="button" aria-label="点云投影" title="显示或隐藏深度点" :aria-pressed="state.config.renderProjectPoint"
                @click.stop="state.config.renderProjectPoint = !state.config.renderProjectPoint; pc.render()"><DotChartOutlined /></button>
            <button type="button" aria-label="缩小图像" title="缩小图像" :disabled="zoomScale <= 1"
                @click.stop="cameraZoom?.zoom(1 / 1.5)"><MinusOutlined /></button>
            <button type="button" aria-label="放大图像" title="放大图像" :disabled="zoomScale >= maxCameraZoom"
                @click.stop="cameraZoom?.zoom(1.5)"><PlusOutlined /></button>
            <button type="button" aria-label="恢复全图" title="恢复全图" :disabled="zoomScale <= 1"
                @click.stop="cameraZoom?.reset()"><ReloadOutlined /></button>
        </div>
        <div class="tool">
            <button v-if="localTrial" type="button" class="icon expand-camera" title="放大相机" aria-label="放大相机"
                @click.stop="onDBClick" @dblclick.stop><FullscreenOutlined /></button>
            <span
                :class="state.config.imgRegionIndex === props.imgIndex ? 'icon active' : 'icon'"
                @dblclick.stop="null"
                @click.stop="showView"
            >
                <span class="eye-icon" :title="$$('show-camera')">
                    <EyeOutlined />
                </span>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, shallowRef, onBeforeUnmount, watch } from 'vue';
    import * as THREE from 'three';
    import { Image2DRenderView, PointsMaterial, Rect } from 'pc-render';
    import { useInjectState, useInjectEditor } from '../../state';
    import * as locale from './lang';

    import useUI from '../../hook/useUI';
    import useContextMenu from '../../hook/useContextMenu';
    import { BorderOutlined, DotChartOutlined, FullscreenOutlined, EyeOutlined, MinusOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue';
    import useInjectProxy from './useProxy';
    import { localTrial } from '../../common/localTrial';
    import { attachTrialProjection } from './trialProjection';
    import { attachTrialLidar } from './trialLidarOverlay';
    import TrialDepthLegend from './TrialDepthLegend.vue';
    import { attachTrialCameraZoom, maxCameraZoom } from './trialCameraZoom';
    import { isTrialFrameImage } from './trialFrameImage';

    // ***************Props and Emits***************
    interface ImgViewProps {
        imgIndex: number;
        primary?: boolean;
    }

    const props = withDefaults(defineProps<ImgViewProps>(), {
        imgIndex: 0,
    });

    // *********************************************

    let dom = ref<HTMLDivElement | null>(null);
    let editor = useInjectEditor();
    let pc = editor.pc;
    let view = {} as Image2DRenderView;
    let state = useInjectState();
    let $$ = editor.bindLocale(locale);
    let { canOperate } = useUI();
    let { handleContext, clearContext } = useContextMenu();
    let renderProxy = useInjectProxy();
    const zoomScale = ref(1);
    const cameraZoom = shallowRef<ReturnType<typeof attachTrialCameraZoom>>();
    const armed = ref(false);
    const drag = shallowRef<{ pointer: number; start: THREE.Vector2; end: THREE.Vector2 }>();
    const frameId = computed(() => state.frames[state.frameIndex]?.id);
    const camera = computed(() => state.imgViews[props.imgIndex]);
    const rectStyle = computed(() => {
        if (!drag.value) return {};
        const { start, end } = drag.value;
        return { left: `${Math.min(start.x, end.x)}px`, top: `${Math.min(start.y, end.y)}px`,
            width: `${Math.abs(start.x - end.x)}px`, height: `${Math.abs(start.y - end.y)}px` };
    });
    function freshPhoto() {
        const image = view.img;
        return props.primary && isTrialFrameImage(frameId.value, camera.value?.imgUrl) && image?.complete &&
            image.naturalWidth > 0 && image.naturalHeight > 0 && image.src === camera.value?.imgObject?.src;
    }
    function cancelDrag() { drag.value = undefined; armed.value = false; }
    function escape(event: KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopImmediatePropagation(); cancelDrag();
    }
    watch(armed, active => {
        if (active) window.addEventListener('keydown', escape, true);
        else window.removeEventListener('keydown', escape, true);
    }, { flush: 'sync' });
    watch([() => props.primary, frameId, () => camera.value?.imgUrl, () => state.config.showSingleImgView], cancelDrag, { flush: 'sync' });
    function togglePedestrian() {
        if (armed.value) return cancelDrag();
        if (!freshPhoto()) return;
        editor.dispatchEvent({ type: 'trial-camera-pedestrian-arm', data: () => { armed.value = true; } });
    }
    function localPoint(event: PointerEvent) {
        const bounds = dom.value!.getBoundingClientRect();
        return new THREE.Vector2(event.clientX - bounds.left, event.clientY - bounds.top);
    }
    function startDrag(event: PointerEvent) {
        if (drag.value || !event.isPrimary || event.button !== 0 || !freshPhoto()) return;
        const start = localPoint(event), pixel = start.clone();
        view.domToImg(pixel);
        if (pixel.x < 0 || pixel.y < 0 || pixel.x >= view.imgSize.x || pixel.y >= view.imgSize.y) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.value = { pointer: event.pointerId, start, end: start };
    }
    function moveDrag(event: PointerEvent) {
        if (drag.value?.pointer === event.pointerId) drag.value = { ...drag.value, end: localPoint(event) };
    }
    function finishDrag(event: PointerEvent) {
        if (drag.value?.pointer !== event.pointerId) return;
        const start = drag.value.start.clone(), end = localPoint(event);
        if (!freshPhoto()) return cancelDrag();
        if (Math.abs(start.x - end.x) < 3 || Math.abs(start.y - end.y) < 3) { drag.value = undefined; return; }
        view.domToImg(start); view.domToImg(end);
        end.clamp(new THREE.Vector2(), view.imgSize);
        cancelDrag();
        editor.dispatchEvent({ type: 'trial-camera-pedestrian-rect', data: { scanId: frameId.value, imgIndex: props.imgIndex,
            imgUrl: camera.value.imgUrl, rect: { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
                right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) } } });
    }

    onMounted(() => {
        // console.log('img view onMounted');
        if (dom.value) {
            let config = state.config;
            view = new Image2DRenderView(dom.value, pc, {
                name: `${config.imgViewPrefix}-${props.imgIndex}`,
                // actions: [],
                actions: ['render-2d-shape'],
                proxy: renderProxy,
            });
            if (localTrial) {
                attachTrialProjection(view);
                attachTrialLidar(view, editor, () => !!freshPhoto() && !state.config.showSingleImgView);
                cameraZoom.value = attachTrialCameraZoom(view, scale => { zoomScale.value = scale; });
            }
            view.renderBox = state.config.projectMap3d && state.config.renderProjectBox;
            view.renderRect = state.config.projectPoint4;
            view.renderBox2D = state.config.projectPoint8;

            view.id = `${config.imgViewPrefix}-${props.imgIndex}`;
            pc.addRenderView(view);

            // let info = get2DInfo(props.imgIndex);
            view.setOptions(state.imgViews[props.imgIndex]);
            view.renderPoints = false;

            handleContext(dom.value);
        }
    });

    onBeforeUnmount(() => {
        cancelDrag();
        window.removeEventListener('keydown', escape, true);
        cameraZoom.value?.dispose();
        clearContext();

        pc.removeRenderView(view);
        renderProxy.removeView(view);
        view.destroy();
    });

    function showView(e: MouseEvent) {
        let points = pc.groupPoints.children[0] as THREE.Points;
        let material = points.material as PointsMaterial;
        if (state.config.imgRegionIndex === props.imgIndex) {
            state.config.imgRegionIndex = -1;
            material.setUniforms({
                hasCameraRegion: -1,
            });
        } else {
            state.config.imgRegionIndex = props.imgIndex;
            let matrix = new THREE.Matrix4()
                .copy(view.camera.projectionMatrix)
                .multiply(view.camera.matrixWorldInverse);
            material.setUniforms({
                hasCameraRegion: 1,
                regionMatrix: matrix,
            });
        }
        pc.render();
    }

    function onDBClick() {
        if (!canOperate()) return;
        editor.viewManager.showSingleImgView(props.imgIndex);
    }

    function rand(start: number, end: number) {
        return Math.round(start + (end - start) * Math.random());
    }
</script>

<style lang="less" scoped>
    .img-view {
        // height: 100%;
        position: relative;
        color: white;
        // padding: 3px;
        // background: #2e2525;
        border: 2px solid #2e2525;
        width: 100%;
        // min-height: 100px;
        aspect-ratio: 1.78;

        .render {
            height: 100%;
        }

        .pedestrian-tool, .pedestrian-drag { position: absolute; z-index: 2; }
        .pedestrian-tool { left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 5px;
            min-height: 32px; padding: 2px 7px; background: #26292d; color: white; border: 1px solid #808790;
            border-radius: 4px; cursor: pointer; }
        .pedestrian-tool[aria-pressed=true] { background: #155343; border-color: #76e8bb; }
        .pedestrian-drag { inset: 0; cursor: crosshair; touch-action: none; user-select: none; }
        .pedestrian-rect { position: absolute; pointer-events: none; border: 2px solid #76e8bb;
            background: rgba(48, 180, 133, .15); box-sizing: border-box; }

        .camera-zoomed {
            cursor: grab;
            touch-action: none;
            &:active { cursor: grabbing; }
        }

        .camera-zoom {
            position: absolute;
            z-index: 2;
            right: 6px;
            bottom: 6px;
            display: flex;
            gap: 2px;
            button {
                display: grid;
                place-items: center;
                width: 32px;
                height: 32px;
                border: 0;
                border-radius: 4px;
                background: #26292d;
                color: white;
                cursor: pointer;
                touch-action: manipulation;
                &[aria-pressed=true] { color: #76e8bb; }
                &:disabled { color: #95999e; cursor: default; }
                &:focus-visible { outline: 2px solid #69baff; outline-offset: -2px; }
            }
            @media (pointer: coarse) { button { width: 44px; height: 44px; } }
        }

        .icon {
            vertical-align: middle;
            display: inline-block;
            background: #333333;
            line-height: 24px;
            height: 24px;
            padding: 0px 6px;
            border-radius: 4px;
            cursor: pointer;

            &.active {
                color: #40a9ff;
            }
        }

        .tool {
            position: absolute;
            right: 6px;
            top: 6px;
            &:has(.expand-camera) { display: flex; }
            .expand-camera { border: 0; color: inherit; align-items: center; }
            .icon {
                .camera-heading {
                    font-size: 14px;
                    padding-right: 3px;
                    text-overflow: ellipsis;
                    overflow: hidden;
                    display: inline-block;
                    flex: 1;
                }
                .eye-icon {
                    display: inline-block;
                }
                display: flex;
                max-width: 90px;
                // width: 28px;
                text-align: center;
                font-size: 16px;
                margin-left: 6px;
                padding-right: 6px;
                white-space: nowrap;
            }
        }
    }
</style>
