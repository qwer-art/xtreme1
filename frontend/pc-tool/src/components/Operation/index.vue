<template>
    <div class="operation-shell" :class="{ 'trial-operation': localTrial }">
        <template v-if="localTrial">
            <template v-if="mounted">
                <Teleport to="#trial-prelabel-controls">
                    <TrialPrelabel v-model:model="model" @completed="refreshKey = $event" />
                </Teleport>
                <Teleport to="#trial-assist-controls">
                    <button type="button" class="assist-picker" aria-controls="trial-assist-options" :aria-expanded="assistOpen" @click="assistOpen = !assistOpen">
                        辅助标注 · {{ samActive ? 'Point-SAM' : methods.find(method => method.id === editor.state.config.boxMethod)?.label }} <DownOutlined aria-hidden="true" />
                    </button>
                    <div v-show="assistOpen" id="trial-assist-options" class="trial-assist-options">
                        <label class="sam-switch"><input type="checkbox" data-testid="point-sam-toggle" v-model="samActive" :disabled="blocking" /> Point-SAM</label>
                        <button v-for="method in methods" :key="method.id" type="button" :aria-pressed="!samActive && editor.state.config.boxMethod === method.id" :disabled="blocking"
                            @click="samActive = false; editor.state.config.boxMethod = method.id">{{ method.label }}</button>
                    </div>
                </Teleport>
            </template>
            <nav class="review-tabs" aria-label="右侧面板">
                <button type="button" data-testid="trial-review-tab" :aria-pressed="reviewing" @click="reviewing = true">待审核</button>
                <button type="button" data-testid="trial-instances-tab" :aria-pressed="!reviewing" @click="reviewing = false">Instances</button>
            </nav>
            <section v-show="reviewing" class="trial-review" aria-label="候选审核" data-testid="trial-review-panel">
                <TrialCandidates :blocking="blocking" :active="samActive" :reviewing="reviewing" @update:active="samActive = $event" />
                <TrialCenterPoint v-show="prelabel" :blocking="blocking" :visible="reviewing && prelabel" :interactive="!samActive"
                    :refresh-key="refreshKey" />
            </section>
        </template>
        <div v-show="!localTrial || !reviewing" class="pc-editor-operation">
        <Results />
        <Classification />
        <Instance />
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, watch } from 'vue';
    import { DownOutlined } from '@ant-design/icons-vue';
    import { useInjectEditor } from '../../state';
    import { localTrial } from '../../common/localTrial';
    import { useEditorBlocking } from '../Header/useHeader';
    import TrialCandidates from '../Header/TrialCandidates.vue';
    import TrialCenterPoint from '../Header/TrialCenterPoint.vue';
    import TrialPrelabel from '../Header/TrialPrelabel.vue';

    import Results from './Results/index.vue';
    import Instance from '../Instance/index.vue';
    // import Instance from './Instance/index.vue';
    import Classification from './Classification/index.vue';

    const emit = defineEmits<{ (event: 'show-rail'): void }>();
    const editor = useInjectEditor(), blocking = useEditorBlocking();
    const mounted = ref(false), reviewing = ref(true), samActive = ref(false);
    const assistOpen = ref(false);
    const model = ref('CenterPoint'), prelabel = computed(() => model.value === 'CenterPoint');
    const refreshKey = ref('');
    const methods = [{ id: 'STANDARD', label: '手工三点框' }, { id: 'AI', label: 'AI Box · 点云拟合' }] as const;
    onMounted(() => { mounted.value = true; });
    watch(samActive, active => { if (active) { reviewing.value = true; emit('show-rail'); } });
</script>

<style lang="less">
    .operation-shell { height: 100%; }
    .trial-operation { display: flex; flex-direction: column; min-height: 0; }
    .trial-operation .pc-editor-operation { flex: 1; min-height: 0; }
    .review-tabs { display: flex; border-bottom: 1px solid #494b52; }
    .review-tabs button { flex: 1; background: #2a2b31; color: #d8dce4; border: 0; border-bottom: 2px solid transparent; padding: 8px; cursor: pointer; font-size: var(--trial-ui-font); }
    .review-tabs button[aria-pressed=true] { border-color: #82bfff; color: white; background: #30343c; }
    .trial-review { flex: 1; min-height: 0; padding: 8px; overflow: auto; font-size: var(--trial-ui-font); line-height: 1.45; color: #e9edf3; }
    .review-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px; padding: 3px 0 6px; }
    .review-heading output { color: #c0c6d0; font-variant-numeric: tabular-nums; }
    .trial-controls, .trial-review {
        button, select, input:not([type=checkbox]):not([type=file]), .trial-file { background: #34363d; color: #edf0f5; border: 1px solid #646976; border-radius: 3px; font: inherit; min-height: 36px; padding: 3px 7px; }
        button, select, .trial-file { cursor: pointer; }
        button[aria-pressed=true], button.trial-run { background: #31485b; color: #def1ff; border-color: #5887a9; }
        :disabled, fieldset:disabled button { opacity: .55; cursor: default; }
        :focus-visible { outline: 2px solid #90c6fb; outline-offset: 1px; }
        input[type=checkbox] { accent-color: #84bce8; }
        .sam-switch { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    }
    .pc-editor-operation {
        color: white;
        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;

        .collapse-title {
            font-weight: 600;
        }
    }
</style>
