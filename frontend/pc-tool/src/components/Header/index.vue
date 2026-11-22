<template>
    <div class="pc-flow" :style="toolbarStyle">
        <div class="item-wrap">
            <span :class="blocking ? 'close disable' : 'close'" :title="$$('btn-close')" @click="blocking ? null : onClose()"
                ><CloseOutlined /><span class="close-label" style="margin-left: 4px">{{ $$('btn-close') }}</span></span
            >
            <div class="task-header-info">
                <span :title="iState.dataName || ''" class="task-header-name">{{
                    iState.dataName || ''
                }}</span>
                <i class="iconfont icon-a-Jobinformation task-header-icon"></i>
            </div>
            <label v-if="localTrial" class="trial-font-size">字号
                <select v-model.number="toolbarSize" aria-label="工具栏字号">
                    <option v-for="size in toolbarSizes" :key="size" :value="size">{{ size }} px</option>
                </select>
            </label>
        </div>
        <div class="item-wrap data-index" v-if="!localTrial && !state.isSeriesFrame && state.frames.length > 0">
            <LeftOutlined
                :class="state.frameIndex > 0 && !blocking ? 'icon' : 'icon disable'"
                @click="state.frameIndex > 0 && !blocking ? onPre() : null"
            />
            <a-input-number
                :disabled="blocking"
                v-model:value="dataIndex"
                size="small"
                :min="1"
                :step="1"
                @change="onIndexChange"
                @blur="onIndexBlur"
                :max="state.frames.length"
                style="width: 50px; text-align: center; font-size: 18px"
            />
            <span class="text">
                <span style="margin-right: 4px">/</span>{{ state.frames.length }}
            </span>
            <RightOutlined
                :class="
                    state.frameIndex < state.frames.length - 1 && !blocking
                        ? 'icon'
                        : 'icon disable'
                "
                @click="state.frameIndex < state.frames.length - 1 && !blocking ? onNext() : null"
            />
        </div>
        <div class="item-wrap">
            <!-- Save -->
            <a-button
                class="basic-btn"
                v-if="has(BsUIType.flowSave)"
                :title="$$('btn-save')" :aria-label="$$('btn-save')"
                :disabled="blocking"
                size="large"
                :loading="bsState.saving"
                @click="onSave"
            >
                <template #icon><SaveOutlined /></template>
                <div class="title">{{ $$('btn-save') }}</div>
            </a-button>
            <!-- shortcut -->
            <a-button class="basic-btn" size="large" :disabled="blocking"
                :title="localTrial ? '快捷键' : $$('btn-shortcut')" :aria-label="localTrial ? '快捷键' : $$('btn-shortcut')"
                :aria-expanded="localTrial ? shortcutsOpen : undefined"
                :aria-controls="localTrial ? 'trial-shortcuts' : undefined"
                @click="localTrial ? shortcutsOpen = !shortcutsOpen : onHelp()">
                <template #icon
                    ><i style="font-size: 16px" class="iconfont icon-help"></i
                ></template>
                <div class="title">{{ localTrial ? '快捷键' : $$('btn-shortcut') }}</div>
            </a-button>
            <!-- full screen -->
            <a-button class="basic-btn" size="large" :title="iState.fullScreen ? $$('btn-full-exit') : $$('btn-full')" :aria-label="iState.fullScreen ? $$('btn-full-exit') : $$('btn-full')" @click="onFullScreen">
                <template #icon>
                    <i
                        style="font-size: 16px"
                        class="iconfont"
                        :class="[iState.fullScreen ? 'icon-tuichuquanping' : 'icon-a-Fullscreen']"
                    ></i
                ></template>
                <div class="title">{{
                    iState.fullScreen ? $$('btn-full-exit') : $$('btn-full')
                }}</div>
            </a-button>
            <button v-if="localTrial" type="button" class="trial-rail-toggle" title="审核栏" aria-label="审核栏" data-testid="trial-rail-toggle" :aria-expanded="railOpen" @click="$emit('toggle-rail')"><UnorderedListOutlined /></button>
            <a-divider v-else type="vertical" style="height: 32px; background-color: #57575c" />
            <template v-if="!localTrial && editor.state.frameIndex >= 0">
                <a-button
                    class="basic modify"
                    :disabled="blocking"
                    :loading="bsState.modifying"
                    v-show="!canEdit()"
                    @click="onModify"
                >
                    {{ $$('btn-modify') }}
                </a-button>
                <a-button
                    :class="
                        currentFrame.dataStatus === 'VALID'
                            ? 'basic mark-invalid'
                            : 'basic mark-valid'
                    "
                    v-show="canEdit()"
                    :disabled="blocking"
                    :loading="bsState.validing"
                    @click="onToggleValid"
                >
                    {{ currentFrame.dataStatus === 'VALID' ? $$('btn-invalid') : $$('btn-valid') }}
                </a-button>
                <a-button
                    class="basic skip"
                    v-show="canEdit() && !state.isSeriesFrame"
                    @click="onToggleSkip"
                    :disabled="blocking"
                >
                    {{ $$('btn-skip') }}
                </a-button>
                <a-button
                    class="basic submit"
                    v-show="canEdit()"
                    :loading="bsState.submitting"
                    :disabled="blocking"
                    @click="onSubmit"
                >
                    <template #icon><SaveOutlined /></template>
                    {{
                        currentFrame.annotationStatus === 'ANNOTATED'
                            ? $$('btn-update')
                            : $$('btn-submit')
                    }}
                </a-button>
            </template>
        </div>
    </div>
    <section v-if="localTrial" class="trial-controls" :style="toolbarStyle" aria-label="标注工具栏">
        <TrialWorkspace :blocking="blocking" />
        <div class="trial-model-bar">
            <div class="trial-workflow-group" role="group" aria-label="整帧预标注">
                <strong class="trial-group-label">整帧预标注</strong>
                <div id="trial-prelabel-controls" class="trial-methods"></div>
            </div>
            <div class="trial-workflow-divider" aria-hidden="true"></div>
            <div class="trial-workflow-group" role="group" aria-label="单目标辅助">
                <strong class="trial-group-label">单目标辅助</strong>
                <div id="trial-assist-controls" class="trial-methods"></div>
            </div>
        </div>
        <div id="trial-point-sam-controls" class="trial-point-sam-row" aria-label="Point-SAM 点选工具"></div>
        <div v-show="shortcutsOpen" id="trial-shortcuts" class="trial-shortcuts">
            <strong>常用快捷键</strong>
            <span><kbd>P</kbd>Point-SAM 开/关</span>
            <span><kbd>Q</kbd>前景点</span><span><kbd>E</kbd>背景点</span>
            <span><kbd>F</kbd>{{ state.config.boxMethod === 'AI' ? '拖框拟合' : '三点建框' }}</span>
            <span><kbd>A/D</kbd><kbd>Q/E</kbd><kbd>W/S</kbd>移框（Point-SAM 关闭时）</span>
            <span><kbd>Z/X</kbd>转向</span><span><kbd>Del</kbd>删除</span>
            <span><kbd>Ctrl+Z</kbd>撤销</span><span><kbd>Ctrl+S</kbd>保存</span>
            <button type="button" @click="onHelp">完整快捷键表</button>
        </div>
    </section>
