<template>
    <output class="trial-speed" data-testid="trial-speed" :title="title">
        <span v-if="worldXY" aria-hidden="true">↗</span> {{ source }}速度 {{ worldXY ? `${Math.hypot(...worldXY).toFixed(2)} m/s` : unavailable }}<small v-if="interval !== undefined"> · Δt {{ interval.toFixed(2) }} s</small>
    </output>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { ArrowHelper, LineBasicMaterial, MeshBasicMaterial, Vector3 } from 'three';
import { useInjectEditor } from '../../state';
import { scans } from '../../common/trialScene';
import { scanVelocity } from '../../common/trialVelocity';

const props = defineProps<{ scanId: string; center: [number, number, number]; worldXY?: [number, number]; source: string; unavailable: string; interval?: number }>();
const editor = useInjectEditor();
const title = computed(() => props.worldXY ? `世界水平速度 vx=${props.worldXY[0].toFixed(2)}, vy=${props.worldXY[1].toFixed(2)} m/s；青色箭头为 1 秒位移` : props.unavailable);
watchEffect(cleanup => {
    const scan = scans.find(item => item.id === props.scanId);
    if (!scan || !props.worldXY || editor.getCurrentFrame()?.id !== scan.id) return;
    const delta = scanVelocity(props.worldXY, scan), length = delta.length();
    if (length === 0) return;
    const head = Math.min(length * .35, .7);
    const arrow = new ArrowHelper(delta.normalize(), new Vector3(...props.center), length, 0x38e9ff, head, head * .7);
    arrow.name = 'trial-selected-velocity';
    for (const part of [arrow.line, arrow.cone]) {
        (part.material as LineBasicMaterial | MeshBasicMaterial).depthTest = false;
        part.renderOrder = 100;
    }
    editor.pc.scene.add(arrow); editor.pc.render();
    cleanup(() => {
        arrow.removeFromParent();
        (arrow.line.material as LineBasicMaterial).dispose(); (arrow.cone.material as MeshBasicMaterial).dispose();
        editor.pc.render();
    });
});
</script>

<style scoped>
.trial-speed { font-variant-numeric: tabular-nums; }
.trial-speed span { color: #38e9ff; }
.trial-speed small { font-size: .85em; }
</style>