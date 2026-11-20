<template>
    <fieldset class="trial-workspace" :disabled="disabled" aria-label="扫描帧与标注">
        <label>扫描 <select data-testid="trial-mode" :value="mode" @change="changeMode">
            <option value="all">全部帧</option><option value="key">关键帧</option>
        </select></label>
        <div class="trial-pager">
            <button type="button" title="上一帧" data-testid="trial-prev" :disabled="index <= 0" @click="navigate(index - 1)">‹</button>
            <input data-testid="trial-index" aria-label="帧号" type="number" min="1" :max="count" :value="index + 1" @change="changeIndex" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
            <span>/ {{ count }}</span>
            <button type="button" title="下一帧" data-testid="trial-next" :disabled="index + 1 >= count" @click="navigate(index + 1)">›</button>
        </div>
        <time title="扫描时间戳 (µs)">{{ scan?.timestamp }} µs</time>
        <label><input v-model="overlay" data-testid="trial-overlay" type="checkbox" /> 叠加邻帧</label>
        <label>半径 <input data-testid="trial-radius" v-model.number="radius" type="number" min="1" max="8" :disabled="!overlay" @change="radius = Math.max(1, Math.min(8, Math.floor(Number(radius) || 1)))" /></label>
        <button type="button" data-testid="trial-copy" :disabled="!departed || departed.scan_id === id" @click="copy">复制上一选框</button>
        <label>轨迹 <input data-testid="trial-track" v-model="track" list="trial-tracks" @focus="refreshTracks" /></label>
        <datalist id="trial-tracks"><option v-for="item in tracks" :key="item" :value="item" /></datalist>
        <button type="button" data-testid="trial-assign" :disabled="!selection || !track.trim()" @click="assign">分配轨迹</button>
        <button type="button" data-testid="trial-export" @click="download">导出 JSON</button>
        <label class="trial-file">导入 JSON<input type="file" accept=".json,application/json" data-testid="trial-import" @change="upload" /></label>
        <output :title="selection?.box.bbox_id">{{ selection ? `框 ${selection.box.bbox_id} · 轨迹 ${selection.box.track_id}` : '未选框' }}</output>
        <span v-if="error" role="alert">{{ error }}</span>
    </fieldset>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Event } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { scans, setSceneFilter } from '../../common/trialScene';
import { setTrialOverlay } from '../../common/trialOverlay';
import { assignTrack, captureSelected, copySelected, exportAnnotations, importAnnotations, listTracks } from '../../common/trialAnnotations';
import type { TrialSnapshot } from '../../common/trialAnnotations';

const props = defineProps<{ blocking: boolean }>();
const editor = useInjectEditor();
const mode = ref<'all' | 'key'>('all');
const index = computed(() => editor.state.frameIndex);
const count = computed(() => editor.state.frames.length);
const id = computed(() => editor.state.frames[index.value]?.id || '');
const scan = computed(() => {
    const currentId = id.value;
    return scans.find(item => item.id === currentId);
});
const busy = ref(false);
const disabled = computed(() => busy.value || props.blocking || !id.value);
const overlay = ref(false);
const radius = ref(1);
const track = ref('');
const tracks = ref<string[]>([]);
const selection = shallowRef<TrialSnapshot | null>(null);
const departed = shallowRef<TrialSnapshot | null>(null);
const error = ref('');
const refreshSelection = () => { selection.value = captureSelected(editor); };
const refreshTracks = () => { tracks.value = listTracks(editor); };
const report = (cause: unknown) => { error.value = cause instanceof Error ? cause.message : String(cause); };

async function run(action: () => void | Promise<void>) {
    if (disabled.value) return;
    busy.value = true;
    error.value = '';
    try { await action(); } catch (cause) { report(cause); }
    finally { busy.value = false; refreshSelection(); }
}

function navigate(target: number, nextMode = mode.value) {
    if (nextMode === mode.value && (!Number.isInteger(target) || target < 0 || target >= count.value || target === index.value)) return;
    return run(async () => {
        const source = id.value;
        const snapshot = captureSelected(editor);
        await editor.saveObject();
        if (editor.needSave()) throw new Error('标注未保存，已暂停切帧');
        if (mode.value !== nextMode) {
            target = setSceneFilter(editor, nextMode, source);
            mode.value = nextMode;
        }
        await editor.loadFrame(target, true, true);
        if (id.value !== source) departed.value = snapshot;
    });
}

function changeMode(event: globalThis.Event) {
    const select = event.target as HTMLSelectElement;
    const next = select.value as 'all' | 'key';
    select.value = mode.value;
    navigate(index.value, next);
}
function changeIndex(event: globalThis.Event) {
    const input = event.target as HTMLInputElement;
    const target = input.valueAsNumber - 1;
    input.value = String(index.value + 1);
    navigate(target);
}
function copy() { return run(() => { if (departed.value) copySelected(editor, departed.value); }); }
function assign() { return run(() => { assignTrack(editor, track.value.trim()); refreshTracks(); }); }
function download() {
    return run(async () => {
        const doc = await exportAnnotations(editor);
        const url = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'scene-0061-annotations.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}
function upload(event: globalThis.Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    return run(async () => {
        const existing = await exportAnnotations(editor);
        if (existing.frames.some(frame => frame.boxes.length) && !window.confirm('替换本场景已有标注？')) return;
        await importAnnotations(editor, await file.text());
        departed.value = null;
        refreshTracks();
    });
}
function arrows(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.stopImmediatePropagation();
    if (!event.altKey && event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    event.preventDefault();
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat) navigate(index.value + (event.key === 'ArrowLeft' ? -1 : 1));
}
watch([id, overlay, radius], () => {
    void setTrialOverlay(editor, scans, id.value, overlay.value ? Math.min(8, radius.value) : 0).catch(report);
});
watch(id, refreshSelection);
onMounted(() => {
    window.addEventListener('keydown', arrows, true);
    editor.addEventListener(Event.ANNOTATE_SELECT, refreshSelection);
    refreshSelection();
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', arrows, true);
    editor.removeEventListener(Event.ANNOTATE_SELECT, refreshSelection);
    void setTrialOverlay(editor, scans, '', 0).catch(report);
});
</script>

<style scoped>
.trial-workspace { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
.trial-workspace label, .trial-pager { display: inline-flex; align-items: center; gap: 4px; }
.trial-workspace input, .trial-workspace select { color: inherit; font: inherit; }
.trial-workspace input[type=number] { width: 4em; }
.trial-workspace input[list] { width: 7em; }
.trial-file { position: relative; overflow: hidden; border: 1px solid #9caeb6; background: white; border-radius: 4px; padding: 3px 12px; }
.trial-file input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.trial-file:focus-within { outline: 2px solid #0066a1; }
.trial-workspace output { font-size: 0.88em; overflow-wrap: anywhere; }
.trial-workspace [role=alert] { color: #962e20; }
</style>