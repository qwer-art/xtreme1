<template>
    <div class="pc-editor">
        <div class="pc-editor-layout" :class="{ 'trial-layout': localTrial, 'rail-open': railOpen }">
            <div class="business-container"><Header :rail-open="railOpen" @toggle-rail="railOpen = !railOpen" /></div>
            <div class="content-container-wrap">
                <div class="content-container">
                    <div class="tool-container">
                        <Tool />
                    </div>
                    <Main />
                    <Teleport v-if="!localTrial || dockedReview !== null" :to="localTrial ? '#trial-review-dock' : 'body'" :disabled="!dockedReview">
                        <div class="operation-container">
                            <Operation @show-rail="railOpen = true" />
                        </div>
                    </Teleport>
                </div>
                <Loading />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref, onMounted, onBeforeUnmount } from 'vue';

    import { useProvideEditor } from '../../state';
    import { localTrial } from '../../common/localTrial';

    import Header from '../Header/index.vue';
    import Operation from '../Operation/index.vue';
    import Tool from '../Tool/index.vue';
    import Main from './main.vue';

    import Loading from '../Modal/Loading.vue';

    import ModelHelp from '../Modal/sub/ModelHelp.vue';
    import ModalConfirm from '../Modal/sub/ModalConfirm.vue';

    let editor = useProvideEditor();
    const railOpen = ref(false);
    const desktop = localTrial ? window.matchMedia('(min-width: 851px)') : null;
    const dockedReview = ref<boolean | null>(null);
    const updateDock = () => { dockedReview.value = !!desktop?.matches; };

    onMounted(() => {
        updateDock();
        desktop?.addEventListener('change', updateDock);
        editor.registerModal('ModelHelp', ModelHelp);
        editor.registerModal('ModalConfirm', ModalConfirm);
    });
    onBeforeUnmount(() => desktop?.removeEventListener('change', updateDock));
</script>

<style lang="less">
    .pc-editor {
        width: 100%;
        height: 100%;
        position: relative;
        background: #3a393e;

        .pc-editor-layout {
            &.trial-layout {
                --review-width: clamp(290px, 23%, 420px);
                height: 100%;
                display: grid;
                grid-template-rows: auto minmax(0, 1fr);
                .business-container, .content-container-wrap { position: relative; inset: auto; height: auto; min-width: 0; }
                .main-container { right: var(--review-width); bottom: 0; }
                .tool-container { bottom: 0; }
                .operation-container { width: var(--review-width); top: 0; bottom: 0; box-sizing: border-box; padding: 0; background: #24252a; border: 0; border-left: 1px solid #50525a; }
                @media (min-width: 851px) {
                    .main-container { right: 0; }
                    .trial-review-dock > .operation-container { position: relative; width: 100%; height: 100%; }
                }
                @media (max-width: 680px) {
                    .main-container { right: 0; }
                    .operation-container { display: none; width: min(360px, calc(100% - 50px)); z-index: 4; }
                    &.rail-open .operation-container { display: block; }
                }
            }
            .business-container {
                position: absolute;
                top: 0px;
                left: 0px;
                right: 0px;
                height: 54px;
                background: #1e1f23;
            }

            .content-container-wrap {
                position: absolute;
                top: 54px;
                left: 0px;
                right: 0px;
                bottom: 0px;
                padding: 6px 0px;
            }

            .content-container {
                height: 100%;
                position: relative;
            }

            .tool-container {
                position: absolute;
                top: 0px;
                left: 0px;
                width: 50px;
                bottom: 0px;
            }

            .main-container {
                position: absolute;
                top: 0px;
                left: 50px;
                right: 270px;
                bottom: 0px;
            }

            .operation-container {
                position: absolute;
                top: 0px;
                right: 0px;
                width: 270px;
                bottom: 0px;
                padding-left: 6px;
                padding-right: 6px;
                border-left: 1px solid #545454;
            }

            @media (max-width: 850px) {
                .main-container { right: 0; bottom: 18%; }
                .tool-container { bottom: 18%; }
                .operation-container {
                    top: 82%;
                    width: 100%;
                    overflow: auto;
                    border-left: 0;
                    border-top: 1px solid #545454;
                }
            }
        }
    }
</style>
