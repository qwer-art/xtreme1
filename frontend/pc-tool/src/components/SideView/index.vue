<template>
    <div class="side-view-wrap" :class="{ 'expanded-side': expanded }">
        <div class="side-tabs" v-show="!expanded">
            <button v-for="item in views" :key="item.axis" type="button"
                :aria-pressed="active === item.axis" @click="active = item.axis">
                {{ $$(item.label) }}
            </button>
        </div>
        <View v-for="item in views" :key="item.axis" :axis="item.axis"
            v-show="!expanded || expanded === item.axis" :expanded="expanded === item.axis"
            :class="{ 'mobile-current': active === item.axis }" @expand="toggle(item.axis)" />
    </div>
</template>

<script setup lang="ts">
    import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
    import type { axisType } from 'pc-render';
    import { useInjectEditor } from '../../state';
    import * as locale from './lang';
    import View from './view.vue';

    const views = [{ axis: 'z', label: 'side_overhead' }, { axis: '-y', label: 'side_side' },
        { axis: '-x', label: 'side_near' }] as const;
    const editor = useInjectEditor();
    const $$ = editor.bindLocale(locale);
    const active = ref<axisType>('z');
    const expanded = ref<axisType | null>(null);
    function toggle(axis: axisType) {
        active.value = axis;
        expanded.value = expanded.value === axis ? null : axis;
    }
    function onEscape(event: KeyboardEvent) {
        if (event.key !== 'Escape' || !expanded.value) return;
        event.preventDefault();
        event.stopPropagation();
        expanded.value = null;
    }
    watch([expanded, active], () => editor.pc.render(), { flush: 'post' });
    onMounted(() => document.addEventListener('keydown', onEscape, true));
    onBeforeUnmount(() => document.removeEventListener('keydown', onEscape, true));
</script>

<style lang="less">
    .side-view-wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 0px 6px;
        background: #353a3b;

        .side-tabs { display: none; }

        .side-view {
            flex: 1 1 0;
            min-height: 0;
            border-bottom: 1px solid #4b5051;
            &:last-child {
                border-bottom: none;
            }
        }
    }

    @media (max-width: 850px) {
        .side-view-wrap {
            padding: 0;
            .side-view:not(.mobile-current) { display: none; }
            .side-tabs { display: flex; background: #252929; }
            .side-tabs button {
                flex: 1;
                border: 0;
                border-bottom: 2px solid transparent;
                background: transparent;
                color: #b6c1bd;
                padding: 4px;
                cursor: pointer;
                &[aria-pressed='true'] { color: white; border-bottom-color: #9dc6b4; }
            }
        }
    }
</style>
