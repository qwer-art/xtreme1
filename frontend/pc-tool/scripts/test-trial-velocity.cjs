const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const three = require('three');

function load(name, dependencies) {
    const api = {};
    new Function('require', 'exports', ts.transpile(fs.readFileSync(path.join(__dirname,
        '../src/common', name + '.ts'), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }))(
        dependency => dependencies[dependency] || require(dependency), api);
    return api;
}
const velocity = load('trialVelocity', { three });
const store = load('trialAnnotationStore', { './trialVelocity': velocity });
const pose = (angle, offset) => new three.Matrix4().makeRotationZ(angle).setPosition(offset, 0, 0).toArray();
const scans = [{ id: 'first', timestamp: 1000000, worldFromLidar: pose(0, 0) },
    { id: 'second', timestamp: 2000000, worldFromLidar: pose(Math.PI / 2, 2) }];
const box = (id, center) => ({ bbox_id: id, track_id: 'target', track_name: '1', class_id: 'Pedestrian',
    center, size: [1, 1, 2], rotation: [0, 0, 0] });
const frames = scans.map((scan, index) => ({ scene_id: 'scene-0061', scan_id: scan.id, timestamp_us: scan.timestamp,
    boxes: [box(String(index), index ? [0, -8, 0] : [10, 0, 0])] }));
const before = JSON.stringify(frames);
const stationary = velocity.withBoxMetadata(frames, scans);
assert.ok(stationary[1].boxes[0].velocity.speed_mps < 1e-10);
assert.equal(stationary[0].boxes[0].idx, 1);
assert.equal(JSON.stringify(frames), before);
frames[1].boxes[0].center = [0, -11, 0];
const moving = velocity.withBoxMetadata(frames, scans);
for (const frame of moving) {
    assert.ok(Math.abs(frame.boxes[0].velocity.speed_mps - 3) < 1e-10);
    assert.equal(frame.boxes[0].velocity.interval_s, 1);
    assert.equal(frame.boxes[0].velocity.status, 'computed');
}
assert.equal(moving[0].boxes[0].velocity.reference_scan_id, 'second');
assert.equal(moving[1].boxes[0].velocity.reference_scan_id, 'first');
assert.equal(velocity.withBoxMetadata([frames[0]], scans)[0].boxes[0].velocity.world_xy_mps, null);
assert.equal(velocity.withBoxMetadata(frames, [scans[0]])[0].boxes[0].velocity.status, 'missing_pose');
const catalog = store.scanCatalog(scans);
const document = { version: 3, scene: catalog.sceneId, geometry: catalog.geometry, frames };
const validated = store.validateDocument(document, catalog);
validated.frames[0].boxes[0].velocity.speed_mps = 999;
validated.frames[0].boxes[0].idx = 999;
const recalculated = store.validateDocument(validated, catalog);
assert.ok(Math.abs(recalculated.frames[0].boxes[0].velocity.speed_mps - 3) < 1e-10);
assert.equal(recalculated.frames[0].boxes[0].idx, 1);
const storage = new Map();
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
store.replaceDocument(recalculated, catalog);
assert.deepEqual(store.loadDocument(catalog), recalculated);
const reassigned = JSON.parse(JSON.stringify(document));
reassigned.frames[1].boxes[0].track_id = 'other';
assert.equal(store.validateDocument(reassigned, catalog).frames[0].boxes[0].velocity.status, 'insufficient_track');
const removed = { ...document, frames: [frames[0], { ...frames[1], boxes: [] }] };
assert.equal(store.validateDocument(removed, catalog).frames[0].boxes[0].velocity.speed_mps, null);
console.log('PASS ego compensation, world velocity, null missing samples/poses, idx, stale-value recomputation, storage round-trip, reassignment and deletion');