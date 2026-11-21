<template>
    <div class="layout-main-container" :style="localTrial ? trialDimensions : undefined" :class="{ 'has-sides': state.config.showSideView,
        'trial-camera-layout': localTrial, 'camera-open': localTrial && state.config.showImgView && !state.config.showSingleImgView }">
        <div
            v-show="!state.config.showSingleImgView && (localTrial || editor.state.imgViews.length > 0)"
            :style="{
                width: imgViewWidth,
                right: 0,
            }"
            class="img-view-container"
        >
            <div v-show="state.config.showImgView" style="width: 100%; height: 100%">
                <slot name="img-view"></slot>
            </div>
            <div ref="handleImg" class="handle-line-img"></div>
            <div @click="toggleImgView" class="visible-handle img">
                <LeftOutlined v-if="state.config.showImgView" />
                <RightOutlined v-else />
            </div>
        </div>
        <div
            ref="mainPane" class="main-view-container"
            :style="{ left: imgViewWidth, right: sideViewWidth }"
        >
            <div style="position: relative; width: 100%; height: 100%">
                <slot name="main-view"></slot>
            </div>
        </div>
        <div
            ref="sidePane" class="side-view-container"
            :style="{
                width: sideViewWidth,
                right: 0,
            }"
        >
            <div v-show="state.config.showSideView" style="width: 100%; height: 100%">
                <slot name="side-view"></slot>
            </div>
            <div ref="handleSide" class="handle-line-side"></div>
            <div @click="toggleSideView" class="visible-handle side">
                <RightOutlined v-if="state.config.showSideView" />
                <LeftOutlined v-else />
            </div>
            <!-- <slot name="side-view"></slot> -->
        </div>
        <div v-if="localTrial" id="trial-review-dock" class="trial-review-dock"></div>
        <div v-if="localTrial && state.config.showSideView" class="trial-rail-divider" role="separator"
            tabindex="0" aria-label="调整审核与三视图高度" aria-orientation="horizontal" :aria-valuenow="reviewPercent"
            :aria-valuemin="15" :aria-valuemax="75" @pointerdown="captureDivider" @pointermove="moveDivider"
            @keydown.up.prevent="setReviewPercent(reviewPercent - 5)" @keydown.down.prevent="setReviewPercent(reviewPercent + 5)"></div>
        <Modal />
    </div>
</template>

