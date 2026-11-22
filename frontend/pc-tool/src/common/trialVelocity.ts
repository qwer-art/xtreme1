import { Matrix3, Matrix4, Vector3 } from 'three';
import type { TrialFrame } from './trialAnnotationStore';

type MotionScan = { timestamp: number; worldFromLidar: number[] };
type Center = [number, number, number];

export interface BoxVelocity {
    status: 'computed' | 'insufficient_track' | 'missing_pose';
    world_xy_mps: [number, number] | null;
    speed_mps: number | null;
    interval_s: number | null;
    reference_scan_id: string | null;
}

export function withBoxMetadata(frames: TrialFrame[], scans: readonly {
    id: string; timestamp: number; worldFromLidar?: number[];
}[]): TrialFrame[] {
    const poses = new Map(scans.map(scan => [scan.id, scan]));
    const tracks = new Map<string, { frame: TrialFrame; center: Center }[]>();
    for (const frame of frames) for (const box of frame.boxes) {
        const observations = tracks.get(box.track_id) || [];
        observations.push({ frame, center: box.center });
        tracks.set(box.track_id, observations);
    }
    for (const observations of tracks.values()) observations.sort((left, right) => left.frame.timestamp_us - right.frame.timestamp_us);
    return frames.map(frame => ({ ...frame, boxes: frame.boxes.map((box, index) => {
        const observations = tracks.get(box.track_id)!;
        const position = observations.findIndex(observation => observation.frame === frame);
        const neighbors = [observations[position - 1], observations[position + 1]]
            .filter(observation => observation && observation.frame.timestamp_us !== frame.timestamp_us)
            .sort((left, right) => Math.abs(left.frame.timestamp_us - frame.timestamp_us) - Math.abs(right.frame.timestamp_us - frame.timestamp_us));
        const neighbor = neighbors[0];
        const velocity: BoxVelocity = { status: 'insufficient_track', world_xy_mps: null,
            speed_mps: null, interval_s: null, reference_scan_id: null };
        if (neighbor) {
            velocity.reference_scan_id = neighbor.frame.scan_id;
            velocity.interval_s = Math.abs(frame.timestamp_us - neighbor.frame.timestamp_us) / 1e6;
            const current = poses.get(frame.scan_id), other = poses.get(neighbor.frame.scan_id);
            const validPose = (scan: typeof current): scan is typeof scans[number] & MotionScan =>
                !!scan && scan.worldFromLidar?.length === 16 && scan.worldFromLidar.every(Number.isFinite);
            const worldXY = validPose(current) && validPose(other)
                ? trackVelocity({ ...current, timestamp: frame.timestamp_us }, box.center,
                    { ...other, timestamp: neighbor.frame.timestamp_us }, neighbor.center) : undefined;
            if (worldXY?.every(Number.isFinite)) {
                velocity.status = 'computed'; velocity.world_xy_mps = worldXY;
                velocity.speed_mps = Math.hypot(...worldXY);
            } else velocity.status = 'missing_pose';
        }
        return { ...box, idx: index + 1, velocity };
    }) }));
}

export function scanVelocity(worldXY: readonly [number, number], scan: MotionScan) {
    const worldToScan = new Matrix4().fromArray(scan.worldFromLidar).invert();
    return new Vector3(...worldXY, 0).applyMatrix3(new Matrix3().setFromMatrix4(worldToScan));
}

export function trackVelocity(current: MotionScan, center: Center, other: MotionScan, otherCenter: Center): [number, number] | undefined {
    const seconds = (current.timestamp - other.timestamp) / 1e6;
    if (!seconds || !Number.isFinite(seconds)) return;
    const world = new Vector3(...center).applyMatrix4(new Matrix4().fromArray(current.worldFromLidar));
    const previous = new Vector3(...otherCenter).applyMatrix4(new Matrix4().fromArray(other.worldFromLidar));
    return [(world.x - previous.x) / seconds, (world.y - previous.y) / seconds];
}