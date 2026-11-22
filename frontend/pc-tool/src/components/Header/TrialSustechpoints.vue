<template>
    <button ref="opener" type="button" data-testid="trial-sustechpoints" :disabled="blocking || opening || !scan"
        title="SUSTechPOINTS 补标" @click="open"><EditOutlined /> SUSTechPOINTS</button>
    <span v-if="!opened && status" role="status" class="sustech-status">{{ status }}</span>
    <Teleport to="body">
        <section v-if="opened" class="sustech-editor" role="dialog" aria-modal="true" aria-label="SUSTechPOINTS 补标">
            <header>
                <strong>SUSTechPOINTS</strong><span>{{ baseline?.scene }}</span>
                <output role="status">{{ status }}</output>
                <button type="button" aria-label="保存并返回" :disabled="saving || !ready" @click="saveAndReturn"><SaveOutlined /> 保存并返回</button>
                <button type="button" aria-label="返回标注台" title="保存修改并返回标注台" :disabled="saving || !ready" @click="close"><ArrowLeftOutlined /> 返回标注台</button>
            </header>
            <div v-if="confirmClose" class="sustech-confirm" role="alertdialog" aria-label="未保存的补标">
                <span>有未保存的补标</span>
                <button type="button" @click="confirmClose = false">继续编辑</button>
                <button type="button" :disabled="saving" @click="saveAndReturn">保存并返回</button>
                <button type="button" :disabled="saving" @click="finish">放弃未保存修改</button>
            </div>
            <iframe ref="nativeFrame" :src="url" title="SUSTechPOINTS 原生编辑区" @load="loaded" />
        </section>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import { ArrowLeftOutlined, EditOutlined, SaveOutlined } from '@ant-design/icons-vue';
import { Event as EditorEvent } from 'pc-editor';
import { useInjectEditor } from '../../state';
import { scans } from '../../common/trialScene';
import { exportAnnotations, importAnnotations } from '../../common/trialAnnotations';
import { persistReviewDatabase, sceneCacheId } from '../../common/trialAnnotationStore';
import { mergeSustechpoints } from '../../common/trialSustechpoints';
import type { SustechDocument } from '../../common/trialSustechpoints';

defineProps<{ blocking: boolean }>();
const editor = useInjectEditor();
const scan = computed(() => {
    const id = editor.state.frames[editor.state.frameIndex]?.id;
    return scans.find(scan => scan.id === id);
});
const opened = ref(false), opening = ref(false), saving = ref(false), ready = ref(false), confirmClose = ref(false);
const nativeFrame = ref<HTMLIFrameElement>(), opener = ref<HTMLButtonElement>();
const baseline = shallowRef<SustechDocument>();
const url = ref(''), status = ref('');
let sessionPath = '', timer: ReturnType<typeof setTimeout> | undefined;
const nativeEditor = () => (nativeFrame.value?.contentWindow as any)?.editor;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
type Updates = Parameters<typeof mergeSustechpoints>[2];
const bridgeWindow = window as Window & { xtremeSustechSave?: (source: Window, updates: Updates) => Promise<void>;
    xtremeSustechCategories?: { id: string; color: string }[] };

async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
}

async function open() {
    opening.value = true; status.value = '';
    try {
        await exportAnnotations(editor);
        const session = await request('/sustechpoints/session', 'POST');
        sessionPath = session.path;
        baseline.value = session.baseline;
        const frame = String(scan.value?.timestamp);
        if (!baseline.value?.scanIds[frame]) throw new Error('当前扫描没有配对图像和预标注，请选择图像配对帧');
        url.value = `${sessionPath}?scene=${encodeURIComponent(baseline.value.scene)}&frame=${frame}`;
        bridgeWindow.xtremeSustechCategories = editor.state.classTypes.map(({ id, color }) => ({ id: String(id), color }));
        bridgeWindow.xtremeSustechSave = save;
        ready.value = false; opened.value = true; status.value = '正在载入';
    } catch (error) { status.value = errorText(error); await release(); }
    finally { opening.value = false; }
}

