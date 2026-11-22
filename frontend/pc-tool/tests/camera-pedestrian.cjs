const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const three = require('three');
const ts = require('typescript');

const root = path.join(os.homedir(), 'datasets');
const source = path.join(root, 'perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source');
const tables = path.join(root, 'locomotion/nuscenes/v1.0-mini/v1.0-mini');
const read = file => JSON.parse(fs.readFileSync(file));
const scan = read(path.join(source, 'index.json')).frames.find(frame => frame.id === 'c4f1a270736445e185379a80c29a5139');
const pose = read(path.join(source, 'param/pose.json')).frames[scan.timestamp];
const channel = 'CAM_FRONT_LEFT', camera = read(path.join(source, 'param/calib.json')).cameras[channel];
const worldFromLidar = new three.Matrix4().fromArray(pose.LIDAR_TOP.worldFromSensor);
const cameraFromWorld = new three.Matrix4().fromArray(pose[channel].worldFromSensor).invert();
camera.cameraExternal = cameraFromWorld.clone().multiply(worldFromLidar).transpose().toArray();
camera.imgSize = camera.imageSize;
const { fx, fy, cx, cy } = camera.cameraInternal;
const project = point => [fx * point.x / point.z + cx, fy * point.y / point.z + cy];
const raw = fs.readFileSync(path.join(source, scan.cloud)), offset = raw.indexOf('DATA binary\n') + 12;
const xyz = [];
for (let index = offset; index < raw.length; index += 16) xyz.push(...[0, 4, 8].map(axis => raw.readFloatLE(index + axis)));
const positions = new three.Float32BufferAttribute(xyz, 3);
const names = new Map(read(path.join(tables, 'category.json')).map(row => [row.token, row.name]));
const classes = new Map(read(path.join(tables, 'instance.json')).map(row => [row.token, names.get(row.category_token)]));
const reference = read(path.join(tables, 'sample_annotation.json')).filter(row => row.sample_token === scan.sampleToken && classes.get(row.instance_token).startsWith('human.pedestrian')).map(row => {
    const center = new three.Vector3(...row.translation).applyMatrix4(cameraFromWorld);
    return { row, center, pixel: project(center) };
}).filter(item => item.center.z > 0 && item.pixel[0] > 1250 && item.pixel[0] < 1570 && item.pixel[1] > 300 && item.pixel[1] < 900).sort((first, second) => first.center.z - second.center.z)[0];
assert(reference, 'foreground pedestrian is present in CAM_FRONT_LEFT');
const truth = reference.row;
const lidarCenter = new three.Vector3(...truth.translation).applyMatrix4(worldFromLidar.clone().invert());
const rotation = new three.Quaternion(...truth.rotation.slice(1), truth.rotation[0]).invert();
const inside = new Set();
for (let index = 0; index < positions.count; index++) {
    const point = new three.Vector3().fromBufferAttribute(positions, index).applyMatrix4(worldFromLidar).sub(new three.Vector3(...truth.translation)).applyQuaternion(rotation);
    if ([point.x, point.y, point.z].every((value, axis) => Math.abs(value) <= [truth.size[1], truth.size[0], truth.size[2]][axis] / 2)) inside.add(index);
}
console.log('Reference (evaluation only):', JSON.stringify({ pixel: reference.pixel, depth: reference.center.z, lidar: lidarCenter.toArray(), size: truth.size, points: inside.size }));
if (process.argv.includes('--baseline')) {
    const seed = [...inside].sort((a, b) => new three.Vector3().fromBufferAttribute(positions, a).distanceToSquared(lidarCenter) - new three.Vector3().fromBufferAttribute(positions, b).distanceToSquared(lidarCenter))[0];
    fetch('http://127.0.0.1:3211/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan_id: scan.id, points: Array.from({length: positions.count}, (_, index) => xyz.slice(index * 3, index * 3 + 3)), prompts: [{index: seed, positive: true}] }) }).then(response => response.json()).then(mask => console.log('Unrestricted Point-SAM (one known in-box click):', JSON.stringify({ seed, selected: mask.indices?.length, inBox: mask.indices?.filter(index => inside.has(index)).length, size: mask.size, error: mask.error })));
} else {
    const modulePath = path.resolve(__dirname, '../src/common/trialPedestrian.ts');
    const api = {};
    new Function('require', 'exports', ts.transpile(fs.readFileSync(modulePath, 'utf8'), {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS}))(require, api);
    for (const rect of [{left:1260, top:320, right:1548, bottom:899}, {left:1280, top:360, right:1515, bottom:892}]) {
        const box = api.cameraPedestrian(positions, camera, rect);
        const hit = box.indices.filter(index => inside.has(index)).length;
        const offset = lidarCenter.distanceTo(new three.Vector3(...box.center));
        console.log('Image ROI:', JSON.stringify({ centerError: offset, size: box.size, selected: box.indices.length, inBox: hit, referencePoints: inside.size }));
        assert(offset < .55 && box.size[0] < 1.6 && box.size[1] < 1.6 && Math.abs(box.size[2] - truth.size[2]) < .65);
        assert(hit / box.indices.length > .65 && hit / inside.size > .35);
    }
    assert.throws(() => api.cameraPedestrian(positions, camera, {left:0,top:0,right:5,bottom:5}));
}