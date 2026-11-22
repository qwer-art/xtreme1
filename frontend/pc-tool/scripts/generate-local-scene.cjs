const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Matrix4, Quaternion } = require('three');

const root = process.argv.slice(2).find(arg => arg !== '--ensure') || '/home/jerett/datasets/locomotion/nuscenes/v1.0-mini';
const database = process.env.XTREME1_DB_ROOT || path.join(require('node:os').homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini');
const sceneRoot = path.join(database, 'scene-0061');
const output = path.join(sceneRoot, 'source');
const manifest = path.join(output, 'index.json');
const sceneName = 'scene-0061';
const channels = ['CAM_FRONT', 'CAM_FRONT_RIGHT', 'CAM_BACK_RIGHT', 'CAM_BACK', 'CAM_BACK_LEFT', 'CAM_FRONT_LEFT'];
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cloudDir = path.join(output, 'cloud');
const imageDir = path.join(output, 'image');
const paramDir = path.join(output, 'param');
const sourceFile = relative => path.join(output, relative);

function complete() {
    try {
        const { schema, scene, frames } = readJson(manifest);
        const dataset = readJson(path.join(output, 'dataset.json'));
        const pose = readJson(path.join(paramDir, 'pose.json'));
        const calib = readJson(path.join(paramDir, 'calib.json'));
        return schema === 'xtreme1-frame-index-v1' && dataset.schema === 'xtreme1-dataset-v1' &&
            scene === sceneName && frames.length === 382 &&
            frames.every(frame => fs.statSync(sourceFile(frame.cloud), { throwIfNoEntry: false })?.size > 0 &&
                pose.frames[String(frame.timestamp)]?.LIDAR_TOP?.worldFromSensor?.length === 16 &&
                (!frame.images.length || frame.images.every(image =>
                    fs.statSync(sourceFile(image.path), { throwIfNoEntry: false })?.size > 0 &&
                    calib.cameras[image.channel])));
    } catch { return false; }
}

function transform({ rotation: [real, x, y, z], translation }) {
    return new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, real).normalize()).setPosition(...translation);
}

function writeCloud(record, outputFile) {
    const raw = fs.readFileSync(path.join(root, record.filename));
    const count = raw.length / 20;
    assert(Number.isInteger(count) && count > 0);
    const header = Buffer.from(`VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${count}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${count}\nDATA binary\n`);
    const cloud = Buffer.allocUnsafe(header.length + count * 16);
    header.copy(cloud);
    for (let point = 0; point < count; point++) raw.copy(cloud, header.length + point * 16, point * 20, point * 20 + 16);
    fs.writeFileSync(outputFile, cloud);
}

