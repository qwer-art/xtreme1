<template>
    <div class="trial-depth-legend" aria-label="点云深度图例，单位米" title="相机光轴深度（米）">
        <span>深度 m</span>
        <span v-for="band in depthBands" :key="band.color"><i :style="{ backgroundColor: band.color }" />{{ band.label }}</span>
    </div>
</template>

<script setup lang="ts">
    import { depthBands } from './trialDepthColors';
</script>

<style scoped>
    .trial-depth-legend { position: absolute; z-index: 2; top: 31px; left: 6px; max-width: calc(100% - 12px);
        display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 2px 5px; box-sizing: border-box;
        border-radius: 3px; background: #161b20eb; color: #fff; font: 11px/16px sans-serif; pointer-events: none; }
    span { display: inline-flex; gap: 3px; align-items: center; white-space: nowrap; }
    i { width: 7px; height: 7px; border-radius: 50%; }
</style>