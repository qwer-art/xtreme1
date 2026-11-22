<template>
    <fieldset class="trial-workspace" :disabled="disabled" aria-label="扫描帧与标注">
        <div class="trial-frame-line">
        <div class="trial-frame-tools" role="group" aria-label="帧导航">
        <label>帧 <select data-testid="trial-mode" :value="mode" @change="changeMode">
            <option value="key" :disabled="!hasPairedFrames">图像配对帧</option><option value="all">全部扫描</option>
        </select></label>
        <div class="trial-pager">
            <button type="button" title="上一帧" aria-label="上一帧" data-testid="trial-prev" :disabled="index <= 0" @click="navigate(index - 1)"><LeftOutlined /></button>
            <input data-testid="trial-index" aria-label="帧号" type="number" min="1" :max="count" :value="index + 1" @change="changeIndex" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
            <span>/ {{ count }}</span>
            <button type="button" title="下一帧" aria-label="下一帧" data-testid="trial-next" :disabled="index + 1 >= count" @click="navigate(index + 1)"><RightOutlined /></button>
        </div>
        </div>
        <div class="trial-more-tools" role="group" aria-label="标注选项">
            <button v-for="item in panels" :key="item.id" type="button" :aria-expanded="panel === item.id" :aria-controls="`trial-options-${item.id}`" @click="panel = panel === item.id ? '' : item.id">
                <component :is="item.icon" aria-hidden="true" /> {{ item.label }}<span v-if="item.id === 'overlay' && overlay" class="overlay-count">±{{ radius }}</span>
            </button>
        </div>
        <div class="trial-frame-status" aria-label="当前帧状态">
            <time v-if="scan" title="扫描时间戳（微秒）"><ClockCircleOutlined aria-hidden="true" /> {{ scan.timestamp }} µs</time>
            <output :title="selection ? `框 ${selection.box.bbox_id} · 轨迹 ${selection.box.track_id}` : ''">{{ selection ? '已选框' : '未选框' }}</output>
            <TrialSpeed v-if="selection && selection.scan_id === id" :scan-id="id" :center="selection.box.center" :world-x-y="velocity" :interval="interval" source="轨迹" unavailable="待同 ID 第二帧" />
        </div>
        </div>
        <div v-show="panel === 'overlay'" id="trial-options-overlay" class="trial-options" role="group" aria-label="邻帧显示">
        <label><input v-model="overlay" data-testid="trial-overlay" type="checkbox" /> 叠加邻帧</label>
        <label>半径 <input data-testid="trial-radius" v-model.number="radius" type="number" min="1" max="8" :disabled="!overlay" @change="radius = Math.max(1, Math.min(8, Math.floor(Number(radius) || 1)))" /></label>
        </div>
        <div v-show="panel === 'track'" id="trial-options-track" class="trial-options" role="group" aria-label="跨帧轨迹">
        <button type="button" data-testid="trial-copy" :disabled="!departed || departed.scan_id === id" @click="copy">复制上一选框</button>
        <label>轨迹 <input data-testid="trial-track" v-model="track" list="trial-tracks" @focus="refreshTracks" /></label>
        <datalist id="trial-tracks"><option v-for="item in tracks" :key="item" :value="item" /></datalist>
        <button type="button" data-testid="trial-assign" :disabled="!selection || !track.trim()" @click="assign">分配轨迹</button>
        </div>
        <div v-show="panel === 'file'" id="trial-options-file" class="trial-options" role="group" aria-label="标注文件">
        <button type="button" data-testid="trial-export" @click="download"><ExportOutlined aria-hidden="true" /> 导出 JSON</button>
        <button type="button" data-testid="trial-archive" @click="archive"><SaveOutlined aria-hidden="true" /> 归档已确认版本</button>
        <label class="trial-file"><ImportOutlined aria-hidden="true" /> 导入 JSON<input type="file" accept=".json,application/json" data-testid="trial-import" @change="upload" /></label>
        </div>
        <div v-show="panel === 'box'" id="trial-options-box" class="trial-options" role="group" aria-label="三维框修正">
        <span>中心</span>
        <label>X <input data-testid="trial-box-x" type="number" step="0.01" v-model.number="geometryX" :disabled="!selection" /></label>
        <label>Y <input data-testid="trial-box-y" type="number" step="0.01" v-model.number="geometryY" :disabled="!selection" /></label>
        <label>Z <input data-testid="trial-box-z" type="number" step="0.01" v-model.number="geometryZ" :disabled="!selection" /></label>
        <span>尺寸</span>
        <label>长 <input data-testid="trial-box-length" type="number" step="0.01" min="0.01" v-model.number="geometryLength" :disabled="!selection" /></label>
        <label>宽 <input data-testid="trial-box-width" type="number" step="0.01" min="0.01" v-model.number="geometryWidth" :disabled="!selection" /></label>
        <label>高 <input data-testid="trial-box-height" type="number" step="0.01" min="0.01" v-model.number="geometryHeight" :disabled="!selection" /></label>
        <label>航向° <input data-testid="trial-box-yaw" type="number" step="1" v-model.number="geometryYaw" :disabled="!selection" /></label>
        <button type="button" data-testid="trial-box-apply" :disabled="!selection" @click="applyGeometry">应用修正</button>
        </div>
        <span v-if="error" role="alert">{{ error }}</span>
        <output v-if="archiveStatus" data-testid="trial-archive-status" role="status">{{ archiveStatus }}</output>
    </fieldset>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { ApartmentOutlined, BlockOutlined, BorderOutlined, ClockCircleOutlined, ExportOutlined, FolderOpenOutlined, ImportOutlined, LeftOutlined, RightOutlined, SaveOutlined } from '@ant-design/icons-vue';
