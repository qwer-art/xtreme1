<template>
    <div class="main-view">
        <div ref="dom" style="height: 100%; width: 100%; position: relative"></div>
        <Labels :data="state.labels" v-show="editor.state.config.showLabel" />
        <Labels :data="state.lineLabels" />
        <!-- <Annotation :data="state.annotations" v-show="editor.state.config.showAnnotation" /> -->
        <slot name="info" v-if="$slots.info"></slot>
        <Info v-else />
        <Image2DMax />
        <slot name="editClass" v-if="$slots.editClass"></slot>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, onBeforeUnmount, ref, reactive, computed } from 'vue';
    import { MainRenderView, Event } from 'pc-render';
    import { useInjectEditor } from '../../state';
    import * as _ from 'lodash';
    import * as THREE from 'three';

    import Labels from './Labels.vue';
    import Annotation from './Annotation.vue';
    import Info from './Info.vue';
    import Image2DMax from '../ImgView/Image2DMax.vue';

    import { IUserData, IClassType, Event as EditorEvent } from 'pc-editor';
    import { localTrial } from '../../common/localTrial';
    import { currentFrameMetadata } from '../../common/trialAnnotations';
    import type { TrialBox } from '../../common/trialAnnotationStore';

    interface ILabel {
        name: string;
        box?: TrialBox;
        color?: string;
        x: number;
        y: number;
        scale: number;
    }

    let dom = ref<HTMLDivElement | null>(null);
    let editor = useInjectEditor();
    let pc = editor.pc;
    let metadata = new Map<string, TrialBox>();
    const refreshMetadata = () => {
        if (localTrial) {
            metadata = new Map(currentFrameMetadata(editor).map(box => [box.bbox_id, box]));
            if (view.camera) updateLabel();
        }
    };
    let view = {} as MainRenderView;
    let state = reactive({
        labels: [] as ILabel[],
        lineLabels: [] as ILabel[],
        annotations: [] as any[],
    });

    let classTypeMap = computed(() => {
        let map = {} as Record<string, IClassType>;
        editor.state.classTypes.forEach((e) => {
            map[e.name] = e;
        });
        return map;
    });

    // let updateAnnotation = () => {
    //     if (!editor.state.config.showAnnotation) return;
    //     let data = editor.state.annotationInfos;
    //     let camera = view.camera;
    //     let matrix = new THREE.Matrix4();
    //     matrix.copy(camera.projectionMatrix);
    //     matrix.multiply(camera.matrixWorldInverse);

    //     let object3d = editor.pc.getAnnotate3D();
    //     let idMap: Record<string, THREE.Object3D> = {};
    //     object3d.forEach((obj) => {
    //         idMap[obj.uuid] = obj;
    //     });

    //     let annotations = [] as any[];
    //     let pos = new THREE.Vector3();
    //     data.forEach((e) => {
    //         if (e.position) {
    //             pos.copy(e.position);
    //         } else if (e.objectId) {
    //             let obj = idMap[e.objectId];
    //             if (!obj) return;
    //             pos.copy(obj.position);
    //         }

    //         pos.applyMatrix4(matrix);

    //         pos.x = ((pos.x + 1) / 2) * view.width;
    //         pos.y = (-(pos.y - 1) / 2) * view.height;

    //         let obj = {
    //             name: e.msg,
    //             x: pos.x,
    //             y: pos.y,
    //             scale: 1,
    //         };
    //         annotations.push(obj);
    //     });

    //     state.annotations = annotations;
    // };

    let updateLabel = () => {
        // if (!editor.state.config.showLabel) return;
        let measureLineObjects = editor.pc.groupTrack;
        let camera = view.camera;
        let matrix = new THREE.Matrix4();
        matrix.copy(camera.projectionMatrix);
        matrix.multiply(camera.matrixWorldInverse);

        let objects = pc.getAnnotate3D();

        let list: ILabel[] = [];
        let list1: ILabel[] = [];
        let pos = new THREE.Vector3();
        let pos1 = new THREE.Vector3();

        if (measureLineObjects.visible) {
            measureLineObjects.children.forEach((e) => {
                if (!e.visible) return;
                const size = e.scale.x;
                pos.set(0, 0, 0);
                pos.applyMatrix4(e.matrixWorld);
                pos.x += size;
                pos.applyMatrix4(matrix);
                pos.x = ((pos.x + 1) / 2) * view.width;
                pos.y = (-(pos.y - 1) / 2) * view.height;
                if (Math.abs(pos.z) > 1) return;
                let obj = {
                    name: size + 'm',
                    x: pos.x,
                    y: pos.y - 6,
                    scale: 1,
                };
                list1.push(obj);
            });
        }

        if (editor.state.config.showLabel) {
            objects.forEach((e) => {
                if (!e.visible) return;
                let userData = e.userData as IUserData;
                let classType = userData.classType || '';
                let classConfig = editor.getClassType(userData);
                let className = classConfig
                    ? classConfig.label || classConfig.name || ''
                    : classType;

                pos.set(0, 0, 0);
                pos.applyMatrix4(e.matrixWorld);
                pos.applyMatrix4(matrix);
                pos.x = ((pos.x + 1) / 2) * view.width;
                pos.y = (-(pos.y - 1) / 2) * view.height;
                // pos.z = 0;

                if (Math.abs(pos.z) > 1) return;

                // let subId = (userData.id + '').slice(-4);
                let trackName = userData.trackName || '';
                let obj = {
                    name: classType ? `${className}-${trackName}` : `${trackName}`,
                    box: localTrial ? metadata.get(e.uuid) : undefined,
                    color: classConfig?.color,
                    x: localTrial ? Math.max(4, Math.min(view.width - 180, pos.x + 12)) : pos.x,
                    y: localTrial ? Math.max(4, Math.min(view.height - 98, pos.y - 98)) : pos.y,
                    scale: 1,
                };
                list.push(obj);
            });
        }
        if (localTrial) {
            const selectedIds = new Set(pc.selection.map(object => object.uuid));
            const placed: ILabel[] = [];
            list.sort((left, right) => Number(selectedIds.has(right.box?.bbox_id || '')) - Number(selectedIds.has(left.box?.bbox_id || '')));
            for (const label of list) {
                if (!label.box) { placed.push(label); continue; }
                const width = 176, height = 98, gap = 6;
                let position: { x: number; y: number } | undefined;
                const columns = [label.x, Math.max(4, label.x - width - gap)];
                for (let step = 0; step <= Math.ceil(view.height / (height + gap)) && !position; step++) {
                    for (const direction of step ? [1, -1] : [1]) for (const column of columns) {
                        const row = label.y + direction * step * (height + gap);
                        if (column < 4 || column + width > view.width - 4 || row < 4 || row + height > view.height - 4) continue;
                        if (placed.some(other => other.box && column < other.x + width + gap && column + width + gap > other.x &&
                            row < other.y + height + gap && row + height + gap > other.y)) continue;
                        position = { x: column, y: row };
                        break;
                    }
                }
                if (position) placed.push({ ...label, ...position });
            }
            list = placed;
        }
        state.labels = list;
        state.lineLabels = list1;
    };

    function update() {
        updateLabel();
        // updateAnnotation();
    }

    onMounted(() => {
        if (dom.value) {
            view = new MainRenderView(dom.value, pc, { name: 'main-view' });
            pc.addRenderView(view);
        }
        view.addEventListener(Event.RENDER_AFTER, update);
        if (localTrial) {
            editor.addEventListener(EditorEvent.ANNOTATE_CHANGE, refreshMetadata);
            editor.addEventListener(EditorEvent.ANNOTATE_SELECT, refreshMetadata);
            editor.addEventListener(EditorEvent.ANNOTATE_TRANSFORM_CHANGE, refreshMetadata);
            editor.addEventListener(EditorEvent.FRAME_CHANGE, refreshMetadata);
            refreshMetadata();
        }
    });
    onBeforeUnmount(() => {
        view.removeEventListener(Event.RENDER_AFTER, update);
        editor.removeEventListener(EditorEvent.ANNOTATE_CHANGE, refreshMetadata);
        editor.removeEventListener(EditorEvent.ANNOTATE_SELECT, refreshMetadata);
        editor.removeEventListener(EditorEvent.ANNOTATE_TRANSFORM_CHANGE, refreshMetadata);
        editor.removeEventListener(EditorEvent.FRAME_CHANGE, refreshMetadata);
    });
</script>

<style lang="less">
    .main-view {
        height: 100%;
        position: relative;
        overflow: hidden;
    }

    .main-view-tool {
        position: absolute;
        right: 6px;
        top: 6px;
        width: 32px;
        background: #333333;
        border-radius: 4px;
        z-index: 1;

        .item {
            display: inline-block;
            width: 32px;
            height: 32px;
            font-size: 18px;
            padding: 6px;
            border-radius: 4px;
            background: #333333;
            color: white;
            cursor: pointer;

            &:hover,
            &.active {
                background: #ffffff4d;
            }
        }
    }
</style>
