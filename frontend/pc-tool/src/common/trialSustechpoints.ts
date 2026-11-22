import type { TrialBox, TrialDocument } from './trialAnnotationStore';

type Triple = [number, number, number];
interface NativeBox {
    obj_id: string;
    obj_type: string;
    psr: Record<'position' | 'scale' | 'rotation', { x: number; y: number; z: number }>;
}
export interface SustechDocument {
    scene: string;
    trackIds: Record<string, string>;
    scanIds: Record<string, string>;
    candidateIds: Record<string, Record<string, string>>;
    frames: Record<string, NativeBox[]>;
}

const xyz = (value: { x: number; y: number; z: number }): Triple => [value.x, value.y, value.z];
const components = ['position', 'scale', 'rotation'] as const;
const axes = ['x', 'y', 'z'] as const;
const classId = (type: string) => type === 'BicycleRider' ? 'Cyclist' : type;
const sameBox = (left: NativeBox, right: NativeBox) => classId(left.obj_type) === classId(right.obj_type) &&
    components.every(component => axes.every(axis =>
        left.psr[component][axis] === right.psr[component][axis]));

export function mergeSustechpoints(working: TrialDocument, baseline: SustechDocument,
    updates: { scene: string; frame: string; annotation: NativeBox[] }[]) {
    if (working.scene !== baseline.scene) throw new Error('补标场景与当前标注台不一致');
    const document: TrialDocument = JSON.parse(JSON.stringify(working));
    const tracks = new Map(Object.entries(baseline.trackIds).map(([track, id]) => [id, track]));
    const reviews: { scanId: string; candidateId: string; decision: 'accepted' | 'rejected' }[] = [];
    const seen = new Set<string>();
    for (const update of updates) {
        const frame = document.frames.find(frame => frame.scan_id === baseline.scanIds[update.frame]);
        if (!frame || update.scene !== baseline.scene || seen.has(update.frame)) throw new Error('补标帧无效或重复');
        seen.add(update.frame);
        const original = new Map(baseline.frames[update.frame].map(box => [box.obj_id, box]));
        const ids = new Set<string>();
        for (const box of update.annotation) {
            if (!/^\d{1,12}$/.test(box.obj_id) || ids.has(box.obj_id)) throw new Error('同一帧的目标 ID 必须唯一');
            ids.add(box.obj_id);
            if (!box.obj_type || !components.every(component =>
                axes.every(axis => Number.isFinite(box.psr?.[component]?.[axis]) &&
                    (component !== 'scale' || box.psr[component][axis] > 0)))) throw new Error('补标框几何或类别无效');
            const previous = original.get(box.obj_id);
            if (previous && sameBox(previous, box)) continue;
            const sourceTrack = tracks.get(box.obj_id);
            const trackId = sourceTrack && !sourceTrack.startsWith('untracked:') ? sourceTrack : `sustech-${box.obj_id}`;
            const existing = frame.boxes.findIndex(saved => saved.track_id === trackId);
            const saved: TrialBox = { bbox_id: existing >= 0 ? frame.boxes[existing].bbox_id : `sustech-${frame.scan_id}-${box.obj_id}`,
                track_id: trackId, track_name: existing >= 0 ? frame.boxes[existing].track_name : box.obj_id,
                class_id: classId(box.obj_type), center: xyz(box.psr.position), size: xyz(box.psr.scale), rotation: xyz(box.psr.rotation) };
            if (existing >= 0) frame.boxes[existing] = saved;
            else frame.boxes.push(saved);
            const candidateId = baseline.candidateIds[update.frame]?.[box.obj_id];
            if (candidateId) reviews.push({ scanId: frame.scan_id, candidateId, decision: 'accepted' });
        }
        for (const [id] of original) {
            if (ids.has(id)) continue;
            const trackId = tracks.get(id) || `sustech-${id}`;
            frame.boxes = frame.boxes.filter(box => box.track_id !== trackId);
            const candidateId = baseline.candidateIds[update.frame]?.[id];
            if (candidateId) reviews.push({ scanId: frame.scan_id, candidateId, decision: 'rejected' });
        }
    }
    return { document, reviews };
}