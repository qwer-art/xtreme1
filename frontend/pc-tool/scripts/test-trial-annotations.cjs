const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');

function load(file, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8');
    const code = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
    const exports = {};
    new Function('require', 'exports', code)(name => dependencies[name] || require(name), exports);
    return exports;
}

async function run() {
    const editorTypes = { ObjectType: { TYPE_3D_BOX: '3D_BOX' }, SourceType: { DATA_FLOW: 'DATA_FLOW' } };
    const Box = load('packages/pc-render/objects/Box', { 'pc-editor': editorTypes, '../utils/tempVar': {},
        '../type': { AnnotateType: { ANNOTATE_3D: '3D' } } }).default;
    const create = load('packages/pc-editor/utils/create', { 'pc-render': { Box } });
    const result = load('packages/pc-editor/utils/result', { 'pc-render': { Box }, '../type': editorTypes,
        './create': create, './common': {}, './classType': {} });
    const CmdBase = load('packages/pc-editor/common/CmdManager/CmdBase');
    const Add = load('packages/pc-editor/common/CmdManager/cmd/AddObject', { '../CmdBase': CmdBase }).default;
    const velocity = load('common/trialVelocity');
    const store = load('common/trialAnnotationStore', { './trialVelocity': velocity });
    const sourceRoot = path.join(require('node:os').homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source');
    const manifest = require(path.join(sourceRoot, 'index.json'));
    const poses = require(path.join(sourceRoot, 'param/pose.json')).frames;
    const scans = manifest.frames.map(frame => ({ ...frame, worldFromLidar: poses[String(frame.timestamp)].LIDAR_TOP.worldFromSensor }));
    const [original, target] = scans.slice(0, 2).map(scan => scan.id);
    scans[0].worldFromLidar = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(10, 0, 0).toArray();
    scans[1].worldFromLidar = new THREE.Matrix4().makeTranslation(2, 0, 0).toArray();
    const api = load('common/trialAnnotations', { 'pc-editor': { ...editorTypes, utils: result },
        'pc-render': { Box }, './trialScene': { scans }, './trialAnnotationStore': store, './trialVelocity': velocity });
    const saved = new Map();
    global.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, val) => saved.set(key, val) };
    global.fetch = async () => new Response(JSON.stringify({ saved: true }), { status: 200 });
    const frames = scans.slice(0, 2).map(({ id }) => ({ id, needSave: false }));
    const cache = new Map();
    const legacy = { objects: [{ frontId: 'original-box', classAttributes: { type: '3D_BOX', classId: 'Car',
        trackId: 'T', trackName: '1', contour: { center3D: { x: 1, y: 0, z: 0 }, size3D: { x: 4, y: 2, z: 1 },
            rotation3D: { x: 0.4, y: 0, z: 0 } } } }] };
    const legacyKey = 'xtreme1:local-trial:v1:ca9a282c9e77460f8360f564131a8af5';
    saved.set(legacyKey, JSON.stringify(legacy));
    const editor = { bsState: {}, state: { frames, frameIndex: 0, config: { withoutTaskId: 'local' } },
        getCurrentFrame() { return this.state.frames[this.state.frameIndex]; },
        pc: { selection: [], selectObject(objects = []) { this.selection = objects; } },
        dataManager: { dataMap: cache, hasMap: new Map(), clear: () => cache.clear(),
            getFrameObject: id => cache.get(id), setFrameObject: (id, objects) => cache.set(id, objects),
            addAnnotates(objects, frame) { cache.get(frame.id).push(...objects); frame.needSave = true; },
            loadDataFromManager() {} },
        trackManager: { trackMap: new Map(), trackInfo: new Map(), clear() { this.trackMap.clear(); this.trackInfo.clear(); } },
        setCurrentTrack(id, name) { this.currentTrack = id; this.currentTrackName = name; }, updateIDCounter() {}, updateTrack() {},
        getClassType: id => id === 'Car' ? { name: 'Car', color: '#ffffff' } : undefined,
        getObjectUserData: obj => obj.userData, createAnnotate3D(...args) { return create.createAnnotate3D(this, ...args); },
        cmdManager: { cmds: [], index: -1, reset() { this.cmds = []; this.index = -1; }, withGroup: fn => fn(), execute(name, data) {
            if (name === 'add-object') new Add(editor, data).redo();
            else if (name === 'add-track') editor.trackManager.trackMap.set(data.trackId, data);
            else if (name === 'select-object') editor.pc.selection = [data];
            else if (name === 'update-object-user-data') { Object.assign(data.objects.userData, data.data); editor.getCurrentFrame().needSave = true; }
            else if (name === 'update-transform') {
                const { object, transform } = data;
                if (transform.position) object.position.copy(transform.position);
                if (transform.scale) object.scale.copy(transform.scale);
                if (transform.rotation) object.rotation.copy(transform.rotation);
                editor.getCurrentFrame().needSave = true;
            }
            else throw Error(name);
        } }, needSave() { return this.state.frames.some(frame => frame.needSave); },
        async saveObject() {
            for (const frame of this.state.frames.filter(frame => frame.needSave)) {
                const objects = result.convertAnnotate2Object(cache.get(frame.id), this);
                await api.saveLocalFrames([{ dataId: frame.id, objects: objects.map(obj => ({ frontId: obj.frontId,
                    classId: obj.classId || this.pc.selection[0]?.userData.classId,
                    classAttributes: result.translateToObjectV2(obj) })) }]);
                frame.needSave = false;
            }
        } };
    let counter = 0;
    editor.createTrackId = () => `new-track-${++counter}`;
    editor.getId = () => String(counter);
    api.configureTrialCreation(editor);
    const apiAction = load('packages/pc-editor/common/ActionManager/action/create', {
        'pc-render': { Box, MainRenderView: class View { getAction() { return { start: (_, draw) => draw([]) }; } canvasToWorld(point) { return point; } } },
        '../define': load('packages/pc-editor/common/ActionManager/define'), '../../../config/event': {},
        '../../../type': { Const: {}, StatusType: {} }, '../../../utils': { getMiniBox1() {},
            getTransformFrom3Point: () => ({ position: new THREE.Vector3(), scale: new THREE.Vector3(4, 2, 1), rotation: new THREE.Euler() }) },
    });
    const restored = api.readLocalObjects(frames).objectsMap;
    frames.forEach(frame => cache.set(frame.id, result.convertObject2Annotate(restored[frame.id], editor)));
    const source = cache.get(original)[0];
    assert.equal(source.uuid, 'original-box');
    editor.pc.selection = [source];
    const beforeGeometry = api.getSelectedGeometry(editor);
    api.updateSelectedGeometry(editor, { center: [1.5, 0.25, 0.1], size: [4.5, 2.1, 1.7], yaw: Math.PI / 6 });
    const afterGeometry = api.getSelectedGeometry(editor);
    assert.equal(source.uuid, 'original-box');
    assert.equal(source.userData.trackId, 'T');
    assert.deepEqual(afterGeometry.size, [4.5, 2.1, 1.7]);
    assert.notDeepEqual(afterGeometry, beforeGeometry);
    api.updateSelectedGeometry(editor, beforeGeometry);
    assert.deepEqual(api.getSelectedGeometry(editor), beforeGeometry);
    const snap = api.captureSelected(editor);
    editor.state.frameIndex = 1;
    assert.equal(api.captureSelected(editor), null);
    const copy = api.copySelected(editor, snap);
    assert.notEqual(copy.uuid, snap.box.bbox_id);
    assert.equal(copy.userData.trackId, 'T');
    assert.deepEqual(copy.scale.toArray(), [4, 2, 1]);
    assert.ok(copy.position.distanceTo(new THREE.Vector3(8, 1, 0)) < 1e-10);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    assert.ok(rotation.multiply(source.quaternion).angleTo(copy.quaternion) < 1e-7);
    assert.throws(() => api.copySelected(editor, snap), /already has/);
    api.assignTrack(editor, 'second-track');
    assert.equal(source.userData.trackId, 'T');
    assert.deepEqual(api.listTracks(editor), ['T', 'second-track']);
    editor.state.frames = [frames[1]];
    editor.state.frameIndex = 0;
    const doc = await api.exportAnnotations(editor);
    assert.equal(doc.frames.length, scans.length);
    assert.equal(doc.version, 3);
    const targetIndex = doc.frames.findIndex(frame => frame.scan_id === target);
    assert.ok(targetIndex >= 0);
    assert.equal(doc.frames[targetIndex].boxes[0].bbox_id, copy.uuid);
    await api.importAnnotations(editor, JSON.stringify(doc));
    assert.deepEqual(await api.exportAnnotations(editor), doc);
    assert.equal(saved.get(legacyKey), JSON.stringify(legacy));
    console.log('PASS legacy restore, native cuboid/pose, selected-only reassignment, filtered export, atomic rejection and import refresh');
}
run().catch(error => { console.error(error); process.exitCode = 1; });