function loaded() {
    const check = () => {
        if (!opened.value) return;
        const native = nativeEditor();
        if (native?.data.world?.preloaded()) {
            ready.value = true; status.value = '';
            nativeFrame.value?.contentWindow?.focus();
        } else timer = setTimeout(check, 200);
    };
    check();
}

async function save(source: Window, updates: Updates) {
    if (source !== nativeFrame.value?.contentWindow || !baseline.value || !opened.value) throw new Error('补标会话已关闭');
    if (saving.value) throw new Error('正在保存，请稍候');
    saving.value = true; status.value = '正在保存';
    try {
        const working = await exportAnnotations(editor);
        const result = mergeSustechpoints(working, baseline.value, updates);
        const unknown = [...new Set(result.document.frames.flatMap(frame => frame.boxes)
            .filter(box => box.class_id && !editor.getClassType(box.class_id)).map(box => box.class_id))];
        if (unknown.length) throw new Error(`请先修改不支持的类别：${unknown.join('、')}；补标仍保留在当前页`);
        await importAnnotations(editor, result.document);
        const cacheId = sceneCacheId(scans[0]);
        for (const review of result.reviews) {
            const key = `xtreme1:local-trial:review:v1:${cacheId}:centerpoint:${review.scanId}:${review.candidateId}`;
            localStorage.setItem(key, JSON.stringify({ decision: review.decision, reviewedAt: new Date().toISOString() }));
        }
        await persistReviewDatabase(cacheId);
        await request(sessionPath + 'checkpoint', 'POST', updates);
        for (const update of updates) baseline.value.frames[update.frame] = JSON.parse(JSON.stringify(update.annotation));
        editor.dispatchEvent({ type: EditorEvent.FRAME_CHANGE });
        status.value = '已保存到标注台';
    } catch (error) { status.value = errorText(error); throw error; }
    finally { saving.value = false; }
}

function dirtyWorlds() {
    return (nativeEditor()?.data.worldList || []).filter(world => world.annotation.modified);
}

async function saveAndReturn() {
    const native = nativeEditor();
    if (!native || !nativeFrame.value?.contentWindow) return;
    try {
        const worlds = dirtyWorlds();
        if (worlds.length) {
            await save(nativeFrame.value.contentWindow, worlds.map(world => ({ scene: world.frameInfo.scene,
                frame: world.frameInfo.frame, annotation: world.annotation.toBoxAnnotations() })));
            worlds.forEach(world => world.annotation.resetModified());
        }
        await finish();
    } catch (error) { status.value = errorText(error); confirmClose.value = true; }
}

async function release() {
    if (sessionPath) await fetch(sessionPath, { method: 'DELETE' }).catch(() => undefined);
    sessionPath = '';
}
async function finish() {
    opened.value = false; confirmClose.value = false; ready.value = false;
    if (timer) clearTimeout(timer);
    delete bridgeWindow.xtremeSustechSave;
    delete bridgeWindow.xtremeSustechCategories;
    await release();
    await nextTick(); opener.value?.focus();
}
function close() {
    void saveAndReturn();
}
onBeforeUnmount(() => { if (timer) clearTimeout(timer); delete bridgeWindow.xtremeSustechSave;
    delete bridgeWindow.xtremeSustechCategories; void release(); });
</script>

<style scoped>
.sustech-editor { position: fixed; inset: 0; z-index: 2000; display: grid; grid-template-rows: auto auto minmax(0, 1fr); background: #202124; color: #edf0f3; font-family: "Noto Sans CJK SC", sans-serif; }
.sustech-editor header { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #62666f; }
.sustech-editor output { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sustech-editor button { background: #33363b; color: inherit; border: 1px solid #747a85; border-radius: 3px; padding: 5px 10px; cursor: pointer; font: inherit; }
.sustech-editor button:disabled { opacity: .5; cursor: default; }
.sustech-editor iframe { grid-row: 3; width: 100%; height: 100%; border: 0; min-height: 0; }
.sustech-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; background: #493d24; padding: 8px 12px; }
.sustech-status { font-size: 14px; overflow-wrap: anywhere; }
</style>