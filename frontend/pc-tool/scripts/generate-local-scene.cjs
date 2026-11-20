const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Matrix4, Quaternion } = require('three');

const root = process.argv.slice(2).find(arg => arg !== '--ensure') || '/home/jerett/datasets/locomotion/nuscenes/v1.0-mini';
const publicDir = path.resolve(__dirname, '../public');
const output = path.join(publicDir, 'local-scene');
const manifest = path.join(output, 'index.json');
const sceneName = 'scene-0061';
const channels = ['CAM_FRONT', 'CAM_FRONT_RIGHT', 'CAM_BACK_RIGHT', 'CAM_BACK', 'CAM_BACK_LEFT', 'CAM_FRONT_LEFT'];
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const asset = url => path.join(publicDir, url);
const exists = url => fs.statSync(asset(url), { throwIfNoEntry: false })?.size > 0;

function complete() {
    try {
        const { scene, scans } = readJson(manifest);
        return scene === sceneName && scans.length === 382 && scans.every(scan => exists(scan.pointsUrl) &&
            (scan.keyframe ? readJson(asset(scan.viewsUrl)).length === channels.length &&
                channels.every(channel => exists(`/local-scene/${scan.id}/${channel}.jpg`)) : scan.viewsUrl === null));
    } catch { return false; }
}

function transform({ rotation: [real, x, y, z], translation }) {
    return new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, real).normalize()).setPosition(...translation);
}

function writeCloud(record, pointsUrl) {
    const raw = fs.readFileSync(path.join(root, record.filename));
    const count = raw.length / 20;
    assert(Number.isInteger(count) && count > 0);
    const header = Buffer.from(`VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${count}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${count}\nDATA binary\n`);
    const cloud = Buffer.allocUnsafe(header.length + count * 16);
    header.copy(cloud);
    for (let point = 0; point < count; point++) raw.copy(cloud, header.length + point * 16, point * 20, point * 20 + 16);
    fs.writeFileSync(asset(pointsUrl), cloud);
}

function generate() {
    const table = name => readJson(path.join(root, 'v1.0-mini', `${name}.json`));
    const index = name => new Map(table(name).map(record => [record.token, record]));
    const scene = table('scene').find(record => record.name === sceneName);
    const samples = new Set(table('sample').filter(record => record.scene_token === scene.token).map(record => record.token));
    const sensors = index('sensor');
    const calibrations = index('calibrated_sensor');
    const poses = index('ego_pose');
    const calibration = record => calibrations.get(record.calibrated_sensor_token);
    const worldFromSensor = record => transform(poses.get(record.ego_pose_token)).multiply(transform(calibration(record)));
    const lidar = [];
    const cameras = new Map();
    for (const record of table('sample_data')) {
        if (!samples.has(record.sample_token)) continue;
        const channel = sensors.get(calibration(record).sensor_token).channel;
        if (channel === 'LIDAR_TOP') lidar.push(record);
        if (record.is_key_frame && channels.includes(channel)) cameras.set(`${record.sample_token}/${channel}`, record);
    }
    lidar.sort((first, second) => first.timestamp - second.timestamp);
    assert.equal(lidar.length, 382);
    assert.equal(lidar.filter(record => record.is_key_frame).length, scene.nbr_samples);
    const scans = lidar.map((record, ordinal) => {
        const prefix = `/local-scene/${record.token}`;
        const pointsUrl = `${prefix}/points.pcd`;
        const world = worldFromSensor(record);
        fs.mkdirSync(asset(prefix), { recursive: true });
        writeCloud(record, pointsUrl);
        const viewsUrl = record.is_key_frame ? `${prefix}/views.json` : null;
        if (viewsUrl) {
            const views = channels.map(name => {
                const camera = cameras.get(`${record.sample_token}/${name}`);
                const [[fx, skew, cx], [, fy, cy]] = calibration(camera).camera_intrinsic;
                assert.equal(skew, 0);
                const imgUrl = `${prefix}/${name}.jpg`;
                fs.copyFileSync(path.join(root, camera.filename), asset(imgUrl));
                const cameraExternal = worldFromSensor(camera).invert().multiply(world).transpose().toArray();
                return { name, imgUrl, imgObject: null, imgSize: [camera.width, camera.height], cameraInternal: { fx, fy, cx, cy }, cameraExternal };
            });
            fs.writeFileSync(asset(viewsUrl), JSON.stringify(views) + '\n');
        }
        if ((ordinal + 1) % 50 === 0) console.log(`${sceneName}: ${ordinal + 1}/${lidar.length} clouds`);
        return { id: record.token, timestamp: record.timestamp, keyframe: record.is_key_frame, pointsUrl, worldFromLidar: world.toArray(), viewsUrl, sampleToken: record.sample_token };
    });
    fs.writeFileSync(`${manifest}.tmp`, JSON.stringify({ scene: sceneName, scans }) + '\n');
    fs.renameSync(`${manifest}.tmp`, manifest);
    console.log(`${manifest}: ${scans.length} clouds, ${scene.nbr_samples} camera sets`);
}

if (!process.argv.includes('--ensure') || !complete()) generate();