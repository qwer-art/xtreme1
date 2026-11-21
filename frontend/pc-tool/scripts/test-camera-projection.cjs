const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');

function load(file, dependencies) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8');
    const code = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
    const exports = {};
    new Function('require', 'exports', code)(name => dependencies[name] || require(name), exports);
    return exports;
}

const utils = load('packages/pc-render/utils/index', {
    '../objects': {}, 'three/examples/jsm/math/Lut': { Lut: class {} },
});
const View = load('packages/pc-render/renderView/Image2DRenderView', {
    './Render': { default: class {} }, './Image2DRenderProxy': {}, '../objects': {},
    '../config/': {}, '../utils': utils, '../utils/tempVar': load('packages/pc-render/utils/tempVar', {}),
}).default;
const visible = new THREE.Object3D(), hidden = new THREE.Object3D(), stale = new THREE.Object3D();
hidden.visible = false;
const calls = [];
const view = Object.assign(Object.create(View.prototype), {
    pointCloud: { selection: [visible, hidden, stale] }, proxy: {}, renderBox: true,
    get3DObject: () => [visible, hidden], renderBoxData: box => calls.push(box),
});
view.renderObjects();
assert.deepEqual(calls, [visible]);
console.log('PASS current visible annotation drawn once, independent of stale selection');

const scene = new THREE.Scene();
const preview = new THREE.Group(), detections = new THREE.Group();
preview.name = 'trial-candidate-preview'; detections.name = 'centerpoint-preview';
const sample = new THREE.LineSegments(), detection = new THREE.LineSegments(), accepted = new THREE.LineSegments();
accepted.name = visible.uuid;
sample.position.set(1, 2, 3); preview.position.x = 4;
sample.add(new THREE.Sprite()); preview.add(sample, new THREE.Points()); detections.add(detection, accepted);
scene.add(preview, detections);
view.pointCloud.scene = scene;
view.pointCloud.getAnnotate3D = view.get3DObject;
const projected = [];
view.proxy.renderer = { render(line) {
    assert.equal(line.children.length, 0);
    projected.push([line.geometry, line.material, line.matrixWorld.elements[12]]);
} };
load('components/ImgView/trialProjection', {}).attachTrialProjection(view);
view.renderObjects();
assert.deepEqual(projected.splice(0), [[sample.geometry, sample.material, 5], [detection.geometry, detection.material, 0]]);
sample.position.x = 8; detection.visible = false;
view.renderObjects();
assert.deepEqual(projected.splice(0), [[sample.geometry, sample.material, 12]]);
preview.removeFromParent();
view.renderObjects();
assert.deepEqual(projected, []);
console.log('PASS live candidate outlines, parent transforms, hide/removal and accepted identity');

const imageRect = { left: 100, top: 25, bottom: 125, width: 200, height: 100 };
const image = { naturalWidth: 100, naturalHeight: 100, currentSrc: 'current', getBoundingClientRect: () => imageRect };
view.img = { src: 'current' };
view.proxy.clientRect = { left: 30, top: 10, bottom: 210 };
const viewports = [];
view.proxy.renderer.setViewport = (...args) => viewports.push(args);
view.proxy.renderer.setScissor = (...args) => assert.deepEqual(args, viewports.at(-1));
load('components/ImgView/trialProjection', {}).attachTrialProjection(view, () => image);
view.renderThumbnail();
assert.deepEqual(viewports, [[120, 85, 100, 100]]);
image.currentSrc = 'previous'; view.renderThumbnail();
image.currentSrc = 'current'; imageRect.width = 0; view.renderThumbnail();
assert.equal(viewports.length, 1);
console.log('PASS thumbnail contain fit, stale-image suppression and hidden mobile images');

const cameraView = Object.assign(Object.create(View.prototype), {
    imgSize: new THREE.Vector2(), width: 512, height: 308, fitMatrix: new THREE.Matrix4(),
    matrix: new THREE.Matrix4(), matrixExternal: new THREE.Matrix4(), matrixInternal: new THREE.Matrix4(),
    camera: new THREE.PerspectiveCamera(), clipCamera: new THREE.PerspectiveCamera(),
    cameraHelper: { update() {} }, render() {},
});
const scan = require('../public/local-scene/index.json').scans.find(scan => scan.viewsUrl);
const calibrations = require(path.join(__dirname, '../public', scan.viewsUrl));
const cuboid = new THREE.Object3D();
cuboid.scale.set(4.1, 1.9, 1.6); cuboid.rotation.set(.05, -.07, .53);
let comparisons = 0, maxError = 0;
for (const calibration of calibrations) {
    const [width, height] = calibration.imgSize;
    const cameraFromLidar = new THREE.Matrix4().set(...calibration.cameraExternal);
    cameraView.setOptions({ ...calibration, imgObject: { naturalWidth: width, naturalHeight: height } });
    cuboid.position.set(1, -.7, 17).applyMatrix4(cameraFromLidar.clone().invert());
    cuboid.updateMatrixWorld(true);
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
        const world = new THREE.Vector3(x, y, z).applyMatrix4(cuboid.matrixWorld);
        const optical = world.clone().applyMatrix4(cameraFromLidar);
        const { fx, fy, cx, cy } = calibration.cameraInternal;
        const pixel = cameraView.worldToImg(world.clone());
        maxError = Math.max(maxError, Math.abs(pixel.x - (fx * optical.x / optical.z + cx)),
            Math.abs(pixel.y - (fy * optical.y / optical.z + cy)));
        assert.ok(Math.abs(pixel.z) < 1);
        comparisons++;
    }
    const behind = new THREE.Vector3(0, 0, -1).applyMatrix4(cameraFromLidar.clone().invert());
    assert.ok(cameraView.worldToImg(behind).z > 1);
}
assert.equal(comparisons, 48);
assert.ok(maxError < 1e-8, `calibrated corner error ${maxError} pixels`);
console.log(`PASS ${comparisons} calibrated corners across six cameras, max error ${maxError.toExponential(2)} px`);

const ProxyView = load('packages/pc-render/renderView/Image2DRenderProxy', {}).default;
const clears = [];
const proxy = Object.assign(Object.create(ProxyView.prototype), {
    updateSize() {}, canvas: { getBoundingClientRect: () => ({}) },
    context: { clearRect: () => clears.push('image') }, renderer: { setScissorTest() {}, clear: () => clears.push('boxes') },
    views: [{ isEnable: () => false, renderFrame: () => assert.fail('disabled camera was drawn') }],
});
proxy.renderFrame();
assert.deepEqual(clears, ['image', 'boxes']);
console.log('PASS empty/disabled camera rail clears old image and projected pixels');