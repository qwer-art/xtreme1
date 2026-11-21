import type { Candidate, Triple } from './trialCandidates';
import { validId } from './trialAnnotationStore';
import { detectionColors } from './trialDetectionColors';

const scene = 'scene-0061';
const url = '/local-scene/centerpoint.json';
export interface CenterPointCandidate extends Candidate { sourceId: string; score: number; accepting?: boolean }
export type CenterPointFrames = Record<string, unknown>;

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function triple(value: unknown): value is Triple {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

export async function loadCenterPoint(refreshKey?: string): Promise<CenterPointFrames> {
    const source = refreshKey === undefined ? url : `${url}?run=${encodeURIComponent(refreshKey)}`;
    const response = await fetch(source, { cache: 'no-store' });
    if (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))
        throw new Error(`缺少 CenterPoint 离线结果：${url}`);
    if (!response.ok) throw new Error(`CenterPoint 离线结果读取失败：HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!record(data) || data.model !== 'CenterPoint' || data.scene !== scene || !record(data.frames))
        throw new Error(`CenterPoint 离线结果格式错误或场景不是 ${scene}`);
    return data.frames;
}

export function centerPointFrame(frames: CenterPointFrames, scanId: string): CenterPointCandidate[] | undefined {
    if (!Object.prototype.hasOwnProperty.call(frames, scanId)) return undefined;
    const rows = frames[scanId];
    if (!Array.isArray(rows)) throw new Error(`CenterPoint 帧格式错误：${scanId}`);
    const ids = new Set<string>();
    return rows.map((row: unknown, index) => {
        if (!record(row) || !validId(row.id) || !validId(`centerpoint:${scanId}:${row.id}`) ||
            ids.has(row.id) || (row.trackId !== null && !validId(row.trackId)) ||
            typeof row.category !== 'string' || !Object.prototype.hasOwnProperty.call(detectionColors, row.category) || !triple(row.center) ||
            !triple(row.size) || row.size.some(value => value <= 0) || typeof row.yaw !== 'number' ||
            !Number.isFinite(row.yaw) || typeof row.score !== 'number' || !Number.isFinite(row.score) ||
            row.score < 0 || row.score > 1) throw new Error(`CenterPoint 帧 ${scanId} 第 ${index + 1} 个候选无效`);
        ids.add(row.id);
        const trackId = typeof row.trackId === 'string' ? row.trackId : `single:${scanId}:${row.id}`;
        return { id: `centerpoint:${scanId}:${row.id}`, sourceId: row.id, scanId, trackId,
            trackName: row.trackId === null ? '未跟踪' : trackId, category: row.category, score: row.score, center: [...row.center],
            size: [...row.size], yaw: row.yaw, elapsed_ms: 0, indices: [] };
    });
}

type Decision = 'adjusted' | 'accepting' | 'accepted' | 'rejected';
function reviewKey(item: CenterPointCandidate) { return `xtreme1:local-trial:review:v1:${scene}:${item.id}`; }

export function writeReview(item: CenterPointCandidate, decision: Decision) {
    const { center, size, yaw, trackId, score, category } = item;
    localStorage.setItem(reviewKey(item), JSON.stringify({ decision, center, size, yaw, trackId, score,
        category, reviewedAt: new Date().toISOString() }));
}

export function pendingReview(item: CenterPointCandidate, savedBox: (id: string) => boolean) {
    const raw = localStorage.getItem(reviewKey(item));
    if (raw === null) return item;
    const value: unknown = JSON.parse(raw);
    if (!record(value)) throw new Error(`审核记录无效：${item.sourceId}`);
    if (value.decision === 'accepted' || value.decision === 'rejected') return undefined;
    if ((value.decision !== 'adjusted' && value.decision !== 'accepting') || !triple(value.center) ||
        !triple(value.size) || value.size.some(n => n <= 0) || typeof value.yaw !== 'number' || !Number.isFinite(value.yaw))
        throw new Error(`审核记录无效：${item.sourceId}`);
    const adjusted = { ...item, center: value.center, size: value.size, yaw: value.yaw, accepting: value.decision === 'accepting' };
    if (value.decision === 'accepting' && savedBox(item.id)) {
        writeReview(adjusted, 'accepted');
        return undefined;
    }
    return adjusted;
}