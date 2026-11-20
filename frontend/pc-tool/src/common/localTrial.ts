import type Editor from './Editor';
import { utils, SourceType, IFrame, IObjectV2 } from 'pc-editor';

export const localTrial = import.meta.env.DEV && location.pathname === '/local-trial';
const frameId = 'ca9a282c9e77460f8360f564131a8af5';
const storageKey = (id: string) => `xtreme1:local-trial:v1:${id}`;

export function initLocalFrame(editor: Editor) {
    editor.state.config.boxMethod = 'STANDARD';
    Object.assign(editor.bsState, { datasetId: 'local', datasetName: 'nuScenes scene-0061',
        datasetType: 'LIDAR_FUSION', user: { id: 'local', nickname: 'Local' } });
    editor.setClassTypes([['Car', '#54bfff'], ['Pedestrian', '#ffbc57'], ['Cyclist', '#70d18a']]
        .map(([name, color]) => ({ id: name, name, label: name, color, attrs: [] })));
    editor.setFrames([{ id: frameId, datasetId: 'local', pointsUrl: '/local-frame/points.pcd',
        queryTime: '', loadState: '', needSave: false, classifications: [], dataStatus: 'VALID',
        annotationStatus: 'NOT_ANNOTATED', skipped: false, sources: [{ name: 'Without Task',
            sourceId: editor.state.config.withoutTaskId, sourceType: SourceType.DATA_FLOW }] }]);
}

interface LocalObject { frontId: string; classId: string; classAttributes: IObjectV2 }

export function saveLocalFrames(frames: { dataId: string; objects: LocalObject[] }[]) {
    frames.forEach(frame => localStorage.setItem(storageKey(frame.dataId), JSON.stringify(frame)));
}

export function readLocalObjects(frame: IFrame | IFrame[]) {
    const objectsMap = Object.fromEntries((Array.isArray(frame) ? frame : [frame]).map(item => {
        const saved = localStorage.getItem(storageKey(item.id));
        const objects: LocalObject[] = saved ? JSON.parse(saved).objects : [];
        return [item.id, objects.map(object => utils.translateToObject({
            ...object.classAttributes, frontId: object.frontId,
        }))];
    }));
    return { objectsMap, classificationMap: {}, queryTime: new Date().toISOString() };
}