import { Event } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { hasPairedFrames, scans, setSceneFilter } from '../../common/trialScene';
import { setTrialOverlay } from '../../common/trialOverlay';
import { archiveLocalAnnotations, assignTrack, captureSelected, copySelected, exportAnnotations, getSelectedGeometry, importAnnotations, listTracks, updateSelectedGeometry } from '../../common/trialAnnotations';
import type { TrialSnapshot } from '../../common/trialAnnotations';
import { loadDocument, scanCatalog } from '../../common/trialAnnotationStore';
import { trackVelocity } from '../../common/trialVelocity';
import TrialSpeed from './TrialSpeed.vue';

const props = defineProps<{ blocking: boolean }>();
const panels = [
    { id: 'overlay', label: '邻帧', icon: BlockOutlined },
    { id: 'box', label: '修框', icon: BorderOutlined },
    { id: 'track', label: '轨迹', icon: ApartmentOutlined },
    { id: 'file', label: '文件', icon: FolderOpenOutlined },
] as const;
const panel = ref<'' | typeof panels[number]['id']>('');
const editor = useInjectEditor();
const mode = ref<'all' | 'key'>('key');
watch(hasPairedFrames, paired => { mode.value = paired ? 'key' : 'all'; }, { immediate: true });
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
const trackId = computed(() => selection.value?.box.track_id);
const neighbor = computed(() => {
    const current = scan.value, track = trackId.value;
    if (!current || !track) return;
    const frames = loadDocument(scanCatalog(scans)).frames;
    let best: { frame: typeof current; center: [number, number, number]; seconds: number } | undefined;
    for (const [index, record] of frames.entries()) {
        const seconds = Math.abs(record.timestamp_us - current.timestamp) / 1e6;
        if (!seconds || (best && seconds >= best.seconds)) continue;
        const box = record.boxes.find(box => box.track_id === track);
        if (box) best = { frame: scans[index], center: box.center, seconds };
    }
    return best;
});
const interval = computed(() => neighbor.value?.seconds);
const velocity = computed(() => scan.value && selection.value && neighbor.value
    ? trackVelocity(scan.value, selection.value.box.center, neighbor.value.frame, neighbor.value.center) : undefined);
