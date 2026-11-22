<template>
    <div class="cp-panel" data-testid="centerpoint-panel">
        <div class="review-heading"><strong>CenterPoint</strong><output data-testid="centerpoint-status" aria-live="polite">{{ status }}</output></div>
        <output v-if="frames && loadError" role="alert">{{ loadError }}</output>
        <button v-if="loadError" type="button" @click="load">重新读取</button>
        <fieldset v-if="result.available" :disabled="blocked">
            <div class="cp-filter" aria-label="候选置信度筛选">
                <label>置信度 ≥ <input data-testid="centerpoint-threshold" type="number" min="0" max="1" step="0.05" v-model.number="threshold" /></label>
                <small class="cp-legend"># 帧内序号 · ID 跟踪编号 · 最后值置信度</small>
            </div>
            <div class="cp-list" aria-label="本帧 CenterPoint 候选">
                <section v-for="group in groups" :key="group.category" class="cp-group" :data-category="group.category">
                    <div class="cp-group-heading">
                    <button type="button" class="cp-type" :style="{ borderLeftColor: categoryColor[group.category] }" :aria-expanded="expanded === group.category" :aria-controls="`cp-objects-${group.category}`"
                        @click="expanded = expanded === group.category ? '' : group.category">
                        <span class="caret" aria-hidden="true"></span><strong>{{ group.category }}</strong><span class="cp-count">{{ group.items.length }}</span>
                    </button>
                    <button type="button" class="cp-visibility" :aria-label="`${group.category} 候选框可见`"
                        :aria-pressed="!hidden.has(group.category)" :title="`${hidden.has(group.category) ? '显示' : '隐藏'} ${group.category} 候选框`"
                        @click="toggleCategory(group.category)"><EyeInvisibleOutlined v-if="hidden.has(group.category)" /><EyeOutlined v-else /></button>
                    </div>
                    <div v-show="expanded === group.category" :id="`cp-objects-${group.category}`" class="cp-objects">
                    <span v-if="!group.items.length" class="cp-empty">暂无待审对象</span>
                    <fieldset v-for="item in group.items" :key="item.id" class="cp-row" :class="{ selected: item.id === selected }" :data-candidate-id="item.sourceId" :disabled="hidden.has(group.category)">
                    <button type="button" data-testid="centerpoint-select" :aria-pressed="item.id === selected"
                        :title="`框 ${item.sourceId} · 轨迹 ${item.trackName}`" @click="selected = item.id">对象 {{ item.number }} · 框 {{ item.sourceId }} · 轨迹 {{ item.trackName }} <span class="cp-score" :aria-label="`置信度 ${item.score.toFixed(2)}`">{{ item.score.toFixed(2) }}</span></button>
                    <button type="button" data-testid="centerpoint-accept" @click="accept(item)">接受</button>
                    <button type="button" data-testid="centerpoint-reject" :disabled="awaitingSave(item)" @click="reject(item)">拒绝</button>
                    </fieldset>
                    </div>
                </section>
            </div>
            <div v-if="current" class="cp-edit" data-testid="centerpoint-adjust">
                <label v-for="field in fields" :key="field">{{ field === 'center' ? '中心 XYZ (m)' : '长宽高 (m)' }}
                    <input v-for="(value, axis) in current[field]" :key="axis" type="number" step="0.1" :value="value"
                        :disabled="awaitingSave(current)" :aria-label="`${field}-${axis}`" @change="adjust($event, field, axis)" />
                </label>
                <label>偏航 (rad) <input type="number" step="0.05" :value="current.yaw" :disabled="awaitingSave(current)"
                    aria-label="yaw" @change="adjust($event, 'yaw')" /></label>
            </div>
        </fieldset>
        <output v-if="message" role="status">{{ message }}</output>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Vector2 } from 'three';
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons-vue';
import { Event as EditorEvent } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { acceptCandidates } from '../../common/trialCandidates';
import { centerPointFrame, loadCenterPoint, pendingReview, writeReview } from '../../common/trialCenterPoint';
import type { CenterPointCandidate, CenterPointFrames } from '../../common/trialCenterPoint';
import { centerPointPreview } from '../../common/trialCenterPointPreview';
import { loadDocument, scanCatalog } from '../../common/trialAnnotationStore';
import { scans } from '../../common/trialScene';
import { detectionColors } from '../../common/trialDetectionColors';

