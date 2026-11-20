<template>
    <div class="candidate-tools">
        <button type="button" data-testid="candidate-panel" :aria-expanded="open" @click="open = !open">模型点提示 · 候选 {{ queue.length }}</button>
        <fieldset v-if="open" :disabled="blocked" aria-label="模型候选">
            <label>类别 <select v-model="category" @change="resetDraft"><option v-for="item in editor.state.classTypes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <button type="button" v-for="mode in modes" :key="mode" :aria-pressed="picking === mode" @click="picking = picking === mode ? null : mode">{{ mode === '+' ? '+ 前景点' : '− 背景点' }}</button>
            <button type="button" :disabled="!prompts.some(item => item.positive)" @click="infer">分割 ({{ prompts.length }})</button>
            <button type="button" :disabled="!prompts.length && !draft" @click="resetDraft">新提示组</button>
            <label>向后 <input v-model.number="reach" aria-label="传播帧数" type="number" min="1" :max="editor.state.frames.length - 1" /> 帧</label>
            <button type="button" @click="propagate">传播{{ current ? '候选框' : '已选人工框' }}</button>
            <button type="button" :disabled="!marked.length" @click="accept(queue.filter(item => marked.includes(item.id)))">接受勾选 ({{ marked.length }})</button>
            <div v-if="queue.length" class="candidate-list" aria-label="待审候选列表">
                <div v-for="item in queue" :key="item.id" class="candidate-row">
                    <input type="checkbox" v-model="marked" :value="item.id" :aria-label="`批量选择 ${item.scanId}`" />
                    <button type="button" :aria-pressed="current?.id === item.id" :title="item.scanId" @click="review(item)">查看 {{ item.category }} · 帧 {{ frameNumber(item.scanId) }}</button>
                    <span>{{ item.indices.length ? `掩码 ${item.indices.length} 点` : '传播框' }} · {{ Math.round(item.elapsed_ms) }} ms</span>
                    <button type="button" @click="accept([item])">接受</button><button type="button" @click="remove([item])">拒绝</button>
                </div>
            </div>
            <div v-if="current" class="candidate-edit" aria-label="调整待审框">
                <label v-for="field in fields" :key="field">{{ field === 'center' ? '中心 XYZ (m)' : '尺寸 XYZ (m)' }}
                    <input v-for="(_, axis) in current[field]" :key="axis" type="number" step="0.1" :aria-label="`${field}-${axis}`" :value="current[field][axis]" @change="adjust($event, field, axis)" />
                </label>
                <label>偏航 (rad) <input type="number" step="0.05" :value="current.yaw" @change="adjust($event, 'yaw')" /></label>
            </div>
        </fieldset>
        <output v-if="open" aria-live="polite">{{ message }}</output>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { MathUtils } from 'three';
import { Event as EditorEvent } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { captureSelected } from '../../common/trialAnnotations';
import { acceptCandidates, checkedShape, pickVertex, preview, scanCloud, segment } from '../../common/trialCandidates';
import type { Candidate, Prompt } from '../../common/trialCandidates';
import { trackNext } from '../../common/trialTracking';

const props = defineProps<{ blocking: boolean }>();
const editor = useInjectEditor();
const modes = ['+', '-'] as const, fields = ['center', 'size'] as const;
const open = ref(false), busy = ref(false), category = ref('Car'), reach = ref(1), message = ref('');
const scanId = computed(() => editor.getCurrentFrame()?.id || '');
const blocked = computed(() => props.blocking || busy.value || !scanId.value);
const queue = shallowRef<Candidate[]>([]), marked = ref<string[]>([]), selected = ref(''), draft = ref('');
const prompts = shallowRef<Prompt[]>([]), picking = ref<'+' | '-' | null>(null);
const current = computed(() => queue.value.find(item => item.id === selected.value && item.scanId === scanId.value));
const frameNumber = (id: string) => editor.state.frames.findIndex(frame => frame.id === id) + 1 || '（全部帧）';
let request: AbortController | undefined, dispose: (() => void) | undefined, alive = true;
const frameReady = ref(0);
function ready() { frameReady.value++; }
function resetDraft() { draft.value = ''; prompts.value = []; picking.value = null; selected.value = ''; }
watch(scanId, () => { request?.abort(); resetDraft(); }, { flush: 'sync' });
watch(open, visible => { if (!visible) picking.value = null; });
watch([current, prompts, open, frameReady, () => props.blocking], () => {
    dispose?.(); dispose = undefined;
    if (open.value && !props.blocking && (current.value || prompts.value.length)) dispose = preview(editor, current.value, prompts.value);
});

