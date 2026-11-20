<template>
    <div class="pc-flow" :class="{ 'single-trial-frame': localTrial && state.frames.length === 1 }">
        <div class="item-wrap">
            <span :class="blocking ? 'close disable' : 'close'" @click="blocking ? null : onClose()"
                ><CloseOutlined /><span style="margin-left: 4px">{{ $$('btn-close') }}</span></span
            >
            <div class="task-header-info">
                <span :title="iState.dataName || ''" class="task-header-name">{{
                    iState.dataName || ''
                }}</span>
                <i class="iconfont icon-a-Jobinformation task-header-icon"></i>
            </div>
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
                :disabled="blocking"
                size="large"
                :loading="bsState.saving"
                @click="onSave"
            >
                <template #icon><SaveOutlined /></template>
                <div class="title">{{ $$('btn-save') }}</div>
            </a-button>
            <!-- shortcut -->
            <a-button class="basic-btn" size="large" :disabled="blocking" @click="onHelp">
                <template #icon
                    ><i style="font-size: 16px" class="iconfont icon-help"></i
                ></template>
                <div class="title">{{ $$('btn-shortcut') }}</div>
            </a-button>
            <!-- full screen -->
            <a-button class="basic-btn" size="large" @click="onFullScreen">
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
            <a-divider type="vertical" style="height: 32px; background-color: #57575c" />
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
    <section v-if="localTrial" class="trial-controls" aria-label="标注工具栏">
        <TrialWorkspace :blocking="blocking" />
        <TrialCandidates :blocking="blocking" />
        <div class="trial-shortcuts">
            <strong>常用快捷键</strong>
            <span><kbd>F</kbd>{{ state.config.boxMethod === 'AI' ? '拖框拟合' : '三点建框' }}</span>
            <span><kbd>A/D</kbd><kbd>Q/E</kbd><kbd>W/S</kbd>移框</span>
            <span><kbd>Z/X</kbd>转向</span><span><kbd>Del</kbd>删除</span>
            <span><kbd>Ctrl+Z</kbd>撤销</span><span><kbd>Ctrl+S</kbd>保存</span>
        </div>
        <div class="trial-methods" role="group" aria-label="辅助标注方式">
            <strong>辅助标注</strong>
            <button v-for="method in trialMethods" :key="method.id" type="button"
                :aria-pressed="state.config.boxMethod === method.id" :disabled="blocking || state.status === StatusType.Create"
                @click="state.config.boxMethod = method.id">{{ method.label }}</button>
            <span class="trial-status" role="status">{{ state.status === StatusType.Create ? '建框中' : '就绪' }}</span>
        </div>
    </section>
</template>

<script setup lang="ts">
    // import { PointCloud } from '../lib';
    import { computed, onMounted } from 'vue';
    import { StatusType } from 'pc-editor';
    import {
        RightOutlined,
        LeftOutlined,
        SaveOutlined,
        CloseOutlined,
    } from '@ant-design/icons-vue';
    import { useInjectEditor } from '../../state';
    import useHeader from './useHeader';
    import TrialWorkspace from './TrialWorkspace.vue';
    import TrialCandidates from './TrialCandidates.vue';
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
    const trialMethods = [{ id: 'STANDARD', label: '手工三点框' }, { id: 'AI', label: 'AI Box · 点云拟合' }] as const;

    onMounted(() => {
        init();
    });
</script>

<style lang="less">
    .trial-layout .pc-flow { height: 48px; }
    .trial-controls {
        background: #f4f6f7;
        color: #17252a;
        padding: 8px 14px;
        display: grid;
        gap: 7px;
        font-family: "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
        font-size: 18px;
        line-height: 1.4;
        .trial-shortcuts, .trial-methods { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 12px; }
        strong { min-width: 5em; font-weight: 700; }
        .trial-shortcuts span { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
        kbd { font: 600 16px/1.5 monospace; color: #17252a; background: white; border: 1px solid #9daeb5; border-bottom-width: 2px; padding: 0 5px; border-radius: 3px; }
        button { font: inherit; min-height: 36px; padding: 3px 12px; border: 1px solid #9caeb6; background: white; color: #20333a; border-radius: 4px; cursor: pointer; }
        button[aria-pressed='true'] { background: #cbefdf; color: #0c462e; border-color: #42806a; font-weight: 700; }
        button:focus-visible { outline: 2px solid #0066a1; outline-offset: 2px; }
        .trial-status { color: #40565e; }
        @media (max-width: 520px) { padding: 6px 8px; .trial-shortcuts, .trial-methods { gap: 4px 8px; } strong { min-width: auto; } }
    }
    .pc-flow {
        height: 100%;
        display: flex;
        justify-content: space-between;
        @media (max-width: 520px) {
            &.single-trial-frame {
                .data-index, .ant-divider { display: none; }
                .close { white-space: nowrap; }
                .task-header-info { margin-left: 4px; padding: 2px 6px; }
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