const props = defineProps<{ blocking: boolean; visible: boolean; interactive: boolean; refreshKey: string }>();
const editor = useInjectEditor();
const scanId = computed(() => editor.getCurrentFrame()?.id || '');
const frames = shallowRef<CenterPointFrames>(), loadError = ref(''), message = ref('');
const fields = ['center', 'size'] as const;
const reviewCategories = new Set(['Car', 'Pedestrian', 'Bicycle', 'Motorcycle']);
const expanded = ref('');
const threshold = ref(0.5);
const categoryColor = detectionColors;
const hidden = ref(new Set<string>());
const selected = ref(''), revision = ref(0), busy = ref(false);
const blocked = computed(() => props.blocking || busy.value);
const result = computed(() => {
    revision.value;
    if (!frames.value || !scanId.value) return { items: [], status: loadError.value || '正在读取 CenterPoint 离线结果…' };
    try {
        const all = centerPointFrame(frames.value, scanId.value);
        if (!all) return { items: [], status: '本帧缺少 CenterPoint 离线结果' };
        let saved: Set<string> | undefined;
        const savedBox = (id: string) => {
            if (!saved) saved = new Set(loadDocument(scanCatalog(scans)).frames.find(frame => frame.scan_id === scanId.value)?.boxes.map(box => box.bbox_id));
            return saved.has(id);
        };
        const value = Number.isFinite(threshold.value) ? Math.max(0, Math.min(1, threshold.value)) : 0.3;
        const scoped = all.filter(item => reviewCategories.has(item.category) && item.score >= value);
        const numbers = new Map<string, number>();
        const items = scoped.flatMap(item => {
            const number = (numbers.get(item.category) || 0) + 1;
            numbers.set(item.category, number);
            const pending = pendingReview(item, savedBox);
            return pending ? [{ ...pending, number }] : [];
        });
        return { available: true, items, status: `候选待审 ${items.length} · 阈值 ${value.toFixed(2)}` };
    } catch (error) { return { items: [], status: errorText(error) }; }
});
const items = computed(() => result.value.items), status = computed(() => result.value.status);
const groups = computed(() => Array.from(reviewCategories, category => ({ category, items: items.value.filter(item => item.category === category) })));
const current = computed(() => items.value.find(item => item.id === selected.value));
let overlay: ReturnType<typeof centerPointPreview> | undefined, alive = true;
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
let loadSerial = 0;
async function load() {
    const serial = ++loadSerial;
    loadError.value = '';
    try { const data = await loadCenterPoint(props.refreshKey || undefined); if (alive && serial === loadSerial) frames.value = data; }
    catch (error) { if (alive && serial === loadSerial) loadError.value = errorText(error); }
}
watch(() => props.refreshKey, load);
watch(scanId, () => { selected.value = ''; message.value = ''; });
watch([items, () => props.blocking, () => props.visible], () => {
    overlay?.dispose(); overlay = undefined;
    if (props.visible && !props.blocking && items.value.length) {
        overlay = centerPointPreview(editor, items.value); overlay.setHidden(hidden.value); overlay.select(selected.value);
    }
});
watch(selected, id => overlay?.select(id));
function toggleCategory(category: string) {
    if (hidden.value.has(category)) hidden.value.delete(category);
    else {
        hidden.value.add(category);
        if (current.value?.category === category) selected.value = '';
    }
    overlay?.setHidden(hidden.value);
}
function ready() { revision.value++; }
let down: [number, number] | undefined;
function pointer(event: MouseEvent) {
    const view = editor.viewManager.getMainView();
    if (!props.interactive || blocked.value || !overlay || !view || event.target !== view.renderer.domElement || event.button !== 0) return;
    if (event.type === 'pointerdown') { down = [event.clientX, event.clientY]; return; }
    const start = down; down = undefined;
    if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
    const rect = view.renderer.domElement.getBoundingClientRect();
    const id = overlay.pick(view.camera, new Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
        1 - (event.clientY - rect.top) / rect.height * 2));
    if (id) {
        event.stopImmediatePropagation(); selected.value = id;
        const item = current.value;
        if (item) {
            expanded.value = item.category;
            void nextTick(() => document.querySelector(`.cp-row[data-candidate-id="${CSS.escape(item.sourceId)}"]`)?.scrollIntoView({ block: 'nearest' }));
        }
    }
}
onMounted(() => {
    void load(); editor.addEventListener(EditorEvent.FRAME_CHANGE, ready);
    window.addEventListener('pointerdown', pointer, true); window.addEventListener('click', pointer, true);
});
onBeforeUnmount(() => {
    alive = false; overlay?.dispose(); editor.removeEventListener(EditorEvent.FRAME_CHANGE, ready);
    window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('click', pointer, true);
});
function adjust(event: globalThis.Event, field: 'center' | 'size' | 'yaw', axis = 0) {
    const item = current.value, input = event.target as HTMLInputElement, value = input.valueAsNumber;
    if (!item || blocked.value) return;
    const adjusted = { ...item };
    try {
        if (!Number.isFinite(value) || (field === 'size' && value <= 0)) throw new Error('请输入有效几何值，尺寸必须为正');
        if (field === 'yaw') adjusted.yaw = value;
        else { adjusted[field] = [...item[field]]; adjusted[field][axis] = value; }
        void writeReview(adjusted, 'adjusted').catch(error => { message.value = errorText(error); });
        revision.value++; message.value = '';
    } catch (error) { input.value = String(field === 'yaw' ? item.yaw : item[field][axis]); message.value = errorText(error); }
}
function reject(item: CenterPointCandidate) {
    if (blocked.value || item.scanId !== scanId.value) return;
    try { void writeReview(item, 'rejected').catch(error => { message.value = errorText(error); }); revision.value++; message.value = '已拒绝'; }
    catch (error) { message.value = errorText(error); }
}
function awaitingSave(item: CenterPointCandidate) {
    return !!item.accepting && !!editor.dataManager.getFrameObject(item.scanId)?.some(box => box.uuid === item.id);
}
async function accept(item: CenterPointCandidate) {
    if (blocked.value || item.scanId !== scanId.value) return;
    busy.value = true;
    try {
        const frame = editor.getCurrentFrame(), formal = editor.dataManager.getFrameObject(item.scanId);
        if (!formal) throw new Error('当前帧正式框尚未加载');
        if (!awaitingSave(item)) {
            if (formal.some(box => box.uuid === item.id || box.userData.trackId === item.trackId))
                throw new Error(`本帧已有轨迹或框 ${item.trackId}，已保留正式框`);
            await writeReview(item, 'accepting');
            acceptCandidates(editor, [item]);
        }
        await editor.saveObject([frame]);
        if (editor.needSave([frame])) throw new Error('正式框尚未保存，请重试接受');
        await writeReview(item, 'accepted'); message.value = '已接受并保存';
    } catch (error) { message.value = errorText(error); }
    finally { revision.value++; busy.value = false; }
}
</script>

