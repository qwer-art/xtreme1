const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function indexScene(sceneDir) {
    const sceneRoot = path.resolve(sceneDir);
    const scene = path.basename(sceneRoot), source = path.join(sceneRoot, 'source');
    assert(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,119}$/.test(scene), `Invalid scene ID: ${scene}`);
    const read = name => JSON.parse(fs.readFileSync(path.join(source, 'param', name), 'utf8'));
    const write = (name, data) => fs.writeFileSync(path.join(source, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    for (const name of ['dataset.json', 'index.json']) assert(!fs.existsSync(path.join(source, name)), `Preserving existing ${name}`);
    const pose = read('pose.json'), calib = read('calib.json');
    assert.equal(pose.schema, 'xtreme1-pose-v1');
    assert.equal(calib.schema, 'xtreme1-calibration-v1');
    const lidar = Object.keys(calib.lidar), channels = Object.keys(calib.cameras || {});
    assert.equal(lidar.length, 1, 'Expected one reference LiDAR');
    const [reference] = lidar;
    const matrix = value => Array.isArray(value) && value.length === 16 && value.every(Number.isFinite);
    assert(matrix(calib.lidar[reference].egoFromSensor), `Invalid ${reference} extrinsic`);
    for (const channel of channels) {
        assert(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(channel) && channel !== reference, `Invalid camera channel: ${channel}`);
        const camera = calib.cameras[channel];
        assert(matrix(camera.egoFromSensor) && camera.imageSize?.length === 2 && camera.imageSize.every(size => Number.isInteger(size) && size > 0) &&
            ['fx', 'fy', 'cx', 'cy'].every(key => Number.isFinite(camera.cameraInternal?.[key])) && camera.cameraInternal.fx > 0 && camera.cameraInternal.fy > 0,
            `Invalid ${channel} calibration`);
    }
    const asset = relative => {
        const stat = fs.statSync(path.join(source, relative));
        assert(stat.isFile() && stat.size > 0, `Empty or invalid asset: ${relative}`);
        return relative;
    };
    const filenames = fs.readdirSync(path.join(source, 'cloud')).filter(name => name.endsWith('.pcd'));
    assert(filenames.length, 'No timestamp-named PCD files');
    const frames = filenames.map(name => {
        const id = path.basename(name, '.pcd'), timestamp = Number(id);
        assert(Number.isSafeInteger(timestamp) && timestamp > 0 && String(timestamp) === id, `Invalid microsecond timestamp: ${name}`);
        const sensors = pose.frames[id];
        assert(sensors?.[reference]?.timestamp === timestamp && matrix(sensors[reference].worldFromSensor), `Missing or invalid ${reference} pose: ${id}`);
        const images = Object.entries(sensors).filter(([sensor]) => sensor !== reference).map(([channel, camera]) => {
            assert(channels.includes(channel) && matrix(camera.worldFromSensor) && Number.isSafeInteger(camera.timestamp) && camera.timestamp > 0,
                `Invalid ${channel} pose: ${id}`);
            return { channel, timestamp: camera.timestamp, path: asset(`image/${channel}/${camera.timestamp}.jpg`) };
        });
        return { id, timestamp, keyframe: images.length > 0, cloud: asset(`cloud/${name}`), images };
    }).sort((first, second) => first.timestamp - second.timestamp);
    const sourceDataset = path.basename(path.dirname(sceneRoot));
    write('index.json', { schema: 'xtreme1-frame-index-v1', scene, sourceDataset, frames });
    write('dataset.json', { schema: 'xtreme1-dataset-v1', scene, sourceDataset, coordinateFrame: reference,
        lengthUnit: 'm', timestampUnit: 'us', image: { channels }, frameIndex: 'index.json', frameCount: frames.length,
        pairedFrameCount: frames.filter(frame => frame.images.length).length });
    return frames.length;
}

if (require.main === module) {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/index-local-scene.cjs <dataset-root>/<scene-id>');
    console.log(`Indexed ${indexScene(process.argv[2])} scans in ${process.argv[2]}`);
}
module.exports = { indexScene };