const departed = shallowRef<TrialSnapshot | null>(null);
const error = ref('');
const archiveStatus = ref('');
const geometryX = ref(0);
const geometryY = ref(0);
const geometryZ = ref(0);
const geometryLength = ref(0);
const geometryWidth = ref(0);
const geometryHeight = ref(0);
const geometryYaw = ref(0);
const refreshSelection = () => {
    selection.value = captureSelected(editor);
    const geometry = getSelectedGeometry(editor);
    if (!geometry) return;
    geometryX.value = Number(geometry.center[0].toFixed(3));
    geometryY.value = Number(geometry.center[1].toFixed(3));
    geometryZ.value = Number(geometry.center[2].toFixed(3));
    geometryLength.value = Number(geometry.size[0].toFixed(3));
    geometryWidth.value = Number(geometry.size[1].toFixed(3));
    geometryHeight.value = Number(geometry.size[2].toFixed(3));
    geometryYaw.value = Number((geometry.yaw * 180 / Math.PI).toFixed(2));
};
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
        link.download = `${doc.scene}-annotations.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}
function archive() {
    return run(async () => {
        const result = await archiveLocalAnnotations(editor);
        archiveStatus.value = `已归档版本 ${result.version}`;
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
function applyGeometry() {
    return run(() => updateSelectedGeometry(editor, {
        center: [geometryX.value, geometryY.value, geometryZ.value],
        size: [geometryLength.value, geometryWidth.value, geometryHeight.value],
        yaw: geometryYaw.value * Math.PI / 180,
    }));
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
    editor.addEventListener(Event.ANNOTATE_TRANSFORM_CHANGE, refreshSelection);
    editor.addEventListener(Event.ANNOTATE_CHANGE, refreshSelection);
    refreshSelection();
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', arrows, true);
    editor.removeEventListener(Event.ANNOTATE_SELECT, refreshSelection);
    editor.removeEventListener(Event.ANNOTATE_TRANSFORM_CHANGE, refreshSelection);
    editor.removeEventListener(Event.ANNOTATE_CHANGE, refreshSelection);
    void setTrialOverlay(editor, scans, '', 0).catch(report);
});
</script>

<style scoped>
.trial-workspace { min-width: 0; margin: 0; padding: 0; border: 0; }
.trial-frame-line, .trial-frame-tools, .trial-more-tools, .trial-frame-status, .trial-options { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.trial-frame-line { gap: 5px 16px; }
.trial-more-tools { padding-inline-start: 12px; border-inline-start: 1px solid #585b64; }
.trial-more-tools button[aria-expanded=true] { background: #25465a; border-color: #73b4d4; }
.trial-frame-status { color: #bcc2ce; margin-inline-start: auto; font-size: var(--trial-secondary-font); font-variant-numeric: tabular-nums; }
.trial-frame-status output { padding-inline-start: 8px; border-inline-start: 1px solid #585b64; }
.trial-options { margin-top: 5px; padding: 5px 8px; border-inline-start: 3px solid #73b4d4; background: #30343b; }
.overlay-count { color: #a5e4eb; }
@media (max-width: 680px) {
    .trial-frame-line { gap: 4px 8px; }
    .trial-frame-status { font-size: 14px; }
    .trial-more-tools { padding-inline-start: 0; border: 0; }
}
.trial-workspace label, .trial-pager { display: inline-flex; align-items: center; gap: 4px; }
.trial-workspace input, .trial-workspace select { color: inherit; font: inherit; }
.trial-workspace input[type=number] { width: 4em; }
.trial-workspace input[list] { width: 7em; }
.trial-file { position: relative; overflow: hidden; }
.trial-file input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.trial-file:focus-within { outline: 2px solid #0066a1; }
.trial-workspace output { font-size: var(--trial-secondary-font); overflow-wrap: anywhere; }
.trial-workspace [role=alert] { color: #ffb6a1; }
</style>