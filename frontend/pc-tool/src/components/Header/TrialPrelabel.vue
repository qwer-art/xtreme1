<template>
    <label>预标注模型 <select data-testid="candidate-model" :value="model" @change="$emit('update:model', ($event.target as HTMLSelectElement).value)">
        <option value="CenterPoint">CenterPoint</option><option value="manual">关闭预标注</option>
    </select></label>
    <button type="button" class="trial-run" data-testid="centerpoint-run" :disabled="model !== 'CenterPoint' || !job || pending || running || !!connectionError" @click="start"><PlayCircleOutlined /> 开始推理</button>
    <output data-testid="centerpoint-run-status" :data-state="job?.state" role="status" :title="connectionError || job?.error">
        {{ connectionError ? '状态未连接' : pending ? '提交中' : job ? labels[job.state] : '连接中' }}
        <span v-if="job && job.state !== 'idle'" class="trial-progress">{{ job.completed }}/{{ job.total }} 帧 · {{ percent }}%</span>
        <span v-if="job?.state === 'failed' && job.error" class="trial-run-error">{{ job.error }}</span>
    </output>
    <button v-if="connectionError" type="button" :title="connectionError" @click="connect">重连</button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PlayCircleOutlined } from '@ant-design/icons-vue';

defineProps<{ model: string }>();
const emit = defineEmits<{ (event: 'update:model', value: string): void; (event: 'completed', key: string): void }>();
const labels = { idle: '就绪', running: '推理中', succeeded: '已完成', failed: '推理失败' };
type Job = { state: keyof typeof labels; completed: number; total: number; error?: string; runId?: string };
const job = ref<Job>(), pending = ref(false), connectionError = ref('');
const running = computed(() => job.value?.state === 'running');
const percent = computed(() => job.value ? Math.round(100 * job.value.completed / job.value.total) : 0);
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout>, reading = false, awaitingResult = false;

async function request(startJob: boolean): Promise<Job> {
    const response = await fetch(`/trial-prelabel/${startJob ? 'run' : 'status'}`, {
        ...(startJob ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
        cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CenterPoint HTTP ${response.status}`);
    const value = await response.json();
    if (!value || !Object.prototype.hasOwnProperty.call(labels, value.state) || !Number.isInteger(value.completed) ||
        !Number.isInteger(value.total) || value.completed < 0 || value.total <= 0 || value.completed > value.total)
        throw new Error('CenterPoint 任务状态无效');
    return value;
}
function receive(value: Job) {
    if (controller.signal.aborted) return;
    job.value = value; connectionError.value = '';
    if (value.state === 'running') {
        awaitingResult = true;
        timer = setTimeout(connect, 1000);
    } else {
        if (value.state === 'succeeded' && awaitingResult) emit('completed', `${value.runId || 'result'}-${Date.now()}`);
        awaitingResult = false;
    }
}
function disconnected(error: unknown) {
    if (controller.signal.aborted) return;
    connectionError.value = error instanceof Error ? error.message : String(error);
    if (awaitingResult) timer = setTimeout(connect, 2000);
}
async function connect() {
    if (reading || pending.value) return;
    clearTimeout(timer); reading = true;
    try { receive(await request(false)); } catch (error) { disconnected(error); }
    finally { reading = false; }
}
async function start() {
    if (reading || pending.value || running.value || !job.value || connectionError.value) return;
    clearTimeout(timer); pending.value = true; awaitingResult = true;
    try { receive(await request(true)); } catch (error) { disconnected(error); }
    finally { pending.value = false; }
}
onMounted(connect);
onBeforeUnmount(() => { clearTimeout(timer); controller.abort(); });
</script>

<style scoped>
output { display: inline-flex; gap: 5px; align-items: baseline; color: #c3c6ce; }
output[data-state=succeeded] { color: #91d4ad; }
output[data-state=failed] { color: #ffc0ad; }
.trial-progress { font-variant-numeric: tabular-nums; white-space: nowrap; }
.trial-run-error { max-width: 16em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>