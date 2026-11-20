<template>
    <div class="side-view">
        <div style="height: 100%" ref="dom" @dblclick="onDBLclick"></div>
        <div class="title1">{{ title }}
            <button type="button" class="reset-view" :title="$$('side_reset')"
                :aria-label="title + ': ' + $$('side_reset')" @click="onDBLclick">
                <AimOutlined />
            </button>
            <button type="button" class="reset-view" :title="expandLabel"
                :aria-label="title + ': ' + expandLabel" :aria-pressed="expanded" @click="emit('expand')">
                <FullscreenExitOutlined v-if="expanded" /><FullscreenOutlined v-else />
            </button>
        </div>
        <!-- <div class="title2" @click="changeAxis" v-if="axis !== 'z'">{{ title2 }}</div> -->
        <div class="info" v-show="size.length() > 0">
            <template v-if="props.axis === 'z'">
                <span style="margin-right: 4px">{{ $$('side_length') }}:{{ format(size.x) }}</span>
                <span>{{ $$('side_width') }}:{{ format(size.y) }}</span>
            </template>
            <template v-else-if="props.axis === 'y' || props.axis === '-y'">
                <span style="margin-right: 4px">{{ $$('side_length') }}:{{ format(size.x) }}</span>
                <span>{{ $$('side_height') }}:{{ format(size.z) }}</span>
            </template>
            <template v-else>
                <span style="margin-right: 4px">{{ $$('side_width') }}:{{ format(size.y) }}</span>
                <span>{{ $$('side_height') }}:{{ format(size.z) }}</span>
            </template>
            <!-- {{ `width:${format(state.width)}  length:${format(state.length)}` }} -->
        </div>
        <div class="tool" v-show="size.length() > 0 && canEdit()">
            <template v-if="props.axis === 'z'">
                <span class="item" @mousedown.left="onAction('rotationZLeft')"
                    ><RotateLeftOutlined />Z</span
                >
                <span class="item" @mousedown.left="onAction('rotationZRight')"
                    ><RotateRightOutlined />X</span
                >
            </template>
            <template v-if="props.axis === '-y'">
                <span class="item" @mousedown.left="onAction('translateXMinus')"
                    ><ArrowLeftOutlined />A</span
                >
                <span class="item" @mousedown.left="onAction('translateZPlus')"
                    ><ArrowUpOutlined />W</span
                >
                <span class="item" @mousedown.left="onAction('translateZMinus')"
                    ><ArrowDownOutlined />S</span
                >
                <span class="item" @mousedown.left="onAction('translateXPlus')"
                    ><ArrowRightOutlined />D</span
                >
            </template>
            <template v-if="props.axis === '-x'">
                <span class="item" @mousedown.left="onAction('translateYPlus')"
                    ><ArrowLeftOutlined />Q</span
                >
                <span class="item" @mousedown.left="onAction('translateYMinus')"
                    ><ArrowRightOutlined />E</span
                >
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref, computed, onMounted, onBeforeMount } from 'vue';
    import { axisType } from 'pc-render';
    import { formatNumber as format } from '../../utils';
    import useSideView from './useSideView';
    import useUI from '../../hook/useUI';
    import useContextMenu from '../../hook/useContextMenu';
    import {
        AimOutlined,
        FullscreenOutlined,
        FullscreenExitOutlined,
        RotateLeftOutlined,
        RotateRightOutlined,
        ArrowLeftOutlined,
        ArrowUpOutlined,
        ArrowRightOutlined,
        ArrowDownOutlined,
    } from '@ant-design/icons-vue';
    import { useInjectEditor } from '../../state';

    // ***************Props and Emits***************
    interface SideViewProps {
        axis: axisType;
        expanded: boolean;
    }

    const props = withDefaults(defineProps<SideViewProps>(), {
        axis: 'x',
    });
    // *********************************************

    let editor = useInjectEditor();
    let dom = ref<HTMLDivElement | null>(null);
    let { canEdit } = useUI();
    let { handleContext, clearContext } = useContextMenu();
    const { title, size, onAction, onDBLclick, $$ } = useSideView(dom, props);
    const expandLabel = computed(() => $$(props.expanded ? 'side_restore' : 'side_expand'));
    const emit = defineEmits(['expand']);

    onMounted(() => {
        if (dom.value) {
            handleContext(dom.value);
        }
    });

    onBeforeMount(() => {
        clearContext();
    });
</script>

<style lang="less">
    .side-view {
        height: 100%;
        position: relative;
        overflow: hidden;
        color: #dee5eb;

        .info {
            position: absolute;
            top: 10px;
            right: 10px;
            font-size: 12px;

            color: #dee5eb;
            pointer-events: none;
            user-select: none;
        }

        .title1 {
            position: absolute;
            top: 5px;
            font-size: 12px;
            color: #dee5eb;
            left: 10px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .reset-view {
            width: 26px;
            height: 26px;
            padding: 0;
            border: none;
            border-radius: 3px;
            background: #232729;
            color: #c6d1d6;
            cursor: pointer;
            &:hover, &:focus-visible { background: #424a4d; color: white; }
        }

        .tool {
            position: absolute;
            left: 0px;
            right: 0px;
            bottom: 10px;
            height: 20px;
            text-align: center;
            pointer-events: none;

            .item {
                padding: 2px 4px;
                background: #1e1f23;
                margin-right: 6px;
                border-radius: 4px;
                cursor: pointer;
                pointer-events: visible;

                &:hover {
                    background: #0486fe;
                    // color: #dee5eb;
                }
                // line-height: 20px;
                .anticon {
                    margin-right: 4px;
                }
            }
        }
    }
</style>
