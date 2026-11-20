import type Editor from './Editor';
import { SourceType, IFrame } from 'pc-editor';

export interface TrialScan {
    id: string;
    timestamp: number;
    keyframe: boolean;
    pointsUrl: string;
    worldFromLidar: number[];
    viewsUrl: string | null;
    sampleToken: string;
}

export let scans: TrialScan[] = [];
const frameCache = new WeakMap<Editor, IFrame[]>();

export function setSceneFilter(editor: Editor, mode: 'all' | 'key', source = '') {
    let frames = frameCache.get(editor);
    if (!frames) {
        frames = scans.map((scan): IFrame => ({ id: scan.id, datasetId: 'local', pointsUrl: scan.pointsUrl,
            queryTime: '', loadState: '', needSave: false, classifications: [], dataStatus: 'VALID',
            annotationStatus: 'NOT_ANNOTATED', skipped: false, sources: [{ name: 'Without Task',
                sourceId: editor.state.config.withoutTaskId, sourceType: SourceType.DATA_FLOW }] }));
        frameCache.set(editor, frames);
    }
    const visible = mode === 'all' ? scans : scans.filter(scan => scan.keyframe);
    editor.setFrames(mode === 'all' ? frames : frames.filter((frame, index) => scans[index].keyframe));
    const time = scans.find(scan => scan.id === source)?.timestamp ?? visible[0].timestamp;
    return visible.reduce((best, scan, index) => Math.abs(scan.timestamp - time) <
        Math.abs(visible[best].timestamp - time) ? index : best, 0);
}

export async function loadTrialScene() {
    const response = await fetch('/local-scene/index.json');
    if (!response.ok) throw new Error(`Local scene manifest: HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest.scene !== 'scene-0061' || !Array.isArray(manifest.scans) || !manifest.scans.length) {
        throw new Error('Expected a non-empty scene-0061 scan manifest');
    }
    scans = manifest.scans;
    return scans;
}