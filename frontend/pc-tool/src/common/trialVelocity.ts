import { Matrix3, Matrix4, Vector3 } from 'three';

type MotionScan = { timestamp: number; worldFromLidar: number[] };
type Center = [number, number, number];

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