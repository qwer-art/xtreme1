const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createServer } = require('./sustechpoints-server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');

async function run() {
    const sceneRoot = path.join(process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini'),
        process.env.XTREME1_SCENE_ID || 'scene-0061');
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sustechpoints-test-')), 'working.json');
    const { server, scene } = createServer({ sceneRoot, output });
    const inputs = ['annotations/working/scene-0061.json', 'annotations/review-decisions.json',
        `predictions/centerpoint-pubtracker/runs/${scene.document.predictionRun}/tracking.json`];
    const hashes = () => inputs.map(file => createHash('sha256').update(fs.readFileSync(path.join(sceneRoot, file))).digest('hex'));
    const beforeHashes = hashes();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        headless: true, args: ['--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [], modelRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (['/predict_rotation', '/auto_annotate'].includes(new URL(request.url()).pathname)) modelRequests.push(request.url()); });
        await page.goto(base);
        await page.waitForFunction(() => window.editor?.data.world?.annotation.boxes.length > 0 && editor.data.world.cameras.loaded());
        const count = await page.evaluate(() => editor.data.world.annotation.boxes.length);
        await page.evaluate(async () => {
            const { logger } = await import('/static/js/log.js');
            logger.hide();
            const box = editor.data.world.annotation.boxes.find(box => box.obj_type === 'Car');
            window.testBox = editor.data.world.annotation.boxToAnn(box);
            editor.selectBox(box);
        });
        await page.keyboard.press('Delete');
        assert.equal(await page.evaluate(() => editor.data.world.annotation.boxes.length), count - 1);
        const rect = await page.evaluate(async () => {
            const THREE = await import('/static/js/lib/three.module.js');
            const world = editor.data.world, { position, scale, rotation } = window.testBox.psr;
            const center = new THREE.Vector3(position.x, position.y, position.z);
            const target = world.lidarPosToScene(center);
            const camera = editor.viewManager.mainView.camera;
            camera.position.copy(target).add(new THREE.Vector3(0, 0, 16));
            camera.up.set(0, 1, 0);
            camera.lookAt(target);
            camera.updateMatrixWorld();
            camera.updateProjectionMatrix();
            editor.render();
            const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
            const bounds = editor.mouse.domElement.getBoundingClientRect();
            const pixels = [];
            for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const signZ of [-1, 1]) {
                const point = new THREE.Vector3(signX * scale.x / 2, signY * scale.y / 2, signZ * scale.z / 2)
                    .applyMatrix4(rotationMatrix).add(center);
                const projected = world.lidarPosToScene(point).project(camera);
                pixels.push({ x: bounds.x + (projected.x + 1) * bounds.width / 2,
                    y: bounds.y + (1 - projected.y) * bounds.height / 2 });
            }
            return { left: Math.min(...pixels.map(point => point.x)) - 3, right: Math.max(...pixels.map(point => point.x)) + 3,
                top: Math.min(...pixels.map(point => point.y)) - 3, bottom: Math.max(...pixels.map(point => point.y)) + 3 };
        });
        await page.keyboard.down('Control');
        await page.mouse.move(rect.left, rect.top); await page.mouse.down();
        await page.mouse.move(rect.right, rect.bottom, { steps: 8 }); await page.mouse.up();
        await page.keyboard.up('Control');
        await page.waitForFunction(expected => editor.data.world.annotation.boxes.length === expected && editor.selected_box, count);
        const added = await page.evaluate(() => editor.data.world.annotation.boxToAnn(editor.selected_box));
        assert.ok(Object.values(added.psr.scale).every(value => Number.isFinite(value) && value > 0));
        assert.ok(!scene.document.frames[scene.meta.frames[0]].some(box => box.obj_id === String(added.obj_id)));
        const response = page.waitForResponse(response => response.url().endsWith('/saveworldlist') && response.status() === 200);
        await page.locator('#save-button').click(); await response;
        await page.reload();
        await page.waitForFunction(id => window.editor?.data.world?.annotation.boxes.some(box => String(box.obj_track_id) === id), String(added.obj_id));
        const reread = await page.evaluate(id => editor.data.world.annotation.boxToAnn(
            editor.data.world.annotation.boxes.find(box => String(box.obj_track_id) === id)), String(added.obj_id));
        assert.deepEqual(reread, added);
        const exported = await fetch(base + '/export').then(response => response.json());
        assert.deepEqual(exported.frames[scene.meta.frames[0]].find(box => box.obj_id === added.obj_id), JSON.parse(JSON.stringify(added)));
        await page.selectOption('#frame-selector', scene.meta.frames[3]);
        await page.waitForFunction(frame => editor.data.world?.frameInfo.frame === frame && editor.data.world.cameras.loaded(), scene.meta.frames[3]);
        const calibration = await page.evaluate(() => {
            const world = editor.data.world;
            return { camera: world.sceneMeta.calib.camera, position: world.trans_lidar_utm.elements.slice(12, 15),
                points: world.lidar.points.geometry.attributes.position.count, images: Object.values(world.cameras.content).filter(image => image.naturalWidth).length };
        });
        assert.deepEqual(calibration.camera, scene.meta.cameraByFrame[scene.meta.frames[3]]);
        assert.ok(calibration.points > 10000 && calibration.images === 6);
        assert.deepEqual(calibration.position, scene.meta.lidarToWorld[scene.meta.frames[3]].slice(12, 15)
            .map((value, index) => value - scene.meta.lidarToWorld[scene.meta.frames[0]][12 + index]));
        assert.deepEqual(errors, []);
        assert.deepEqual(modelRequests, []);
        assert.deepEqual(hashes(), beforeHashes);
        console.log(`PASS native Ctrl-drag, new ID ${added.obj_id}, save/reload/export, camera/pose/frame changes; original data unchanged; ${output}`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });