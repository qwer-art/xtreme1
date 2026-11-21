import { Euler, Matrix4, MathUtils, Vector3 } from 'three';
import { Box } from 'pc-render';
import { IFrame, ObjectType, utils } from 'pc-editor';
import type Editor from './Editor';
import { scans } from './trialScene';
import { loadDocument, replaceDocument, saveFrames, scanCatalog, validId, validateDocument } from './trialAnnotationStore';
import type { TrialBox, TrialDocument } from './trialAnnotationStore';

const vector = (coords: [number, number, number]) => new Vector3(...coords);

const configuredEditors = new WeakSet<Editor>();
export function configureTrialCreation(editor: Editor) {
    if (configuredEditors.has(editor)) return;
    const create = editor.createAnnotate3D.bind(editor);
    editor.createAnnotate3D = (position, size, rotation, data = {}) => {
        if (!data.id) {
            data.id = MathUtils.generateUUID();
            data.trackId = editor.createTrackId();
            data.trackName = editor.getId();
        }
        return create(position, size, rotation, data);
    };
    configuredEditors.add(editor);
}

function nativeObject(box: TrialBox) {
    return utils.translateToObject({ type: ObjectType.TYPE_3D_BOX, frontId: box.bbox_id,
        classId: box.class_id, trackId: box.track_id, trackName: box.track_name,
        contour: { center3D: vector(box.center), size3D: vector(box.size), rotation3D: vector(box.rotation) } });
}

export function readLocalObjects(frame: IFrame | IFrame[]) {
    const saved = new Map(loadDocument(scanCatalog(scans)).frames.map(item => [item.scan_id, item.boxes]));
    const objectsMap = Object.fromEntries((Array.isArray(frame) ? frame : [frame]).map(item =>
        [item.id, (saved.get(item.id) || []).map(nativeObject)]));
    return { objectsMap, classificationMap: {}, queryTime: new Date().toISOString() };
}

export function saveLocalFrames(frames: Parameters<typeof saveFrames>[0]) {
    saveFrames(frames, scanCatalog(scans));
}

function selected(editor: Editor) {
    const selection = editor.pc.selection;
    const frame = editor.getCurrentFrame();
    const box = selection[0];
    return frame && selection.length === 1 && box instanceof Box &&
        editor.dataManager.getFrameObject(frame.id)?.includes(box) ? box : null;
}

export interface TrialSnapshot { scan_id: string; box: TrialBox }
export function captureSelected(editor: Editor): TrialSnapshot | null {
    const object = selected(editor);
    if (!object) return null;
    const { trackId, trackName, classId } = object.userData;
    return { scan_id: editor.getCurrentFrame().id, box: { bbox_id: object.uuid, track_id: trackId,
        track_name: trackName, class_id: classId || '', center: [object.position.x, object.position.y, object.position.z],
        size: [object.scale.x, object.scale.y, object.scale.z], rotation: [object.rotation.x, object.rotation.y, object.rotation.z] } };
}

function requireFreeTrack(editor: Editor, trackId: string, except?: Box) {
    const objects = editor.dataManager.getFrameObject(editor.getCurrentFrame()?.id);
    if (!objects) throw new Error('Current scan is not loaded');
    if (objects.some(obj => obj !== except && obj instanceof Box && obj.userData.trackId === trackId))
        throw new Error(`Track already has a box on this scan: ${trackId}`);
}

export function copySelected(editor: Editor, snapshot: TrialSnapshot): Box {
    const source = scans.find(scan => scan.id === snapshot.scan_id);
    const target = scans.find(scan => scan.id === editor.getCurrentFrame()?.id);
    if (!source || !target || source.id === target.id) throw new Error('Select a different destination scan');
    const box = snapshot.box;
    requireFreeTrack(editor, box.track_id);
    const transform = new Matrix4().fromArray(target.worldFromLidar).invert()
        .multiply(new Matrix4().fromArray(source.worldFromLidar));
    const position = vector(box.center).applyMatrix4(transform);
    const orientation = transform.multiply(new Matrix4().makeRotationFromEuler(new Euler(...box.rotation)));
    const copy = editor.createAnnotate3D(position, vector(box.size), new Euler().setFromRotationMatrix(orientation),
        { id: MathUtils.generateUUID(), classId: box.class_id, classType: box.class_id,
            trackId: box.track_id, trackName: box.track_name });
    editor.cmdManager.withGroup(() => {
        editor.cmdManager.execute('add-object', copy);
        editor.cmdManager.execute('select-object', copy);
    });
    return copy;
}

function trackNames(editor: Editor) {
    const tracks = new Map<string, string>();
    const cache = editor.dataManager.dataMap;
    for (const frame of loadDocument(scanCatalog(scans)).frames) {
        if (!cache.has(frame.scan_id)) frame.boxes.forEach(box => tracks.set(box.track_id, box.track_name));
    }
    cache.forEach(objects => objects.forEach(obj => {
        if (obj instanceof Box) tracks.set(obj.userData.trackId, obj.userData.trackName);
    }));
    return tracks;
}

