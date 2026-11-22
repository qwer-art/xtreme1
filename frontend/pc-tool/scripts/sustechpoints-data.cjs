const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const optional = (file, fallback) => fs.existsSync(file) ? read(file) : fallback;
const vector = values => Object.fromEntries(['x', 'y', 'z'].map((axis, index) => [axis, values[index]]));

function annotation(box, id) {
    return { psr: { position: vector(box.center), scale: vector(box.size),
        rotation: vector(box.rotation || [0, 0, box.yaw]) }, obj_type: box.category || box.class_id,
        obj_id: String(id), obj_attr: box.score === undefined ? '' : `CenterPoint ${box.score.toFixed(2)}` };
}

function validateAnnotations(boxes) {
    if (!Array.isArray(boxes) || boxes.length > 10000) throw new Error('Invalid annotation list');
    const ids = new Set();
    for (const box of boxes) {
        if (!box || typeof box.obj_id !== 'string' || !/^\d{1,12}$/.test(box.obj_id) || ids.has(box.obj_id))
            throw new Error('Each box needs a unique numeric object ID in its frame');
        ids.add(box.obj_id);
        if (typeof box.obj_type !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(box.obj_type))
            throw new Error('Invalid object category');
        for (const component of ['position', 'scale', 'rotation']) for (const axis of ['x', 'y', 'z']) {
            const value = box.psr?.[component]?.[axis];
            if (!Number.isFinite(value) || (component === 'scale' && value <= 0)) throw new Error('Invalid box geometry');
        }
    }
    return boxes;
}

function loadScene(sceneRoot, threshold = 0.5, source = path.join(sceneRoot, 'source')) {
    const index = read(path.join(source, 'index.json'));
    const dataset = read(path.join(source, 'dataset.json'));
    const poses = read(path.join(source, 'param/pose.json')).frames;
    const sensors = read(path.join(source, 'param/calib.json')).cameras;
    const prediction = path.join(sceneRoot, 'predictions/centerpoint-pubtracker');
    const { runId } = read(path.join(prediction, 'active.json'));
    if (!/^[\w.-]+$/.test(runId) || runId === '.' || runId === '..') throw new Error('Invalid run ID');
    const tracking = read(path.join(prediction, 'runs', runId, 'tracking.json'));
    const frames = index.frames.filter(frame => frame.images.length && tracking.frames[frame.id]);
    if (!frames.length) throw new Error('No paired frames with CenterPoint/PubTracker results');
    const working = optional(path.join(sceneRoot, 'annotations/working', `${index.scene}.json`), { frames: [] });
    const reviews = optional(path.join(sceneRoot, 'annotations/review-decisions.json'), {});
    const trackIds = new Map();
    const used = new Set();
    for (const frame of frames) for (const box of tracking.frames[frame.id]) {
        const match = /^cp-all-(\d+)$/.exec(box.trackId || '');
        if (match) { trackIds.set(box.trackId, match[1]); used.add(match[1]); }
    }
    for (const frame of working.frames) for (const box of frame.boxes) {
        const match = /^sustech-(\d+)$/.exec(box.track_id);
        if (match && !used.has(match[1])) { trackIds.set(box.track_id, match[1]); used.add(match[1]); }
    }
    let next = Math.max(0, ...[...used].map(Number)) + 1;
    function objectId(trackId) {
        if (!trackIds.has(trackId)) trackIds.set(trackId, String(next++));
        return trackIds.get(trackId);
    }
    const labels = {}, cameraByFrame = {}, lidarToWorld = {}, candidateIds = {};
    for (const frame of frames) {
        const stamp = String(frame.timestamp);
        candidateIds[stamp] = {};
        const manual = working.frames.find(saved => saved.scan_id === frame.id)?.boxes || [];
        const byTrack = new Map(manual.map(box => [box.track_id, box]));
        const boxes = [];
        for (const candidate of tracking.frames[frame.id]) {
            const reviewValue = reviews[`xtreme1:local-trial:review:v1:${index.scene}:centerpoint:${frame.id}:${candidate.id}`];
            const review = typeof reviewValue === 'string' ? JSON.parse(reviewValue) : reviewValue;
            const trackId = candidate.trackId || `single:${frame.id}:${candidate.id}`;
            if (review?.decision === 'rejected' || (review?.decision === 'accepted' && !byTrack.has(trackId))) continue;
            const id = objectId(trackId);
            candidateIds[stamp][id] = candidate.id;
            if (byTrack.has(trackId)) continue;
            const box = review?.decision === 'adjusted' ? { ...candidate, ...review } : candidate;
            if (!review && box.score < threshold) continue;
            boxes.push(annotation(box, id));
        }
        for (const box of manual) boxes.push(annotation(box, objectId(box.track_id)));
        labels[stamp] = validateAnnotations(boxes);
        const pose = poses[stamp];
        const worldFromLidar = new THREE.Matrix4().fromArray(pose[dataset.coordinateFrame || 'LIDAR_TOP'].worldFromSensor);
        lidarToWorld[stamp] = worldFromLidar.toArray();
        cameraByFrame[stamp] = Object.fromEntries(frame.images.map(image => {
            const { fx, fy, cx, cy } = sensors[image.channel].cameraInternal;
            const cameraFromLidar = new THREE.Matrix4().fromArray(pose[image.channel].worldFromSensor).invert().multiply(worldFromLidar);
            return [image.channel, { extrinsic: cameraFromLidar.transpose().toArray(), intrinsic: [fx, 0, cx, 0, fy, cy, 0, 0, 1] }];
        }));
    }
    const meta = { scene: index.scene, frames: frames.map(frame => String(frame.timestamp)),
        boxtype: 'psr', lidar_ext: '.pcd', camera_ext: '.jpg',
        camera: [...new Set(frames.flatMap(frame => frame.images.map(image => image.channel)))],
        calib: { camera: cameraByFrame[String(frames[0].timestamp)] }, cameraByFrame, lidarToWorld,
        maxObjectId: Math.max(0, ...trackIds.values().map(Number)) };
    const document = { schema: 'sustechpoints-review-v1', scene: index.scene, predictionRun: runId, threshold,
        trackIds: Object.fromEntries(trackIds), scanIds: Object.fromEntries(frames.map(frame => [String(frame.timestamp), frame.id])),
        candidateIds, frames: labels };
    return { source, frames, meta, document };
}

module.exports = { annotation, validateAnnotations, loadScene };