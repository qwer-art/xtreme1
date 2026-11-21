<template>
    <div v-show="samActive || queue.length || message" class="candidate-tools" data-testid="point-sam-panel">
        <div class="review-heading"><strong>Point-SAM</strong><output>待审 {{ queue.length }}</output></div>
        <fieldset :disabled="blocked" aria-label="模型候选">
            <div v-show="samActive" class="sam-tools">
            <label>类别 <select v-model="category" @change="resetDraft"><option v-for="item in editor.state.classTypes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <button type="button" v-for="mode in modes" :key="mode" :aria-pressed="picking === mode" :disabled="mode === '-' && !prompts.some(item => item.positive)" @click="picking = mode">{{ mode === '+' ? '+ 前景点' : '− 背景点' }}</button>
            <button type="button" :disabled="!prompts.length && !draft" @click="resetDraft">新提示组</button>
            <details><summary>跨帧传播</summary><label>向后 <input v-model.number="reach" aria-label="传播帧数" type="number" min="1" :max="editor.state.frames.length - 1" /> 帧</label>
            <button type="button" @click="propagate">传播{{ current ? '候选框' : '已选人工框' }}</button>
            <button type="button" :disabled="!marked.length" @click="accept(queue.filter(item => marked.includes(item.id)))">接受勾选 ({{ marked.length }})</button></details>
            </div>
            <div v-if="queue.length" class="candidate-list" aria-label="待审候选列表">
                <div v-for="item in queue" :key="item.id" class="candidate-row" :data-sam-id="item.id">
                    <input type="checkbox" v-model="marked" :value="item.id" :aria-label="`批量选择 ${item.scanId}`" />
                    <button type="button" :aria-pressed="current?.id === item.id" :title="item.scanId" @click="review(item)">查看 {{ item.category }} · 帧 {{ frameNumber(item.scanId) }}</button>
                    <span>{{ item.indices.length ? `掩码 ${item.indices.length} 点` : '传播框' }} · {{ Math.round(item.elapsed_ms) }} ms</span>
                    <button type="button" data-testid="point-sam-accept" @click="accept([item])">接受</button><button type="button" data-testid="point-sam-reject" @click="remove([item])">拒绝</button>
                </div>
            </div>
            <details v-if="current"><summary>微调候选框</summary><div class="candidate-edit" data-testid="point-sam-adjust" aria-label="调整待审框">
                <label v-for="field in fields" :key="field">{{ field === 'center' ? '中心 XYZ (m)' : '尺寸 XYZ (m)' }}
                    <input v-for="(_, axis) in current[field]" :key="axis" type="number" step="0.1" :aria-label="`${field}-${axis}`" :value="current[field][axis]" @change="adjust($event, field, axis)" />
                </label>
                <label>偏航 (rad) <input type="number" step="0.05" :value="current.yaw" @change="adjust($event, 'yaw')" /></label>
            </div></details>
        </fieldset>
        <output aria-live="polite">{{ message }}</output>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { MathUtils } from 'three';
import { Event as EditorEvent, StatusType } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { captureSelected } from '../../common/trialAnnotations';
import { acceptCandidates, checkedShape, pickVertex, preview, scanCloud, segment } from '../../common/trialCandidates';
import type { Candidate, Prompt } from '../../common/trialCandidates';
import { trackNext } from '../../common/trialTracking';

const props = defineProps<{ blocking: boolean; active: boolean; reviewing: boolean }>();
const emit = defineEmits<{ (event: 'update:active', value: boolean): void }>();
const editor = useInjectEditor();
const modes = ['+', '-'] as const, fields = ['center', 'size'] as const;
const samActive = computed(() => props.active), busy = ref(false), category = ref('Car'), reach = ref(1), message = ref('');
const scanId = computed(() => editor.getCurrentFrame()?.id || '');
const blocked = computed(() => props.blocking || busy.value || !scanId.value);
const queue = shallowRef<Candidate[]>([]), marked = ref<string[]>([]), selected = ref(''), draft = ref('');
const prompts = shallowRef<Prompt[]>([]), picking = ref<'+' | '-'>('+');
const current = computed(() => queue.value.find(item => item.id === selected.value && item.scanId === scanId.value));
const frameNumber = (id: string) => editor.state.frames.findIndex(frame => frame.id === id) + 1 || '（全部帧）';
let request: AbortController | undefined, dispose: (() => void) | undefined, alive = true;
const frameReady = ref(0);
function ready() { frameReady.value++; }
function resetDraft() { draft.value = ''; prompts.value = []; picking.value = '+'; selected.value = ''; message.value = ''; }
watch(scanId, () => { request?.abort(); resetDraft(); }, { flush: 'sync' });
watch(samActive, active => {
    if (active) return;
    request?.abort();
    if (message.value === '正在分割…') message.value = '';
});
watch(() => editor.state.status, status => { if (status === StatusType.Create) emit('update:active', false); });
watch([current, prompts, samActive, frameReady, () => props.blocking, () => props.reviewing], () => {
    dispose?.(); dispose = undefined;
    if (props.reviewing && !props.blocking && (current.value || (samActive.value && prompts.value.length))) dispose = preview(editor, current.value, samActive.value ? prompts.value : []);
});

let down: [number, number] | undefined;
function intercept(event: MouseEvent) {
    const view = editor.viewManager.getMainView();
    if (!samActive.value || !props.reviewing || editor.state.status === StatusType.Create || event.button !== 0 || !view || event.target !== view.renderer.domElement) return;
    if (event.type === 'pointerdown') { down = [event.clientX, event.clientY]; return; }
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) return;
    down = undefined;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type !== 'click' || blocked.value) return;
    try {
        const index = pickVertex(scanCloud(editor), view.camera, view.renderer.domElement.getBoundingClientRect(), event.clientX, event.clientY);
        if (index < 0) { message.value = '此处没有扫描点'; return; }
        prompts.value = [...prompts.value.filter(item => item.index !== index), { index, positive: picking.value === '+' }];
        if (prompts.value.some(item => item.positive)) void infer();
        else message.value = '请先点一个前景点';
    } catch (error) { report(error); }
}
const events = ['pointerdown', 'click'];
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
    try { await action(); } catch (error) { if (alive && !(error instanceof DOMException && error.name === 'AbortError')) report(error); } finally { busy.value = false; }
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
    draft.value = selected.value = item.id; message.value = '待审：黄色掩码与候选框';
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
.candidate-tools { min-width: 0; border-bottom: 1px solid #484b53; margin-bottom: 8px; padding-bottom: 8px; }
.sam-tools, .candidate-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
fieldset { margin: 0; padding: 0; min-width: 0; border: 0; }
.candidate-list { max-height: 30vh; overflow-y: auto; }
.candidate-row { border-bottom: 1px solid #41434b; padding: 4px 0; }
.sam-tools details { flex-basis: 100%; }
summary { cursor: pointer; padding: 3px 0; }
input[type=number] { width: 4em; }
.candidate-edit label { display: grid; grid-template-columns: 6em repeat(3, minmax(0, 1fr)); gap: 3px; margin-block: 4px; align-items: center; }
.candidate-edit input { width: 100%; min-width: 0; }
</style>