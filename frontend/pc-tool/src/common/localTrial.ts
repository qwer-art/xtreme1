import type Editor from './Editor';
import { ColorModeEnum } from 'pc-editor';
import { hasPairedFrames, loadTrialScene, scans, setSceneFilter } from './trialScene';
import { detectionColors } from './trialDetectionColors';
import { initializeTrialDatabase, scanCatalog } from './trialAnnotationStore';

export const localTrial = import.meta.env.DEV && location.pathname === '/local-trial';
export const trialDisplay = { background: '#2b3031', points: '#b3bfb3', pointSize: 2 };

export async function initLocalFrame(editor: Editor) {
    await loadTrialScene();
    await initializeTrialDatabase(scanCatalog(scans));
    editor.state.config.boxMethod = 'STANDARD';
    editor.state.config.showLabel = true;
    editor.state.config.renderProjectPoint = true;
    editor.state.config.pointColorMode = ColorModeEnum.PURE;
    editor.state.config.singleColor = trialDisplay.points;
    editor.state.config.pointSize = trialDisplay.pointSize;
    editor.viewManager.updateBackgroundColor(trialDisplay.background);
    editor.pc.material.setUniforms({
        colorMode: editor.state.config.pointColorMode,
        singleColor: editor.state.config.singleColor,
        pointSize: editor.state.config.pointSize,
    });
    Object.assign(editor.bsState, { datasetId: scans[0].sceneId, datasetName: scans[0].sourceDataset,
        datasetType: 'LIDAR_FUSION', user: { id: 'local', nickname: 'Local' } });
    editor.setClassTypes(Object.entries({ ...detectionColors, Cyclist: '#70d18a' })
        .map(([name, color]) => ({ id: name, name, label: name, color, attrs: [] })));
    editor.state.config.showImgView = hasPairedFrames.value;
    setSceneFilter(editor, hasPairedFrames.value ? 'key' : 'all');
}

export { readLocalObjects, saveLocalFrames } from './trialAnnotations';