<script setup lang="ts">
    // import { PointCloud } from '../lib';
    import { reactive, computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
    import { useInjectState } from '../../state';
    import { useInjectEditor } from '../../state';
    import { LeftOutlined, RightOutlined } from '@ant-design/icons-vue';
    import interact from 'interactjs';
    import { RenderView, SideRenderView, Image2DRenderView, MainRenderView } from 'pc-render';
    import * as _ from 'lodash';
    import Modal from '../Modal/index.vue';
    import { localTrial } from '../../common/localTrial';

    let state = useInjectState();
    let editor = useInjectEditor();
    // let toolWidth = 50;
    let info = reactive({
        imgViewWidth: 230,
        sideViewWidth: 0,
        showBottomView: true,
        // operationWidth: 270,
    });
    //** useless now */
    function toggleSideView() {
        state.config.showSideView = !state.config.showSideView;
    }
    function toggleImgView() {
        state.config.showImgView = !state.config.showImgView;
        if (info.imgViewWidth < 100) {
            info.imgViewWidth = 230;
        }
    }

    onMounted(() => {
        initResize();
        if (localTrial && mainPane.value && sidePane.value) {
            paneObserver = new ResizeObserver(() => editor.pc.render());
            paneObserver.observe(mainPane.value);
            paneObserver.observe(sidePane.value);
        }
    });
    onBeforeUnmount(() => paneObserver?.disconnect());

    watch(
        () => [
            state.config.showImgView,
            state.config.showOperationView,
            state.config.showSideView,
            state.config.showSingleImgView,
        ],
        () => {
            nextTick(() => {
                render();
            });
        },
    );
    const handleSide = ref<HTMLElement | null>(null);
    const handleImg = ref<HTMLElement | null>(null);
    const trialCameraWidth = ref<number>();
    const mainPane = ref<HTMLElement | null>(null), sidePane = ref<HTMLElement | null>(null);
    let paneObserver: ResizeObserver | undefined;
    const reviewPercent = ref(39);
    const trialDimensions = computed(() => ({
        '--trial-rail-width': `clamp(260px, ${info.sideViewWidth ? `${info.sideViewWidth}px` : '22%'}, 34%)`,
        '--trial-review-height': `${reviewPercent.value}%`,
    }));
    function setReviewPercent(value: number) { reviewPercent.value = Math.round(Math.max(15, Math.min(75, value))); }
    function captureDivider(event: PointerEvent) {
        if (event.button === 0) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    function moveDivider(event: PointerEvent) {
        const divider = event.currentTarget as HTMLElement;
        if (!divider.hasPointerCapture(event.pointerId)) return;
        const bounds = divider.parentElement!.getBoundingClientRect();
        setReviewPercent(100 * (event.clientY - bounds.top) / bounds.height);
    }
    // let imgViewRight = toolWidth + info.imgViewWidth;
    // let operationRight = 0;
    const sideViewWidth = computed(() => !state.config.showSideView ? '0px'
        : localTrial ? `min(${info.sideViewWidth ? `${info.sideViewWidth}px` : '27%'}, 30%)`
        : info.sideViewWidth ? `min(${info.sideViewWidth}px, 55%)` : 'min(34%, 680px)');
    const imgViewWidth = computed(() => {
        if (!state.config.showImgView || state.config.showSingleImgView) return '0px';
        if (localTrial) return trialCameraWidth.value
            ? `min(${trialCameraWidth.value}px, var(--camera-limit))` : 'var(--camera-default)';
        return editor.state.imgViews.length ? `min(${info.imgViewWidth}px, 22%)` : '0px';
    });

    const render = _.throttle(() => {
        if (localTrial) { editor.pc.render(); return; }
        editor.pc.renderViews.forEach((view: RenderView) => {
            if (view instanceof SideRenderView) {
                view.updateSize();
                view.fitObject();
            }
        });
        editor.pc.render();
    }, 30);
    function addEventListenerResize(dom: HTMLElement, side: 1 | -1, callBack: Function) {
        let start = 0;
        let offsetX = 0;
        let width = 0;
        let onMouseDown = (event: MouseEvent) => {
            let parent = dom.parentElement;
            width = parent?.clientWidth || 0;
            document.body.style.cursor = 'ew-resize';
            dom.classList.add('active');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            start = event.screenX;
        };
        let onMouseMove = (event: MouseEvent) => {
            offsetX = start - event.screenX;
            start = event.screenX;
            width += side * offsetX;
            callBack && callBack({ offsetX, width });
        };
        let onMouseUp = () => {
            document.body.style.cursor = '';
            dom.classList.remove('active');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        dom.addEventListener('mousedown', onMouseDown);
        return () => {
            dom.removeEventListener('mousedown', onMouseDown);
        };
    }
    function initResize() {
        if (handleSide.value) {
            addEventListenerResize(handleSide.value, 1, (data: any) => {
                let width = data.width;
                info.sideViewWidth = width < 100 ? 0 : width;
                state.config.showSideView = info.sideViewWidth >= 100;
                render();
            });
        }
        if (handleImg.value) {
            addEventListenerResize(handleImg.value, -1, (data: any) => {
                let width = data.width;
                if (localTrial) {
                    trialCameraWidth.value = width < 100 ? undefined : width;
                    state.config.showImgView = width >= 100;
                    render();
                    return;
                }
                info.imgViewWidth = width > 500 ? 500 : width < 100 ? 0 : width;
                state.config.showImgView = info.imgViewWidth > 100;
                render();
            });
        }
    }
</script>

<style lang="less">
    .layout-main-container {
        width: 100%;
        height: 100%;
        position: relative;
        user-select: none;
        padding: 6px 0px;

        &.trial-camera-layout {
            --camera-default: min(36%, 640px);
            --camera-limit: 40%;
            .trial-review-dock, .trial-rail-divider { display: none; }
            @media (min-width: 851px) {
                --camera-default: min(38%, 800px);
                --camera-limit: 52%;
                .main-view-container { right: var(--trial-rail-width) !important; }
                .trial-review-dock { display: block; position: absolute; inset: 0 0 0 auto; width: var(--trial-rail-width); }
                &.has-sides .trial-review-dock { height: var(--trial-review-height); }
                .trial-rail-divider { display: block; position: absolute; right: 0; top: var(--trial-review-height); width: var(--trial-rail-width); height: 8px; background: #37393e; cursor: ns-resize; touch-action: none; }
                .trial-rail-divider::after { content: ''; position: absolute; inset: 3px 40%; background: #8c929a; }
                .trial-rail-divider:focus-visible { outline: 2px solid #82bfff; outline-offset: -2px; }
                &.has-sides .side-view-container:not(:has(.expanded-side)) { top: calc(var(--trial-review-height) + 8px); width: var(--trial-rail-width) !important; }
                &:not(.has-sides) .side-view-container { right: var(--trial-rail-width) !important; top: 50%; bottom: auto; }
                .side-view-container:has(.expanded-side) { right: var(--trial-rail-width) !important; }
                &:has(.expanded-side) {
                    .trial-review-dock { height: 100%; }
                    .trial-rail-divider { display: none; }
                }
            }
            @media (max-width: 850px) {
                --camera-height: 0px;
                &.camera-open { --camera-height: min(38%, calc(56.25vw + 10px)); }
                .img-view-container { width: 100% !important; height: var(--camera-height); bottom: auto; border: 0; }
                .main-view-container { top: var(--camera-height); left: 0 !important; }
                &.has-sides .main-view-container { bottom: 28%; }
                &.has-sides .side-view-container:not(:has(.expanded-side)) { height: 28%; }
                .handle-line-img { display: none; }
                .visible-handle.img { top: 100%; right: 6px; transform: none; padding: 0; width: 26px; line-height: 18px; border-radius: 0 0 4px 4px; }
                .visible-handle.img .anticon { transform: rotate(90deg); }
            }
        }

        .img-view-container {
            position: absolute;
            top: 0px;
            left: 0px;
            width: 230px;
            bottom: 0px;
            z-index: 1;
            // padding-right: 3px;
            border-right: 3px solid transparent;
        }

        .side-view-container {
            position: absolute;
            top: 0px;
            right: 0px;
            width: 220px;
            bottom: 0px;
            // padding-left: 3px;
            border-left: 3px solid transparent;
        }

        .check-view-container {
            position: absolute;
            top: 0px;
            right: 220px;
            left: 0px;
            bottom: 0px;
            z-index: 100;
        }

        @media (max-width: 850px) {
            &.has-sides .main-view-container, &.has-sides .img-view-container { bottom: 40%; }
            .main-view-container { right: 0 !important; }
            .side-view-container {
                top: auto;
                width: 100% !important;
                height: 0;
                border: none;
                z-index: 1;
            }
            &.has-sides .side-view-container { height: 40%; }
            .handle-line-side { display: none; }
            .side-view-container .visible-handle.side {
                top: 0;
                left: 50%;
                transform: translate(-50%, -100%) rotate(90deg);
                transform-origin: center;
                padding: 0;
            }
        }

        .side-view-container:has(.expanded-side) {
            inset: 0;
            width: auto !important;
            height: auto;
            z-index: 2;
            .visible-handle, .handle-line-side { display: none; }
        }
        &.has-sides .side-view-container:has(.expanded-side) { height: auto; }

        .main-view-container {
            position: absolute;
            top: 0px;
            right: 220px;
            left: 230px;
            bottom: 0px;
            background-color: black;
        }

        .handle-line-img {
            width: 3px;
            height: 100%;
            position: absolute;
            right: -3px;
            top: 0;
            background-color: transparent;

            &.active {
                background-color: #2e8cf0;
            }

            &:hover {
                cursor: ew-resize;
                background-color: #2e8cf0;
            }
        }

        .handle-line-side {
            width: 3px;
            height: 100%;
            position: absolute;
            background-color: transparent;
            left: -3px;
            top: 0;

            &.active {
                background-color: #2e8cf0;
            }

            &:hover {
                cursor: ew-resize;
                background-color: #2e8cf0;
            }
        }

        .visible-handle {
            position: absolute;
            background: #3a393e;
            padding: 10px 0;
            text-align: center;
            width: 18px;
            z-index: 1;
            cursor: auto;
            line-height: 24px;
            color: #aaaaaa;

            &:hover {
                background: #2b2a2e;
            }

            &.img {
                right: 0;
                top: 50%;
                transform: translate(100%, -50%);
                border-bottom-right-radius: 10px;
                border-top-right-radius: 10px;
            }

            &.bottom {
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                border-top-left-radius: 10px;
                border-top-right-radius: 10px;
            }

            &.side {
                left: 0;
                top: 50%;
                transform: translate(-100%, -50%);
                border-bottom-left-radius: 10px;
                border-top-left-radius: 10px;
            }
        }
    }
</style>
