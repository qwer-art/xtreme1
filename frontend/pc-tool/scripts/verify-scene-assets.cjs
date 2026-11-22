const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Matrix4, Quaternion, Vector3 } = require('three');

const root = process.argv[2] || '/home/jerett/datasets/locomotion/nuscenes/v1.0-mini';
const sourceRoot = path.join(require('node:os').homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source');
const asset = url => path.join(sourceRoot, url.replace(/^\/local-scene\//, ''));
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const table = name => json(path.join(root, 'v1.0-mini', `${name}.json`));
const index = name => new Map(table(name).map(row => [row.token, row]));
const { scene, frames } = json(path.join(sourceRoot, 'index.json'));
const poseFrames = json(path.join(sourceRoot, 'param/pose.json')).frames;
const sensorCalibration = json(path.join(sourceRoot, 'param/calib.json')).cameras;
const scans = frames.map(frame => ({ ...frame, pointsUrl: `/local-scene/${frame.cloud}`,
    worldFromLidar: poseFrames[String(frame.timestamp)].LIDAR_TOP.worldFromSensor }));
assert.equal(scene, 'scene-0061');
const sceneToken = table('scene').find(row => row.name === scene).token;
const samples = new Set(table('sample').filter(row => row.scene_token === sceneToken).map(row => row.token));
const sensors = index('sensor'), calibrations = index('calibrated_sensor'), poses = index('ego_pose');
const channel = row => sensors.get(calibrations.get(row.calibrated_sensor_token).sensor_token).channel;
const rows = table('sample_data').filter(row => samples.has(row.sample_token));
const lidar = rows.filter(row => channel(row) === 'LIDAR_TOP').sort((first, second) => first.timestamp - second.timestamp);
const cameras = new Map(rows.filter(row => row.filename.startsWith('samples/')).map(row => [`${row.sample_token}/${channel(row)}`, row]));
const rotation = row => new Quaternion(...row.rotation.slice(1), row.rotation[0]).normalize();
const transform = row => new Matrix4().makeRotationFromQuaternion(rotation(row)).setPosition(...row.translation);
const forward = (point, row) => point.applyQuaternion(rotation(row)).add(new Vector3(...row.translation));
const inverse = (point, row) => point.sub(new Vector3(...row.translation)).applyQuaternion(rotation(row).invert());
const channels = ['CAM_FRONT', 'CAM_FRONT_RIGHT', 'CAM_BACK_RIGHT', 'CAM_BACK', 'CAM_BACK_LEFT', 'CAM_FRONT_LEFT'];
const marker = Buffer.from('DATA binary\n');
function payload(scan) {
    const cloud = fs.readFileSync(asset(scan.pointsUrl));
    const offset = cloud.indexOf(marker);
    assert(offset > 0);
    const data = cloud.subarray(offset + marker.length);
    const header = cloud.toString('ascii', 0, offset).split('\n');
    for (const field of ['FIELDS x y z intensity', `WIDTH ${data.length / 16}`, `POINTS ${data.length / 16}`]) assert(header.includes(field));
    return data;
}

assert.equal(scans.length, 382);
assert.deepEqual(scans.map(scan => scan.id), lidar.map(row => row.token));
let points = 0, images = 0;
for (const [ordinal, scan] of scans.entries()) {
    const row = lidar[ordinal];
    assert.deepEqual([scan.timestamp, scan.keyframe, scan.sampleToken], [row.timestamp, row.is_key_frame, row.sample_token]);
    assert(Number.isSafeInteger(scan.timestamp) && (!ordinal || scan.timestamp > scans[ordinal - 1].timestamp));
    const raw = fs.readFileSync(path.join(root, row.filename)), data = payload(scan);
    assert.equal(data.length / 16, raw.length / 20);
    for (let point = 0; point < data.length / 16; point++) {
        assert.equal(data.compare(raw, point * 20, point * 20 + 16, point * 16, point * 16 + 16), 0);
    }
    points += data.length / 16;
    assert.equal(scan.worldFromLidar.length, 16);
    const probes = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]].map(coords => new Vector3(...coords));
    const world = probes.map(point => forward(forward(point.clone(), calibrations.get(row.calibrated_sensor_token)), poses.get(row.ego_pose_token)));
    const matrix = new Matrix4().fromArray(scan.worldFromLidar);
    probes.forEach((point, axis) => assert(point.clone().applyMatrix4(matrix).distanceTo(world[axis]) < 1e-8));
    assert.deepEqual(scan.worldFromLidar, poseFrames[String(scan.timestamp)].LIDAR_TOP.worldFromSensor);
    const scanImages = scan.images;
    if (!scan.keyframe) { assert.equal(scanImages.length, 0); continue; }
    assert.deepEqual(scanImages.map(image => image.channel), channels);
    for (const image of scanImages) {
        const camera = cameras.get(`${row.sample_token}/${image.channel}`);
        const calibration = calibrations.get(camera.calibrated_sensor_token);
        const storedCalibration = sensorCalibration[image.channel];
        assert.equal(image.timestamp, camera.timestamp);
        assert.equal(image.path, `image/${image.channel}/${camera.timestamp}.jpg`);
        assert(fs.readFileSync(asset(`/local-scene/${image.path}`)).equals(fs.readFileSync(path.join(root, camera.filename))));
        assert.deepEqual(storedCalibration.imageSize, [camera.width, camera.height]);
        const [[fx, , cx], [, fy, cy]] = calibration.camera_intrinsic;
        assert.deepEqual(storedCalibration.cameraInternal, { fx, fy, cx, cy });
        const storedExtrinsic = new Matrix4().fromArray(storedCalibration.egoFromSensor);
        const sourceExtrinsic = transform(calibration);
        probes.forEach((point, axis) => assert(point.clone().applyMatrix4(storedExtrinsic).distanceTo(point.clone().applyMatrix4(sourceExtrinsic)) < 1e-8));
        const cameraWorld = new Matrix4().fromArray(poseFrames[String(scan.timestamp)][image.channel].worldFromSensor);
        const lidarWorld = new Matrix4().fromArray(scan.worldFromLidar);
        const cameraFromLidar = cameraWorld.clone().invert().multiply(lidarWorld);
        const registeredCamera = new Matrix4().set(...cameraFromLidar.clone().transpose().toArray());
        const cameraFromWorld = transform(poses.get(camera.ego_pose_token)).multiply(transform(calibration)).invert();
        probes.forEach((point, axis) => assert(point.clone().applyMatrix4(registeredCamera).distanceTo(
            world[axis].clone().applyMatrix4(cameraFromWorld)) < 1e-8));
        images++;
    }
}
assert.equal(images, 234);
console.log(`Verified ${scans.length} scans, ${points} XYZI records and ${images} camera images/projections.`);

function feature(scan, center) {
    const cloud = payload(scan), sum = new Vector3();
    let count = 0, low = Infinity, high = -Infinity;
    for (let offset = 0; offset < cloud.length; offset += 16) {
        const point = new Vector3(cloud.readFloatLE(offset), cloud.readFloatLE(offset + 4), cloud.readFloatLE(offset + 8));
        if (Math.abs(point.x - center[0]) > 0.5 || Math.abs(point.y - center[1]) > 0.5 || point.z < 0.2 || point.z > 3) continue;
        sum.add(point); count++; low = Math.min(low, point.z); high = Math.max(high, point.z);
    }
    assert(count >= 10 && high - low > 2);
    return { point: sum.divideScalar(count), count };
}
const horizontal = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
const first = scans[300], second = scans[320];
console.log(`Sweeps 300/320: ${first.id}, ${second.id}; dt=${second.timestamp - first.timestamp} us`);
for (const [start, end] of [[[-15.08, 7.34], [-15.12, 4.85]], [[-17.22, 11.15], [-17.21, 8.82]]]) {
    const before = feature(first, start), after = feature(second, end);
    const raw = horizontal(before.point, after.point);
    const aligned = horizontal(before.point.applyMatrix4(new Matrix4().fromArray(first.worldFromLidar)),
        after.point.applyMatrix4(new Matrix4().fromArray(second.worldFromLidar)));
    console.log(`Vertical feature ${start}: ${before.count}/${after.count} returns, horizontal displacement ${raw.toFixed(3)} -> ${aligned.toFixed(3)} m`);
    assert(raw > 2 && aligned < 0.2);
}
