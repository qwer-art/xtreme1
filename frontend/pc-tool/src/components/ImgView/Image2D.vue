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
        <div v-if="localTrial" class="camera-zoom" role="group" aria-label="相机图像缩放" @dblclick.stop>
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
    import { onMounted, ref, shallowRef, onBeforeUnmount } from 'vue';
    import * as THREE from 'three';
    import { Image2DRenderView, PointsMaterial, Rect } from 'pc-render';
    import { useInjectState, useInjectEditor } from '../../state';
    import * as locale from './lang';

    import useUI from '../../hook/useUI';
    import useContextMenu from '../../hook/useContextMenu';
    import { FullscreenOutlined, EyeOutlined, MinusOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue';
    import useInjectProxy from './useProxy';
    import { localTrial } from '../../common/localTrial';
    import { attachTrialProjection } from './trialProjection';
    import { attachTrialCameraZoom, maxCameraZoom } from './trialCameraZoom';

    // ***************Props and Emits***************
    interface ImgViewProps {
        imgIndex: number;
        thumbnail?: () => HTMLImageElement | undefined;
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
                attachTrialProjection(view, props.thumbnail);
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
