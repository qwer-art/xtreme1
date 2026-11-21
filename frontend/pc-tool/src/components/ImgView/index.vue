<template>
    <div class="view-2d" :class="{ 'trial-cameras': localTrial }">
        <div class="view-2d-proxy" ref="proxy"> </div>
        <div class="view-2d-wrap" ref="wrap">
            <template v-if="localTrial">
                <div class="camera-stage" :data-camera="activeCamera.name">
                    <template v-for="slot in cameraSlots" :key="slot.name">
                        <Image2D v-if="slot.index >= 0" v-show="slot.name === activeCamera.name"
                            :key="state.imgViews[slot.index].imgUrl" :img-index="slot.index"
                            :thumbnail="() => thumbnails.get(slot.name)" />
                    </template>
                    <span class="camera-name">{{ activeCamera.name }}</span>
                    <div v-if="activeCamera.index < 0" class="camera-unavailable">本帧图像缺失</div>
                </div>
                <div class="camera-picker" role="group" aria-label="选择相机">
                    <button v-for="slot in cameraSlots" :key="slot.name" type="button"
                        :aria-pressed="slot.name === selectedCamera" :data-slot="slot.name"
                        :aria-label="slot.name + (slot.index < 0 ? ' 图像缺失' : '')"
                        :title="slot.name" @click="selectedCamera = slot.name">
                        <img v-if="slot.index >= 0" :key="state.imgViews[slot.index].imgUrl"
                            :ref="element => setThumbnail(slot.name, element)"
                            :src="state.imgViews[slot.index].imgObject.src" alt="" draggable="false" @load="renderProxy.render()" />
                        <span>{{ slot.label }}<small v-if="slot.index < 0">缺图</small></span>
                    </button>
                </div>
            </template>
            <template v-else><Image2D v-for="(item, index) in state.imgViews" :key="index" :img-index="index" /></template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
    import { Image2DRenderProxy } from 'pc-render';
    import Image2D from './Image2D.vue';
    import { useInjectEditor } from '../../state';
    import { useProvideProxy } from './useProxy';
    import { localTrial } from '../../common/localTrial';
    import { isTrialFrameImage } from './trialFrameImage';
    // ***************Props and Emits***************

    // *********************************************
    let proxy = ref<HTMLDivElement | null>(null);
    let wrap = ref<HTMLDivElement | null>(null);
    let editor = useInjectEditor();
    let state = editor.state;
    const cameras = [['CAM_FRONT_LEFT', '左前'], ['CAM_FRONT', '正前'], ['CAM_FRONT_RIGHT', '右前'],
        ['CAM_BACK_LEFT', '左后'], ['CAM_BACK', '正后'], ['CAM_BACK_RIGHT', '右后']];
    const selectedCamera = ref(cameras[0][0]);
    const thumbnails = new Map<string, HTMLImageElement>();
    function setThumbnail(name: string, element: unknown) {
        if (element instanceof HTMLImageElement) thumbnails.set(name, element);
        else thumbnails.delete(name);
    }
    const cameraSlots = computed(() => cameras.map(([name, label]) => ({ name, label,
        index: state.imgViews.findIndex(view => view.name === name && isTrialFrameImage(state.frames[state.frameIndex]?.id, view.imgUrl)),
    })));
    const activeCamera = computed(() => cameraSlots.value.find(slot => slot.name === selectedCamera.value)!);

    let renderProxy = new Image2DRenderProxy(editor.pc);
    // @ts-ignore
    window.renderProxy = renderProxy;
    useProvideProxy(renderProxy);
    if (localTrial) {
        watch(activeCamera, () => renderProxy.render(), { flush: 'post' });
        watch(() => state.config.showSingleImgView ? state.imgViews[state.config.singleImgViewIndex]?.name : '', name => {
            if (name) selectedCamera.value = name;
        });
    }
    let observer: ResizeObserver | undefined;

    // let containerHeight = computed(() => {
    //     return (
    //         Math.round(
    //             (state.config.view2DWidth / state.config.aspectRatio) * state.imgViews.length,
    //         ) + 2
    //     );
    // });
    onMounted(() => {
        if (proxy.value && wrap.value) {
            renderProxy.attach(proxy.value);
            if (localTrial) {
                observer = new ResizeObserver(() => renderProxy.render());
                observer.observe(proxy.value);
            }
            wrap.value.addEventListener('scroll', () => {
                renderProxy.render();
            });
        }
    });
    onBeforeUnmount(() => observer?.disconnect());
</script>

<style lang="less">
    .view-2d {
        position: relative;
        // overflow-y: auto;
        height: 100%;
        background: #1e1f23;

        .view-2d-proxy {
            height: 100%;
        }

        .view-2d-wrap {
            position: absolute;
            overflow-y: auto;
            inset: 0;
        }
        &.trial-cameras {
            isolation: isolate;
            .view-2d-proxy canvas:not(.render-2d-proxy) { z-index: 1; pointer-events: none; }
            .camera-name, .camera-picker span, .img-view .tool { z-index: 2; }
            .camera-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; }
            .camera-stage .img-view { height: 100%; }
            .camera-name { position: absolute; top: 6px; left: 6px; padding: 1px 5px; background: #202428db; color: white; font: 12px/20px monospace; pointer-events: none; }
            .camera-unavailable { display: grid; place-items: center; height: 100%; background: #292d31; color: #d4d8dc; }
            .camera-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 5px; background: #1e1f23; }
            .camera-picker button { position: relative; padding: 0; aspect-ratio: 16 / 9; overflow: hidden; border: 2px solid transparent; background: #303438; color: #fff; cursor: pointer; }
            .camera-picker button[aria-pressed='true'] { border-color: #69baff; }
            .camera-picker img { display: block; width: 100%; height: 100%; object-fit: contain; }
            .camera-picker span { position: absolute; left: 0; bottom: 0; padding: 0 6px; background: #202428db; font-size: 13px; }
            .camera-picker small { margin-left: 4px; color: #ffce89; }
            @media (min-width: 851px) {
                container: camera-rail / size;
                .camera-picker { align-content: start; padding: 3px 0; gap: 3px; }
                .camera-picker button { width: 100%; height: 100%; aspect-ratio: auto; }
            }
            @media (max-width: 850px) {
                .view-2d-wrap { display: flex; flex-direction: column; }
                .camera-stage { flex: 1; min-height: 0; aspect-ratio: auto; }
                .camera-picker { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; padding: 2px; }
                .camera-picker button { aspect-ratio: auto; height: 34px; line-height: 14px; }
                .camera-picker img { display: none; }
                .camera-picker span { position: static; padding: 0; background: transparent; }
                .camera-picker small { display: block; margin: 0; }
            }
        }
    }
</style>
