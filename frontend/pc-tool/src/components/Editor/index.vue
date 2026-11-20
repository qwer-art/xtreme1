<template>
    <div class="pc-editor">
        <div class="pc-editor-layout" :class="{ 'trial-layout': localTrial }">
            <div class="business-container"><Header /></div>
            <div class="content-container-wrap">
                <div class="content-container">
                    <div class="tool-container">
                        <Tool />
                    </div>
                    <Main />
                    <div class="operation-container">
                        <Operation />
                    </div>
                </div>
                <Loading />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { reactive, onMounted } from 'vue';

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

    onMounted(() => {
        editor.registerModal('ModelHelp', ModelHelp);
        editor.registerModal('ModalConfirm', ModalConfirm);
    });
</script>

<style lang="less">
    .pc-editor {
        width: 100%;
        height: 100%;
        position: relative;
        background: #3a393e;

        .pc-editor-layout {
            &.trial-layout {
                height: 100%;
                display: grid;
                grid-template-rows: auto minmax(0, 1fr);
                .business-container, .content-container-wrap { position: relative; inset: auto; height: auto; min-width: 0; }
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
