const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Matrix4, Vector3, Quaternion } = require('three');

const root = process.argv[2] || '/home/jerett/datasets/locomotion/nuscenes/v1.0-mini';
const output = path.join(__dirname, '../public/local-frame');
const token = 'ca9a282c9e77460f8360f564131a8af5';
const channels = ['CAM_FRONT', 'CAM_FRONT_RIGHT', 'CAM_BACK_RIGHT', 'CAM_BACK', 'CAM_BACK_LEFT', 'CAM_FRONT_LEFT'];
const table = name => JSON.parse(fs.readFileSync(path.join(root, 'v1.0-mini', `${name}.json`), 'utf8'));
const index = name => new Map(table(name).map(record => [record.token, record]));
const scene = table('scene').find(record => record.name === 'scene-0061');
assert.equal(scene.first_sample_token, token);
assert.equal(index('sample').get(token).scene_token, scene.token);
const calibrations = index('calibrated_sensor');
const poses = index('ego_pose');
const sensors = index('sensor');
const frames = new Map();
for (const record of table('sample_data').filter(item => item.sample_token === token && item.is_key_frame)) {
    const calibration = calibrations.get(record.calibrated_sensor_token);
    const channel = sensors.get(calibration.sensor_token).channel;
    assert(!frames.has(channel));
    frames.set(channel, { record, calibration, pose: poses.get(record.ego_pose_token) });
}

function transform({ rotation: [real, x, y, z], translation }) {
    return new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, real).normalize())
        .setPosition(...translation);
}

const lidar = frames.get('LIDAR_TOP');
const lidarToEgo = transform(lidar.calibration);
const egoToGlobal = transform(lidar.pose);
const raw = fs.readFileSync(path.join(root, lidar.record.filename));
const count = raw.length / 20;
assert(Number.isInteger(count) && count > 0);
const header = `VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${count}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${count}\nDATA binary\n`;
const payload = Buffer.alloc(count * 16);
for (let point = 0; point < count; point++) raw.copy(payload, point * 16, point * 20, point * 20 + 16);

const views = channels.map(name => {
    const { record, calibration, pose } = frames.get(name);
    const globalToEgo = transform(pose).invert();
    const egoToCamera = transform(calibration).invert();
    const external = egoToCamera.clone().multiply(globalToEgo).multiply(egoToGlobal).multiply(lidarToEgo);
    const cameraExternal = external.transpose().toArray();
    const renderMatrix = new Matrix4().set(...cameraExternal);
    const [[fx, skew, cx], [, fy, cy]] = calibration.camera_intrinsic;
    assert.equal(skew, 0);
    let visible = 0;
    let maxError = 0;
    for (let offset = 0; offset < payload.length; offset += 16) {
        const point = new Vector3(...[0, 4, 8].map(delta => payload.readFloatLE(offset + delta)));
        const reference = point.clone().applyMatrix4(lidarToEgo).applyMatrix4(egoToGlobal)
            .applyMatrix4(globalToEgo).applyMatrix4(egoToCamera);
        point.applyMatrix4(renderMatrix);
        maxError = Math.max(maxError, point.distanceTo(reference));
        if (point.z <= 1) continue;
        const u = fx * point.x / point.z + cx;
        const v = fy * point.y / point.z + cy;
        if (u > 1 && u < record.width - 1 && v > 1 && v < record.height - 1) visible++;
    }
    assert(maxError < 1e-8 && visible > 0, `Projection failed: ${name}`);
    console.log(`${name}: dt=${record.timestamp - lidar.record.timestamp} us, visible=${visible}/${count}, maxError=${maxError.toExponential(2)} m`);
    return { name, imgUrl: `/local-frame/${name}.jpg`, imgObject: null, imgSize: [record.width, record.height],
        cameraInternal: { fx, fy, cx, cy }, cameraExternal };
});

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'points.pcd'), Buffer.concat([Buffer.from(header), payload]));
for (const { name } of views) {
    fs.copyFileSync(path.join(root, frames.get(name).record.filename), path.join(output, `${name}.jpg`));
}
fs.writeFileSync(path.join(output, 'views.json'), JSON.stringify(views, null, 2) + '\n');