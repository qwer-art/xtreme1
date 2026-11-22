<template>
    <div class="main-view-label">
        <div
            class="item"
            v-for="item in props.data"
            :class="{ 'box-metadata': item.box }"
            :data-testid="item.box ? 'trial-box-label' : undefined"
            :data-box-id="item.box?.bbox_id"
            :style="{ transform: `translate(${item.x}px, ${item.y}px) scale(${item.scale})` }"
        >
            <template v-if="item.box">
                <span class="semantic" :style="{ borderColor: item.color }">语义 {{ item.box.class_id || '待选择' }}</span>
                <span>idx {{ item.box.idx }}</span>
                <span class="track-id" :title="item.box.track_id">ID {{ item.box.track_id }}</span>
                <span>速度 {{ item.box.velocity?.status === 'computed' ? `${item.box.velocity.speed_mps.toFixed(2)} m/s` : item.box.velocity?.status === 'missing_pose' ? '缺少位姿' : '待同 ID 第二帧' }}</span>
            </template>
            <span v-else class="title">{{ item.name }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
    // ***************Props and Emits***************
    // const emit = defineEmits(['close']);
    let props = defineProps(['data']);
    // *********************************************
</script>

<style lang="less">
    .main-view-label {
        position: absolute;
        left: 0px;
        top: 0px;

        .item {
            pointer-events: none;
            user-select: none;
            position: absolute;
            font-size: 12px;
            width: 100px;
            text-align: center;
            margin-left: -50px;
            transform-origin: center;

            .title {
                background: rgb(255 0 0 / 64%);
                color: white;
            }
        }

        .item.box-metadata {
            width: 176px;
            height: 98px;
            margin-left: 0;
            padding: 4px 6px;
            box-sizing: border-box;
            text-align: left;
            background: rgba(28, 32, 32, .9);
            color: #edf0f3;
            line-height: 18px;
            border-radius: 3px;
            font-variant-numeric: tabular-nums;

            span { display: block; overflow-wrap: anywhere; }
            .track-id { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
            .semantic { border-left: 3px solid; padding-left: 5px; }
        }
    }
</style>
