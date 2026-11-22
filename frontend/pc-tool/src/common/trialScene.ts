import { Matrix4 } from 'three';
import { shallowRef } from 'vue';
import type Editor from './Editor';
import { SourceType, IFrame } from 'pc-editor';

export interface TrialCamera {
    name: string;
    timestamp: number;
    imgUrl: string;
    imgObject: HTMLImageElement | null;
    imgSize: [number, number];
    cameraInternal: { fx: number; fy: number; cx: number; cy: number };
    cameraExternal: number[];
}

export interface TrialScan {
    sceneId: string;
    sourceDataset: string;
    coordinateFrame: string;
    id: string;
    timestamp: number;
    keyframe: boolean;
    pointsUrl: string;
    worldFromLidar: number[];
    views: TrialCamera[];
    sampleToken?: string;
}

export let scans: TrialScan[] = [];
export const cameraChannels = shallowRef<string[]>([]);
export const hasPairedFrames = shallowRef(false);
const frameCache = new WeakMap<Editor, IFrame[]>();

export function setSceneFilter(editor: Editor, mode: 'all' | 'key', source = '') {
    let frames = frameCache.get(editor);
    if (!frames) {
        frames = scans.map((scan): IFrame => ({ id: scan.id, datasetId: scan.sceneId, pointsUrl: scan.pointsUrl,
            queryTime: '', loadState: '', needSave: false, classifications: [], dataStatus: 'VALID',
            annotationStatus: 'NOT_ANNOTATED', skipped: false, sources: [{ name: 'Without Task',
                sourceId: editor.state.config.withoutTaskId, sourceType: SourceType.DATA_FLOW }] }));
        frameCache.set(editor, frames);
    }
    const visible = mode === 'all' ? scans : scans.filter(scan => scan.views.length > 0);
    editor.setFrames(mode === 'all' ? frames : frames.filter((frame, index) => scans[index].views.length > 0));
    if (!visible.length) throw new Error('场景没有图像与点云配对帧');
    const time = scans.find(scan => scan.id === source)?.timestamp ?? visible[0].timestamp;
    return visible.reduce((best, scan, index) => Math.abs(scan.timestamp - time) <
        Math.abs(visible[best].timestamp - time) ? index : best, 0);
}

export async function loadTrialScene() {
    const [datasetResponse, indexResponse, poseResponse, calibrationResponse] = await Promise.all([
        fetch('/local-scene/dataset.json'), fetch('/local-scene/index.json'),
        fetch('/local-scene/param/pose.json'), fetch('/local-scene/param/calib.json'),
    ]);
    const responses = [datasetResponse, indexResponse, poseResponse, calibrationResponse];
    const failed = responses.find(response => !response.ok);
    if (failed) throw new Error(`Local scene database: HTTP ${failed.status}`);
    const [dataset, index, pose, calibration] = await Promise.all(responses.map(response => response.json()));
    if (dataset.schema !== 'xtreme1-dataset-v1' || index.schema !== 'xtreme1-frame-index-v1' ||
        typeof dataset.scene !== 'string' || index.scene !== dataset.scene || !Array.isArray(index.frames) || !index.frames.length ||
        pose.schema !== 'xtreme1-pose-v1' || calibration.schema !== 'xtreme1-calibration-v1') {
        throw new Error('Expected matching scene manifests, poses and calibration with at least one scan');
    }
    const reference = dataset.coordinateFrame;
    if (typeof reference !== 'string' || !calibration.lidar?.[reference])
        throw new Error(`Missing reference LiDAR calibration: ${reference}`);
    scans = index.frames.map((frame: any): TrialScan => {
        const sensorPoses = pose.frames[String(frame.timestamp)];
        const lidarPose = sensorPoses?.[reference];
        if (lidarPose?.worldFromSensor?.length !== 16) throw new Error(`Missing ${reference} pose at ${frame.timestamp}`);
        const worldFromLidar = new Matrix4().fromArray(lidarPose.worldFromSensor);
        const views = (frame.images || []).map((image: any): TrialCamera => {
            const sensor = calibration.cameras[image.channel];
            const cameraPose = sensorPoses[image.channel];
            if (!sensor || !cameraPose) throw new Error(`Missing ${image.channel} pose/calibration at ${frame.timestamp}`);
            const cameraFromLidar = new Matrix4().fromArray(cameraPose.worldFromSensor).invert().multiply(worldFromLidar);
            return { name: image.channel, timestamp: image.timestamp, imgUrl: `/local-scene/${image.path}`,
                imgObject: null, imgSize: sensor.imageSize, cameraInternal: sensor.cameraInternal,
                cameraExternal: cameraFromLidar.transpose().toArray() };
        });
        return { sceneId: dataset.scene, sourceDataset: dataset.sourceDataset, coordinateFrame: reference, id: frame.id, timestamp: frame.timestamp, keyframe: frame.keyframe,
            pointsUrl: `/local-scene/${frame.cloud}`, worldFromLidar: worldFromLidar.toArray(),
            views, sampleToken: frame.sampleToken };
    });
    cameraChannels.value = dataset.image?.channels ?? Object.keys(calibration.cameras || {});
    hasPairedFrames.value = scans.some(scan => scan.views.length > 0);
    return scans;
}