export function listTracks(editor: Editor): string[] { return [...trackNames(editor).keys()].sort(); }

export function assignTrack(editor: Editor, trackId: string): void {
    const box = selected(editor);
    if (!box || !validId(trackId)) throw new Error('Select one cuboid and specify a valid track ID');
    if (box.userData.trackId === trackId) return;
    requireFreeTrack(editor, trackId, box);
    const trackName = trackNames(editor).get(trackId) || trackId;
    editor.cmdManager.withGroup(() => {
        editor.cmdManager.execute('update-object-user-data', { objects: box, data: { trackId, trackName } });
    });
    editor.updateTrack();
}

async function flush(editor: Editor) {
    if (editor.bsState.saving) throw new Error('Save already in progress');
    await editor.saveObject();
    if (editor.needSave()) throw new Error('Could not save local edits');
}

export async function exportAnnotations(editor: Editor): Promise<TrialDocument> {
    await flush(editor);
    return loadDocument(scanCatalog(scans));
}

function snapshotMap<Key, Value>(map: Map<Key, Value>) {
    const entries = [...map];
    return () => { map.clear(); entries.forEach(([key, value]) => map.set(key, value)); };
}

export async function importAnnotations(editor: Editor, data: unknown): Promise<void> {
    if (editor.bsState.saving) throw new Error('Save already in progress');
    const catalog = scanCatalog(scans);
    const doc = validateDocument(typeof data === 'string' ? JSON.parse(data) : data, catalog);
    const frames = new Map(doc.frames.map(frame => [frame.scan_id, frame.boxes]));
    for (const frame of doc.frames) for (const box of frame.boxes) {
        if (box.class_id && !editor.getClassType(box.class_id)) throw new Error(`Unknown class: ${box.class_id}`);
    }
    const staged = editor.state.frames.map(frame => {
        const boxes = frames.get(frame.id);
        if (!boxes) throw new Error(`Unknown editor scan: ${frame.id}`);
        return { frame, dirty: frame.needSave, objects: utils.convertObject2Annotate(boxes.map(nativeObject), editor) };
    });
    const { dataManager, trackManager, cmdManager } = editor;
    const restore = [snapshotMap(dataManager.dataMap), snapshotMap(dataManager.hasMap),
        snapshotMap(trackManager.trackMap), snapshotMap(trackManager.trackInfo)];
    const selection = [...editor.pc.selection], track = editor.currentTrack, name = editor.currentTrackName;
    const { cmds, index } = cmdManager, count = editor.idCount;
    try {
        dataManager.clear();
        dataManager.hasMap.clear();
        trackManager.clear();
        for (const { frame, objects } of staged) {
            dataManager.setFrameObject(frame.id, objects);
            dataManager.hasMap.set(frame.id, new Map(objects.map(obj => [obj.uuid, obj])));
            frame.needSave = false;
        }
        editor.pc.selectObject();
        editor.setCurrentTrack(undefined, '');
        if (editor.state.isSeriesFrame) editor.loadManager.updateTrackMap();
        if (editor.getCurrentFrame()) {
            dataManager.loadDataFromManager();
            editor.updateIDCounter();
        }
        cmdManager.reset();
        replaceDocument(doc, catalog);
    } catch (error) {
        restore.forEach(undo => undo());
        staged.forEach(({ frame, dirty }) => { frame.needSave = dirty; });
        cmdManager.cmds = cmds;
        cmdManager.index = index;
        editor.idCount = count;
        if (editor.getCurrentFrame()) dataManager.loadDataFromManager();
        editor.pc.selectObject(selection);
        editor.setCurrentTrack(track, name);
        throw error;
    }
}

export type TrialGeometry = { center: [number, number, number]; size: [number, number, number]; yaw: number };
export function getSelectedGeometry(editor: Editor): TrialGeometry | null {
    const box = selected(editor);
    if (!box) return null;
    return {
        center: [box.position.x, box.position.y, box.position.z],
        size: [box.scale.x, box.scale.y, box.scale.z],
        yaw: box.rotation.z,
    };
}

export function updateSelectedGeometry(editor: Editor, geometry: TrialGeometry): void {
    const box = selected(editor);
    if (!box) throw new Error('请先选中一个三维框');
    if (!geometry.center.every(Number.isFinite) || !geometry.size.every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(geometry.yaw))
        throw new Error('几何参数无效');
    editor.cmdManager.execute('update-transform', {
        object: box,
        transform: {
            position: vector(geometry.center),
            scale: vector(geometry.size),
            rotation: new Euler(0, 0, geometry.yaw),
        },
    });
    editor.updateTrack();
}