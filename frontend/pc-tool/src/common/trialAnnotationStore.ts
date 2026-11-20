import type { IObjectV2 } from 'pc-editor';

type Triple = [number, number, number];
export interface TrialBox {
    bbox_id: string;
    track_id: string;
    track_name: string;
    class_id: string;
    center: Triple;
    size: Triple;
    rotation: Triple;
}
const scene = 'scene-0061';
const geometry = {
    coordinate_frame: 'LIDAR_TOP (current scan)', length_unit: 'meters',
    size_order: 'box-local XYZ: length, width, height',
    orientation: 'intrinsic XYZ Euler radians', yaw_direction: 'right-handed about +Z (+X toward +Y)',
} as const;
export interface TrialFrame { scene_id: typeof scene; scan_id: string; timestamp_us: number; boxes: TrialBox[] }
export interface TrialDocument { version: 3; scene: typeof scene; geometry: typeof geometry; frames: TrialFrame[] }
type Catalog = ReadonlyMap<string, number>;
interface NativeFrame {
    dataId: string;
    objects: { frontId: string; classId?: string; classAttributes: IObjectV2 }[];
}

const key = 'xtreme1:local-trial:v3:scene-0061';
const v2Key = 'xtreme1:local-trial:v2:scene-0061';
const legacyKey = 'xtreme1:local-trial:v1:ca9a282c9e77460f8360f564131a8af5';
const legacyScan = '9d9bf11fb0e144c8b446d54a8a00184f';

export function validId(value: unknown): value is string {
    return typeof value === 'string' && value.trim() === value && value.length > 0 &&
        value.length <= 256 && !(value in Object.prototype) && value !== 'prototype';
}
function triple(value: unknown, positive = false): value is Triple {
    return Array.isArray(value) && value.length === 3 &&
        Array.from(value).every(n => Number.isFinite(n) && (!positive || n > 0));
}
export function scanCatalog(scans: ReadonlyArray<{ id: string; timestamp: number }>): Catalog {
    if (!scans.length) throw new Error('Trial scan manifest not loaded');
    const catalog = new Map<string, number>();
    for (const { id, timestamp } of scans) {
        if (!validId(id) || catalog.has(id) || !Number.isSafeInteger(timestamp) || timestamp <= 0)
            throw new Error(`Invalid scan manifest entry: ${id}`);
        catalog.set(id, timestamp);
    }
    return catalog;
}
export function validateDocument(input: unknown, catalog: Catalog): TrialDocument {
    const doc = input as TrialDocument;
    if (doc?.version !== 3 || doc.scene !== scene || !Array.isArray(doc.frames) ||
        !Object.entries(geometry).every(([field, value]) => doc.geometry?.[field as keyof typeof geometry] === value))
        throw new Error('Expected scene-0061 version 3 and matching LiDAR geometry convention');
    const frames = new Map<string, TrialFrame>(), seenBoxes = new Set<string>();
    for (const frame of doc.frames) {
        if (!catalog.has(frame?.scan_id) || frames.has(frame.scan_id) || frame.scene_id !== scene ||
            frame.timestamp_us !== catalog.get(frame.scan_id) || !Array.isArray(frame.boxes))
            throw new Error(`Unknown, duplicate or mismatched scan: ${frame?.scan_id}`);
        const tracks = new Set<string>();
        const boxes = frame.boxes.map(box => {
            if (!validId(box?.bbox_id) || seenBoxes.has(box.bbox_id) || !validId(box.track_id) ||
                tracks.has(box.track_id) || typeof box.track_name !== 'string' ||
                typeof box.class_id !== 'string' || !triple(box.center) || !triple(box.size, true) || !triple(box.rotation))
                throw new Error(`Invalid or duplicate box/track in ${frame.scan_id}: ${box?.bbox_id}`);
            seenBoxes.add(box.bbox_id);
            tracks.add(box.track_id);
            return { bbox_id: box.bbox_id, track_id: box.track_id, track_name: box.track_name || box.track_id,
                class_id: box.class_id, center: [...box.center] as Triple, size: [...box.size] as Triple,
                rotation: [...box.rotation] as Triple };
        });
        frames.set(frame.scan_id, { scene_id: scene, scan_id: frame.scan_id, timestamp_us: frame.timestamp_us, boxes });
    }
    if (frames.size !== catalog.size) throw new Error('Missing scans in annotation document');
    return { version: 3, scene, geometry: { ...geometry }, frames: Array.from(catalog.keys(), id => frames.get(id)!) };
}

function packFrame(frame: NativeFrame): Pick<TrialFrame, 'scan_id' | 'boxes'> {
    const xyz = (v: { x: number; y: number; z: number } | undefined): Triple => {
        if (!v) throw new Error(`Missing box geometry in ${frame.dataId}`);
        return [v.x, v.y, v.z];
    };
    return { scan_id: frame.dataId, boxes: frame.objects.map(({ frontId, classId, classAttributes: obj }) => {
        if (obj.type !== '3D_BOX' && obj.type !== '3d') throw new Error('Trial supports LiDAR cuboids only');
        return { bbox_id: frontId, track_id: obj.trackId || frontId, track_name: obj.trackName || obj.trackId || frontId,
            class_id: classId || obj.classId || '', center: xyz(obj.contour.center3D),
            size: xyz(obj.contour.size3D), rotation: xyz(obj.contour.rotation3D) };
    }) };
}

export function loadDocument(catalog: Catalog): TrialDocument {
    const saved = localStorage.getItem(key);
    if (saved !== null) return validateDocument(JSON.parse(saved), catalog);
    const old = localStorage.getItem(v2Key);
    let frames: Pick<TrialFrame, 'scan_id' | 'boxes'>[] = [];
    if (old !== null) {
        const doc = JSON.parse(old);
        if (doc?.version !== 2 || doc.scene !== scene || !Array.isArray(doc.frames)) throw new Error('Invalid v2 storage');
        frames = doc.frames;
    } else {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy !== null) frames = [packFrame({ ...JSON.parse(legacy), dataId: legacyScan })];
    }
    const known = new Set(frames.map(frame => frame.scan_id));
    const missing = [...catalog.keys()].filter(id => !known.has(id)).map(scan_id => ({ scan_id, boxes: [] }));
    return validateDocument({ version: 3, scene, geometry, frames: [...frames, ...missing].map(frame =>
        ({ ...frame, scene_id: scene, timestamp_us: catalog.get(frame.scan_id) })) }, catalog);
}

export function replaceDocument(input: unknown, catalog: Catalog) {
    localStorage.setItem(key, JSON.stringify(validateDocument(input, catalog)));
}

export function saveFrames(frames: NativeFrame[], catalog: Catalog) {
    const document = loadDocument(catalog);
    const byId = new Map(document.frames.map(frame => [frame.scan_id, frame]));
    const seen = new Set<string>();
    for (const frame of frames) {
        const previous = byId.get(frame.dataId);
        if (!previous || seen.has(frame.dataId)) throw new Error(`Unknown or duplicate scan: ${frame.dataId}`);
        seen.add(frame.dataId);
        byId.set(frame.dataId, { ...previous, ...packFrame(frame) });
    }
    replaceDocument({ ...document, frames: [...byId.values()] }, catalog);
}