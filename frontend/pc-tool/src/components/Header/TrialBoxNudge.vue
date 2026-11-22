<template>
    <div class="box-nudges" role="group" aria-label="候选框微调" @keydown.enter.stop @keyup.enter.stop>
        <select v-model="target" aria-label="微调轴">
            <option v-for="option in axes" :key="option.label" :value="option">{{ option.label }}</option>
        </select>
        <select v-if="target.field === 'yaw'" v-model.number="degrees" aria-label="角度步长">
            <option v-for="step in [1, 5, 15]" :key="step" :value="step">{{ step }}°</option>
        </select>
        <select v-else v-model.number="metres" aria-label="距离步长">
            <option v-for="step in [0.01, 0.05, 0.1, 0.5]" :key="step" :value="step">{{ step }} m</option>
        </select>
        <button type="button" aria-label="减少一步" :title="`减少${target.label}`" @click="move(-1)"><MinusOutlined /></button>
        <button type="button" aria-label="增加一步" :title="`增加${target.label}`" @click="move(1)"><PlusOutlined /></button>
        <button type="button" aria-label="撤销上次微调" title="撤销上次微调" :disabled="!canUndo" @click="emit('undo')"><UndoOutlined /></button>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { MinusOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons-vue';

defineProps<{ canUndo: boolean }>();
type Field = 'center' | 'size' | 'yaw';
const emit = defineEmits<{
    (event: 'nudge', field: Field, axis: number, delta: number): void;
    (event: 'undo'): void;
}>();
const axes = [
    { label: '中心 X', field: 'center', axis: 0 }, { label: '中心 Y', field: 'center', axis: 1 },
    { label: '中心 Z', field: 'center', axis: 2 }, { label: '长度', field: 'size', axis: 0 },
    { label: '宽度', field: 'size', axis: 1 }, { label: '高度', field: 'size', axis: 2 },
    { label: '偏航', field: 'yaw', axis: 0 },
] as const;
const target = ref<typeof axes[number]>(axes[0]);
const metres = ref(0.05), degrees = ref(1);
function move(direction: number) {
    const { field, axis } = target.value;
    emit('nudge', field, axis, direction * (field === 'yaw' ? degrees.value * Math.PI / 180 : metres.value));
}
</script>

<style scoped>
.box-nudges { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
</style>