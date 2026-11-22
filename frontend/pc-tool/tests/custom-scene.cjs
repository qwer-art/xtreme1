const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createServer } = require('vite');
const { Vector3, Matrix4 } = require('three');
const { indexScene } = require('../scripts/index-local-scene.cjs');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
test('index and annotate a timestamp scene with a custom camera and reference LiDAR', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreme1-custom-'));
    const scene = path.join(root, 'yard'), source = path.join(scene, 'source');
    const original = path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source');
    let server, browser;
    try {
        for (const dir of ['cloud', 'param', 'image/front']) fs.mkdirSync(path.join(source, dir), { recursive: true });
        const frames = read(path.join(original, 'index.json')).frames;
        const paired = frames.find(frame => frame.images.length), single = frames.find(frame => frame.timestamp > paired.timestamp && !frame.images.length);
        const front = paired.images.find(image => image.channel === 'CAM_FRONT');
        const poses = read(path.join(original, 'param/pose.json')).frames, calibration = read(path.join(original, 'param/calib.json'));
        const sourcePoses = {};
        for (const frame of [paired, single]) {
            fs.copyFileSync(path.join(original, frame.cloud), path.join(source, frame.cloud));
            sourcePoses[frame.timestamp] = { roof_lidar: poses[frame.timestamp].LIDAR_TOP };
        }
        sourcePoses[paired.timestamp].front = poses[paired.timestamp].CAM_FRONT;
        const image = `image/front/${front.timestamp}.jpg`;
        fs.writeFileSync(path.join(source, 'param/pose.json'), JSON.stringify({ schema: 'xtreme1-pose-v1', frames: sourcePoses }));
        fs.writeFileSync(path.join(source, 'param/calib.json'), JSON.stringify({ schema: calibration.schema,
            cameras: { front: calibration.cameras.CAM_FRONT }, lidar: { roof_lidar: calibration.lidar.LIDAR_TOP } }));
        assert.throws(() => indexScene(scene), /ENOENT/);
        assert(!fs.existsSync(path.join(source, 'index.json')));
        fs.copyFileSync(path.join(original, front.path), path.join(source, image));
        assert.equal(indexScene(scene), 2);
        assert.throws(() => indexScene(scene), /Preserving existing/);
        process.env.XTREME1_DB_ROOT = root;
        process.env.XTREME1_SCENE_ID = 'yard';
        delete process.env.XTREME1_SOURCE_ROOT;
        server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 } });
        await server.listen();
        const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');
        browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/local-trial`);
        await page.waitForFunction(url => {
            const thumb = document.querySelector('[data-slot="front"] img');
            return thumb?.naturalWidth > 0 && new URL(thumb.src).pathname === url;
        }, `/local-scene/${image}`);
        assert.equal(await page.locator('[data-slot]').count(), 1);
        await page.getByTestId('trial-mode').selectOption('all');
        await page.getByTestId('trial-next').click();
        await page.waitForFunction(id => window.editor?.getCurrentFrame()?.id === id && !document.querySelector('[data-slot="front"] img'), String(single.timestamp));
        await page.getByRole('button', { name: '文件' }).click();
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('trial-export').click()]);
        assert.equal(download.suggestedFilename(), 'yard-annotations.json');
        const document = read(await download.path());
        assert.equal(document.geometry.coordinate_frame, 'roof_lidar (current scan)');
        assert.deepEqual(document.frames.map(frame => frame.scan_id), [paired, single].map(frame => String(frame.timestamp)));
        document.frames[1].boxes.push({ bbox_id: 'box-1', track_id: 'track-1', track_name: '1', class_id: 'Car',
            center: [1, 2, 0], size: [4, 2, 1], rotation: [0, 0, 0] });
        const seconds = (single.timestamp - paired.timestamp) / 1e6;
        const poseMatrix = frame => new Matrix4().fromArray(sourcePoses[frame.timestamp].roof_lidar.worldFromSensor);
        const nextCenter = new Vector3(4, 2, 0).applyMatrix4(poseMatrix(paired)).add(new Vector3(3 * seconds, 4 * seconds, 0)).applyMatrix4(poseMatrix(single).invert()).toArray();
        for (const [index, center] of [[0, [4, 2, 0]], [1, nextCenter]]) document.frames[index].boxes.push({ ...document.frames[1].boxes[0],
            bbox_id: `moving-${index}`, track_id: 'track-2', track_name: '2', center });
        const saved = page.waitForResponse(response => response.url().endsWith('/trial-data/annotations') && response.request().method() === 'PUT');
        await page.getByTestId('trial-import').setInputFiles({ name: 'yard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
        assert.equal((await saved).status(), 200);
        assert.deepEqual(read(path.join(scene, 'annotations/working/yard.json')), document);
        const selectBox = id => page.evaluate(id => window.editor.pc.selectObject(window.editor.pc.getAnnotate3D().find(box => box.uuid === id)), id);
        await selectBox('box-1');
        const speed = page.getByTestId('trial-speed');
        assert.match(await speed.innerText(), /待同 ID 第二帧/);
        assert.equal(await page.evaluate(() => !!window.editor.pc.scene.getObjectByName('trial-selected-velocity')), false);
        await selectBox('moving-1');
        assert.match(await speed.innerText(), /轨迹速度 5\.00 m\/s/);
        const end = await page.evaluate(() => {
            const arrow = window.editor.pc.scene.getObjectByName('trial-selected-velocity');
            return arrow.cone.getWorldPosition(arrow.position.clone()).sub(arrow.position).toArray();
        });
        const direction = new Vector3(...end).transformDirection(poseMatrix(single));
        assert.ok(Math.abs(Math.hypot(...end) - 5) < 1e-6 && direction.distanceTo(new Vector3(.6, .8, 0)) < 1e-6);
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        await server?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});