function generate() {
    if ((process.env.XTREME1_SCENE_ID || sceneName) !== sceneName) throw new Error(`This exporter only supports ${sceneName}`);
    if (fs.existsSync(path.join(output, 'dataset.json')) && readJson(path.join(output, 'dataset.json')).sourceDataset !== 'nuScenes/v1.0-mini')
        throw new Error(`Preserving other dataset at ${output}`);
    for (const dir of [cloudDir, imageDir, paramDir]) fs.mkdirSync(dir, { recursive: true });
    const table = name => readJson(path.join(root, 'v1.0-mini', `${name}.json`));
    const index = name => new Map(table(name).map(record => [record.token, record]));
    const scene = table('scene').find(record => record.name === sceneName);
    const samples = new Map(table('sample').filter(record => record.scene_token === scene.token).map(record => [record.token, record.timestamp]));
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
        if (record.filename.startsWith('samples/') && channels.includes(channel)) cameras.set(`${record.sample_token}/${channel}`, record);
    }
    lidar.sort((first, second) => first.timestamp - second.timestamp);
    assert.equal(lidar.length, 382);
    assert.equal(new Set(lidar.map(record => String(record.timestamp))).size, lidar.length, 'LiDAR timestamps must be unique');
    const sensorsCalibration = new Map();
    for (const record of [...lidar, ...cameras.values()]) {
        const channel = sensors.get(calibration(record).sensor_token).channel;
        const current = transform(calibration(record)).toArray();
        const previous = sensorsCalibration.get(channel);
        if (previous) assert(previous.every((value, index) => Math.abs(value - current[index]) < 1e-10), `Calibration changed within ${channel}`);
        else sensorsCalibration.set(channel, current);
    }
    const frames = lidar.map(record => {
        const stamp = String(record.timestamp);
        const cloud = `cloud/${stamp}.pcd`;
        const world = worldFromSensor(record);
        writeCloud(record, sourceFile(cloud));
        const linked = samples.get(record.sample_token) === record.timestamp && channels.some(name => cameras.has(`${record.sample_token}/${name}`));
        const images = linked ? channels.flatMap(channel => {
            const camera = cameras.get(`${record.sample_token}/${channel}`);
            if (!camera || !fs.existsSync(path.join(root, camera.filename))) return [];
            const cameraStamp = String(camera.timestamp);
            const relative = `image/${channel}/${cameraStamp}.jpg`;
            const target = sourceFile(relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(root, camera.filename), target);
            return [{ channel, timestamp: camera.timestamp, path: relative }];
        }) : [];
        const cameraPoses = Object.fromEntries(images.map(image => {
            const camera = cameras.get(`${record.sample_token}/${image.channel}`);
            return [image.channel, { timestamp: camera.timestamp, worldFromSensor: worldFromSensor(camera).toArray() }];
        }));
        return { id: record.token, timestamp: record.timestamp, keyframe: record.is_key_frame,
            sampleToken: record.sample_token, cloud, images,
            pose: { LIDAR_TOP: { timestamp: record.timestamp, worldFromSensor: world.toArray() }, ...cameraPoses } };
    });
    const cameraSensors = Object.fromEntries(channels.map(channel => {
        const record = cameras.values().find(row => sensors.get(calibration(row).sensor_token).channel === channel);
        if (!record) return null;
        const [[fx, skew, cx], [, fy, cy]] = calibration(record).camera_intrinsic;
        assert.equal(skew, 0);
        return [channel, { egoFromSensor: sensorsCalibration.get(channel), cameraInternal: { fx, fy, cx, cy }, imageSize: [record.width, record.height] }];
    }).filter(Boolean));
    const dataset = {
        schema: 'xtreme1-dataset-v1', scene: sceneName, sourceDataset: 'nuScenes/v1.0-mini',
        coordinateFrame: 'LIDAR_TOP', lengthUnit: 'm', timestampUnit: 'us',
        cloud: { directory: 'cloud', filename: '{timestamp}.pcd', format: 'PCD binary XYZI float32' },
        image: { directory: 'image/{channel}', filename: '{timestamp}.jpg', format: 'JPEG', channels },
        param: { pose: 'param/pose.json', calibration: 'param/calib.json', format: 'JSON' },
        frameIndex: 'index.json', frameCount: frames.length, pairedFrameCount: frames.filter(frame => frame.images.length).length,
    };
    const posesByTimestamp = Object.fromEntries(frames.map(frame => [String(frame.timestamp), frame.pose]));
    const frameIndex = frames.map(({ pose, ...frame }) => frame);
    fs.writeFileSync(path.join(output, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'param', 'pose.json.tmp'), JSON.stringify({
        schema: 'xtreme1-pose-v1', coordinateFrame: 'world', sensorPose: 'worldFromSensor; 4x4 column-major matrix',
        frames: posesByTimestamp,
    }) + '\n');
    fs.renameSync(path.join(output, 'param', 'pose.json.tmp'), path.join(output, 'param', 'pose.json'));
    fs.writeFileSync(path.join(output, 'param', 'calib.json.tmp'), JSON.stringify({
        schema: 'xtreme1-calibration-v1', coordinateFrame: 'ego', sensorExtrinsic: 'egoFromSensor; 4x4 column-major matrix',
        lidar: { LIDAR_TOP: { egoFromSensor: sensorsCalibration.get('LIDAR_TOP') } }, cameras: cameraSensors,
    }) + '\n');
    fs.renameSync(path.join(output, 'param', 'calib.json.tmp'), path.join(output, 'param', 'calib.json'));
    fs.writeFileSync(`${manifest}.tmp`, JSON.stringify({
        schema: 'xtreme1-frame-index-v1', scene: sceneName, sourceDataset: 'nuScenes/v1.0-mini', frames: frameIndex,
    }) + '\n');
    fs.renameSync(`${manifest}.tmp`, manifest);
    fs.writeFileSync(path.join(sceneRoot, 'dataset.json'), JSON.stringify({
        schema: 'xtreme1-scene-database-v1', scene: sceneName, sourceDataset: 'nuScenes/v1.0-mini',
        inputManifest: 'source/dataset.json', predictionRuns: 'predictions/centerpoint-pubtracker/runs',
        annotations: 'annotations', createdAt: new Date().toISOString(),
    }, null, 2) + '\n');
    console.log(`${manifest}: ${frames.length} LiDAR scans, ${frames.filter(frame => frame.images.length).length} paired camera frames`);
}

if (!process.argv.includes('--ensure') || !complete()) generate();