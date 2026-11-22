const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const api = {};
new Function('exports', ts.transpile(fs.readFileSync(require('node:path').join(__dirname,
    '../src/common/trialSustechpoints.ts'), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }))(api);
const native = id => ({ obj_id: id, obj_type: 'Car', psr: { position: { x: 1, y: 2, z: 3 },
    scale: { x: 4, y: 2, z: 1 }, rotation: { x: 0, y: 0, z: 0 } } });
const working = { scene: 'scene', frames: [{ scan_id: 'scan', boxes: [] }, { scan_id: 'other', boxes: [] }] };
const baseline = { scene: 'scene', trackIds: { 'cp-all-1': '1', 'cp-all-2': '2' }, scanIds: { '100': 'scan' },
    candidateIds: { '100': { '1': 'all-track-1', '2': 'all-track-2' } }, frames: { '100': [native('1'), native('2')] } };
const update = annotation => [{ scene: 'scene', frame: '100', annotation }];
assert.deepEqual(api.mergeSustechpoints(working, baseline, update(baseline.frames['100'])), { document: working, reviews: [] });
const changed = native('1'); changed.psr.rotation.x = 0.25;
const result = api.mergeSustechpoints(working, baseline, update([changed, native('3')]));
assert.equal(result.document.frames[0].boxes.length, 2);
assert.equal(result.document.frames[0].boxes[0].track_id, 'cp-all-1');
assert.equal(result.document.frames[0].boxes[0].rotation[0], 0.25);
assert.equal(result.document.frames[0].boxes[1].track_id, 'sustech-3');
assert.equal(result.document.frames[1].boxes.length, 0);
assert.deepEqual(result.reviews.map(item => item.decision), ['accepted', 'rejected']);
assert.throws(() => api.mergeSustechpoints(working, baseline, update([native('3'), native('3')])));
assert.equal(working.frames[0].boxes.length, 0);
const nextBaseline = { ...baseline, frames: { '100': [changed, native('3')] } };
const movedNew = native('3'); movedNew.psr.position.z += 1;
const second = api.mergeSustechpoints(result.document, nextBaseline, update([changed, movedNew]));
assert.equal(second.document.frames[0].boxes.length, 2);
assert.equal(second.document.frames[0].boxes[1].center[2], 4);
const removed = api.mergeSustechpoints(second.document, nextBaseline, update([changed]));
assert.equal(removed.document.frames[0].boxes.length, 1);
const rider = { ...native('3'), obj_type: 'BicycleRider' };
const riderResult = api.mergeSustechpoints(working, baseline, update([...baseline.frames['100'], rider]));
assert.equal(riderResult.document.frames[0].boxes[0].class_id, 'Cyclist');
assert.deepEqual(riderResult.document.frames[0].boxes[0].size, [4, 2, 1]);
assert.equal(rider.obj_type, 'BicycleRider');
const cyclist = { ...native('1'), obj_type: 'Cyclist' };
const cyclistBaseline = { ...baseline, frames: { '100': [cyclist, native('2')] } };
assert.deepEqual(api.mergeSustechpoints(working, cyclistBaseline,
    update([{ ...cyclist, obj_type: 'BicycleRider' }, native('2')])), { document: working, reviews: [] });
console.log('PASS unchanged predictions stay pending; edits/new/deleted boxes and XYZ rotations merge without mutating input');