function intercept(event: MouseEvent) {
    const view = editor.viewManager.getMainView();
    if (!picking.value || !open.value || event.button !== 0 || !view || event.target !== view.renderer.domElement) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type !== 'click' || blocked.value) return;
    try {
        const index = pickVertex(scanCloud(editor), view.camera, view.renderer.domElement.getBoundingClientRect(), event.clientX, event.clientY);
        if (index < 0) { message.value = '此处没有扫描点'; return; }
        prompts.value = [...prompts.value.filter(item => item.index !== index), { index, positive: picking.value === '+' }];
        message.value = `${picking.value} 点 #${index}`;
    } catch (error) { report(error); }
}
const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'];
onMounted(() => {
    events.forEach(name => window.addEventListener(name, intercept as EventListener, true));
    editor.addEventListener(EditorEvent.FRAME_CHANGE, ready);
});
onBeforeUnmount(() => {
    alive = false; request?.abort(); dispose?.();
    events.forEach(name => window.removeEventListener(name, intercept as EventListener, true));
    editor.removeEventListener(EditorEvent.FRAME_CHANGE, ready);
});
function report(error: unknown) { message.value = error instanceof Error ? error.message : String(error); }
async function run(action: () => Promise<void>) {
    if (blocked.value) return;
    busy.value = true; message.value = '';
    try { await action(); } catch (error) { if (alive) report(error); } finally { busy.value = false; }
}
function infer() { return run(async () => {
    const source = scanId.value, cloud = scanCloud(editor);
    request = new AbortController();
    message.value = '正在分割…';
    const shape = await segment(source, cloud, prompts.value, category.value, request.signal);
    if (!alive || request.signal.aborted || source !== scanId.value || cloud !== scanCloud(editor)) return;
    const old = queue.value.find(item => item.id === draft.value);
    const item = { ...shape, prompts: prompts.value, id: old?.id || MathUtils.generateUUID(), scanId: source, category: category.value,
        trackId: old?.trackId || editor.createTrackId(), trackName: old?.trackName || editor.getId() };
    queue.value = [...queue.value.filter(entry => entry.id !== item.id), item];
    draft.value = selected.value = item.id; picking.value = null; message.value = '待审：黄色掩码与候选框';
}); }
function remove(items: Candidate[]) {
    const ids = new Set(items.map(item => item.id));
    if (ids.has(draft.value)) resetDraft();
    if (ids.has(selected.value)) selected.value = '';
    queue.value = queue.value.filter(item => !ids.has(item.id)); marked.value = marked.value.filter(id => !ids.has(id));
}
function accept(items: Candidate[]) { return run(async () => {
    acceptCandidates(editor, items); remove(items);
    await editor.saveObject();
    if (editor.needSave()) throw new Error('候选已加入编辑器；保存失败，请重试保存');
    message.value = `已接受并保存 ${items.length} 个框`;
}); }
function review(item: Candidate) { return run(async () => {
    const index = editor.state.frames.findIndex(frame => frame.id === item.scanId);
    if (index < 0) throw new Error('请切换到全部帧后查看');
    if (scanId.value !== item.scanId) {
        await editor.saveObject();
        if (editor.needSave()) throw new Error('当前帧未保存');
        await editor.loadFrame(index, true, true);
    }
    if (draft.value !== item.id) resetDraft();
    if (item.prompts) { draft.value = item.id; prompts.value = item.prompts; category.value = item.category; }
    selected.value = item.id;
}); }
function adjust(event: globalThis.Event, field: 'center' | 'size' | 'yaw', axis = 0) {
    const input = event.target as HTMLInputElement, item = current.value;
    if (!item) return;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || (field === 'size' && value <= 0)) {
        input.value = String(field === 'yaw' ? item.yaw : item[field][axis]); return;
    }
    const adjusted = { ...item };
    if (field === 'yaw') adjusted.yaw = value;
    else { adjusted[field] = [...item[field]]; adjusted[field][axis] = value; }
    queue.value = queue.value.map(entry => entry === item ? adjusted : entry);
}
function propagate() { return run(async () => {
    const manual = captureSelected(editor), selectedBox = current.value;
    const source = selectedBox || (manual && { center: manual.box.center, size: manual.box.size, yaw: manual.box.rotation[2],
        trackId: manual.box.track_id, trackName: manual.box.track_name, category: manual.box.class_id, scanId: manual.scan_id });
    if (!source) throw new Error('请先选中当前帧的框');
    const frames = editor.state.frames, start = editor.state.frameIndex, count = reach.value;
    if (!Number.isInteger(count) || count < 1 || start + count >= frames.length) throw new Error('传播帧数超出当前序列');
    const targets = frames.slice(start + 1, start + count + 1).map(frame => frame.id);
    let previous = source;
    for (const target of targets) {
        if (!alive) return;
        if (queue.value.some(item => item.scanId === target && item.trackId === source.trackId)) throw new Error('此帧已有同轨候选');
        message.value = `传播至帧 ${frameNumber(target)}…`;
        const shape = checkedShape(await trackNext(previous.scanId, target, { center: previous.center, size: previous.size, yaw: previous.yaw }));
        if (!alive) return;
        const next = { ...shape, id: MathUtils.generateUUID(), scanId: target, trackId: source.trackId,
            trackName: source.trackName, category: source.category, indices: [] };
        queue.value = [...queue.value, next]; previous = next;
    }
    message.value = `新增 ${count} 个待审传播框`;
}); }
</script>

<style scoped>
.candidate-tools { min-width: 0; }
fieldset, .candidate-row, .candidate-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
fieldset { margin: 4px 0; padding: 0; border: 0; }
.candidate-list { flex-basis: 100%; max-height: 7em; overflow-y: auto; }
.candidate-row + .candidate-row { border-top: 1px solid #ced8db; }
input[type=number] { width: 5em; }
.candidate-edit input { margin-left: 3px; }
</style>