</template>

<script setup lang="ts">
    // import { PointCloud } from '../lib';
    import { computed, onMounted, ref, watch } from 'vue';
    import {
        RightOutlined,
        LeftOutlined,
        UnorderedListOutlined,
        SaveOutlined,
        CloseOutlined,
    } from '@ant-design/icons-vue';
    import { useInjectEditor } from '../../state';
    import useHeader from './useHeader';
    import TrialWorkspace from './TrialWorkspace.vue';
    import useFlow from '../../hook/useFlow';
    import { localTrial } from '../../common/localTrial';
    import useUI from '../../hook/useUI';
    import * as _ from 'lodash';
    import { BsUIType } from '../../config/ui';

    let {
        $$,
        onFullScreen,
        iState,
        blocking,
        currentFrame,
        dataIndex,
        onIndexChange,
        onHelp,
        onIndexBlur,
        onSave,
        onPre,
        onNext,
        onClose,
        onToggleValid,
        onToggleSkip,
        onSubmit,
        onModify,
    } = useHeader();
    let { has, canEdit } = useUI();
    let { init } = useFlow();
    let editor = useInjectEditor();
    let { state, bsState } = editor;
    defineProps<{ railOpen: boolean }>();
    defineEmits<{ (event: 'toggle-rail'): void }>();

    const toolbarSizes = [18, 24, 30, 36];
    const shortcutsOpen = ref(false);
    const sizeKey = 'xtreme1:local-trial:toolbar-font';
    const storedSize = localTrial ? Number(localStorage.getItem(sizeKey)) : 0;
    const toolbarSize = ref(toolbarSizes.includes(storedSize) ? storedSize : 24);
    const toolbarStyle = computed(() => localTrial ? {
        '--trial-ui-font': `${toolbarSize.value}px`,
        '--trial-secondary-font': `${Math.round(toolbarSize.value * 0.875)}px`,
    } : undefined);
    watch(toolbarSize, size => localStorage.setItem(sizeKey, String(size)));

    onMounted(() => {
        init();
    });