<style scoped>
.cp-panel fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.cp-group + .cp-group { margin-top: 4px; }
.cp-group-heading { display: grid; grid-template-columns: minmax(0, 1fr) 38px; gap: 4px; }
.cp-filter { display: grid; grid-template-columns: max-content 1fr; align-items: center; gap: 4px; padding: 0 9px; }
.cp-legend { grid-column: 1 / -1; color: #aeb5c1; font-size: 12px; }
.cp-visibility { display: grid; place-items: center; }
.cp-group .cp-type { border-left: 5px solid transparent; display: flex; align-items: center; width: 100%; gap: 9px; padding: 5px 9px; text-align: left; }
.caret { width: 8px; height: 8px; border: solid currentColor; border-width: 2px 2px 0 0; transform: rotate(45deg); }
.cp-type[aria-expanded=true] .caret { transform: rotate(135deg); }
.cp-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.cp-objects { max-height: min(38vh, 25rem); overflow-y: auto; border-left: 2px solid #565962; padding-left: 8px; margin: 3px 0 6px 6px; }
.cp-empty, .cp-score { color: #cbd2de; }
.cp-score { float: right; margin-left: 5px; font-variant-numeric: tabular-nums; }
.cp-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 4px; padding: 3px 0; border-bottom: 1px solid #3e4047; }
.cp-row button:first-child { text-align: left; overflow-wrap: anywhere; }
.cp-edit { margin-top: 8px; display: grid; gap: 5px; }
.cp-edit label { display: grid; grid-template-columns: 6em repeat(3, minmax(0, 1fr)); gap: 3px; align-items: center; }
.cp-edit input { width: 100%; min-width: 0; }
</style>