</script>

<style lang="less">
    .trial-layout { --trial-ui-font: 18px; --trial-secondary-font: 16px; }
    .trial-layout .pc-flow { min-height: 44px; height: auto; align-items: center; }
    .trial-layout .pc-flow .close, .trial-layout .pc-flow .item-wrap .basic-btn .title, .trial-layout .pc-flow .task-header-name { font-size: var(--trial-secondary-font); line-height: 1.3; }
    .trial-layout .pc-flow .task-header-info, .trial-layout .pc-flow .basic-btn { height: auto; }
    .trial-rail-toggle { display: none; }
    @media (max-width: 680px) {
        .trial-layout .pc-flow .trial-rail-toggle { display: inline-grid; place-items: center; height: 32px; min-width: 32px; background: transparent; color: #dce0e8; border: 0; cursor: pointer; }
        .trial-layout .pc-flow .trial-rail-toggle[aria-expanded=true] { color: #95ceff; background: #31485b; }
        .trial-layout .pc-flow .close-label, .trial-layout .pc-flow .basic-btn .title { display: none; }
        .trial-layout .pc-flow .basic-btn { min-width: 32px; }
    }
    .trial-font-size { display: inline-flex; align-items: center; gap: 5px; margin: 0 8px; font-size: var(--trial-secondary-font); color: #f0f2f6; white-space: nowrap; }
    .trial-font-size select { font: inherit; background: #34363d; color: inherit; border: 1px solid #737985; border-radius: 3px; }
    .trial-controls {
        background: #26282e;
        color: #f0f2f6;
        padding: 5px 10px;
        display: grid;
        gap: 4px;
        font-family: "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
        font-size: var(--trial-ui-font);
        line-height: 1.4;
        .trial-model-bar, .trial-shortcuts, .trial-methods, .trial-workflow-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
        .trial-model-bar { border-top: 1px solid #44474e; padding-top: 5px; gap: 5px 16px; }
        .trial-workflow-group { min-width: 0; }
        .trial-group-label { color: #aeb8c4; font-size: var(--trial-secondary-font); white-space: nowrap; }
        .trial-workflow-divider { align-self: stretch; width: 1px; min-height: 28px; background: #585b64; }
        .trial-point-sam-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 5px 8px; border-inline-start: 3px solid #67b9d1; background: #202c32; }
        .trial-point-sam-row:empty { display: none; }
        .trial-methods kbd { font: 600 .85em/1.3 monospace; border: 1px solid #858b96; border-radius: 2px; padding: 0 4px; }
        #trial-prelabel-controls output { font-size: var(--trial-secondary-font); }
        .trial-shortcuts { color: #dce0e8; font-size: var(--trial-secondary-font); }
        strong { font-weight: 600; }
        .trial-shortcuts span { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
        kbd { font: 600 1em/1.4 monospace; border: 1px solid #777e8a; padding: 0 4px; border-radius: 3px; }
        @media (max-width: 680px) {
            .trial-model-bar { align-items: flex-start; }
            .trial-workflow-divider { display: none; }
            .trial-workflow-group { flex-basis: 100%; }
            max-height: 36vh;
            overflow-y: auto;
        }
    }
    .pc-flow {
        height: 100%;
        display: flex;
        justify-content: space-between;
        @media (max-width: 520px) {
            .trial-layout & {
                .data-index, .ant-divider { display: none; }
                overflow-x: auto;
                .item-wrap { flex: none; }
                .item-wrap:first-child { flex: 1 1 0; min-width: 0; }
                .trial-font-size, .close { flex-shrink: 0; }
                .close { white-space: nowrap; }
                .task-header-info { min-width: 0; overflow: hidden; margin-left: 4px; padding: 2px 6px; }
                .task-header-name { max-width: 80px; padding-right: 0; border: 0; }
                .task-header-icon { display: none; }
                .item-wrap .basic-btn { padding: 0 4px; }
            }
        }
        .task-header-info {
            border-radius: 16px;
            height: 28px;
            padding: 2px 15px;
            background: rgba(58, 58, 62, 0.39);
            border: 1px solid rgba(58, 58, 62, 0.39);
            display: flex;
            align-items: center;
            margin-left: 12px;

            .task-header-name {
                font-size: 14px;
                line-height: 18px;
                color: #bec1ca;
                padding-right: 12px;
                border-right: 1px solid #57575c;
                max-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .task-header-icon {
                margin-left: 10px;
                cursor: pointer;
            }
        }
        .item-wrap {
            // min-width: 100px;
            display: flex;
            align-items: center;
            .basic-btn {
                padding: 0 8px;
                border: none;
                .anticon {
                    font-size: 16px;
                }
                .title {
                    font-size: 14px;
                    margin-top: -4px;
                }
                &.ant-btn:hover,
                &.ant-btn:focus {
                    color: white;
                    border-color: #434343;
                }
            }
            .header-info {
                background-color: #3a393e;
                border-radius: 16px;
                margin-left: 20px;
                padding: 5px 15px;
                color: #bec1ca;
                display: flex;
            }

            .icon {
                font-size: 20px;
                margin: 0px 4px;
                cursor: pointer;
            }

            .icon.disable {
                cursor: not-allowed;
                color: #5a5a5a;
            }

            .text {
                font-size: 18px;
                margin-left: 4px;
            }
        }

        .close {
            font-size: 20px;
            margin-left: 10px;
            cursor: pointer;

            &.disable {
                cursor: not-allowed;
                color: #5a5a5a;
            }
        }

        .data-index {
            .ant-input-number-handler-wrap {
                display: none;
            }
            .ant-input-number-sm input {
                text-align: center;
            }
        }

        .basic {
            // font-size: 18px;
            margin-right: 10px;
            // cursor: pointer;
            // padding: 4px;
            border-radius: 30px;
            // background: #3a393e;

            &.mark-invalid {
                background-color: #fcb17a;
            }
            &.mark-valid {
                background-color: #49aa19;
            }
            &.skip {
                background-color: #98b0d2;
            }
            &.skipped,
            &.modify {
                background-color: #ff6906;
            }
            &.submit {
                background-color: #60a9fe99;
                padding-left: 15px !important;
                .anticon {
                    background: #60a9fe;
                    height: 30px;
                    margin-top: -4px;
                    width: 32px;
                    margin-left: -16px;
                    border-radius: 16px;
                    padding-top: 5px;
                }
            }
            .anticon {
                font-size: 20px;
                vertical-align: middle;
            }

            &.ant-btn:hover,
            &.ant-btn:focus {
                color: white;
                border-color: #434343;
            }

            // &:hover {
            //     background: #3a393e;
            // }
        }

        .dataset-name {
            display: inline-block;
            max-width: 100px;
        }
    }
</style>
