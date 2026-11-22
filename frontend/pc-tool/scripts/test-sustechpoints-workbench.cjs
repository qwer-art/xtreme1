const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');

async function run() {
    const root = path.resolve(__dirname, '..');
    const original = path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sustech-workbench-'));
    const scene = path.join(temporary, 'scene-0061');
    const prediction = 'predictions/centerpoint-pubtracker';
    const runId = JSON.parse(fs.readFileSync(path.join(original, prediction, 'active.json'))).runId;
    const files = ['annotations/working/scene-0061.json', 'annotations/review-decisions.json',
        `${prediction}/active.json`, `${prediction}/runs/${runId}/tracking.json`];
    const hashes = () => files.map(file => createHash('sha256').update(fs.readFileSync(path.join(original, file))).digest('hex'));
    const before = hashes();
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(scene, file)), { recursive: true });
        fs.copyFileSync(path.join(original, file), path.join(scene, file));
    }
    process.env.XTREME1_DB_ROOT = temporary;
    process.env.XTREME1_SCENE_ID = 'scene-0061';
    process.env.XTREME1_SOURCE_ROOT = path.join(original, 'source');
    const server = await require('vite').createServer({ root, configFile: path.join(root, 'vite.config.ts'),
        logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        page.setDefaultTimeout(60000);
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => requests.push(request.url()));
        await page.goto(base + '/local-trial');
        await page.waitForFunction(() => window.editor?.getCurrentFrame());
        const pager = page.getByTestId('trial-index');
        await pager.fill('4'); await pager.press('Enter');
        await page.waitForFunction(() => editor.getCurrentFrame()?.id === 'c4f1a270736445e185379a80c29a5139');
        await page.getByTestId('trial-sustechpoints').click();
        const iframe = page.frameLocator('iframe[title="SUSTechPOINTS 原生编辑区"]');
        await iframe.locator('#save-button').waitFor();
        const native = page.frames().find(frame => frame.url().includes('/sustechpoints/'));
        await native.waitForFunction(() => window.editor?.data.world?.preloaded() && editor.data.world.cameras.loaded());
        const categories = await native.evaluate(async () => {
            const { globalObjectCategory } = await import(location.pathname + 'static/js/obj_cfg.js');
            return Object.keys(globalObjectCategory.obj_type_map).sort();
        });
        assert.deepEqual(categories, await page.evaluate(() => editor.state.classTypes.map(category => category.id).sort()));
        const currentScan = JSON.parse(fs.readFileSync(path.join(original, 'source/index.json'))).frames
            .find(frame => frame.id === 'c4f1a270736445e185379a80c29a5139');
        assert.equal(await native.evaluate(() => editor.data.world.frameInfo.frame), String(currentScan.timestamp));
        console.log('PASS toolbar opens matching frame in same-page native editor');
        const beforeCount = await page.evaluate(() => editor.dataManager.getFrameObject(editor.getCurrentFrame().id).length);
        const change = await native.evaluate(async () => {
            const { logger } = await import(location.pathname + 'static/js/log.js'); logger.hide();
            const world = editor.data.world;
            const box = world.annotation.boxes.find(box => box.obj_type === 'Car');
            editor.selectBox(box);
            return { id: String(box.obj_track_id), beforeX: box.position.x, scan: world.frameInfo.frame };
        });
        const viewBefore = await native.evaluate(() => {
            const view = editor.viewManager.mainView;
            return { distance: view.camera.position.distanceTo(view.orbit.target),
                position: view.camera.position.toArray(), target: view.orbit.target.toArray(),
                annotations: JSON.stringify(editor.data.world.annotation.toBoxAnnotations()),
                modified: editor.data.world.annotation.modified, speed: view.orbit.zoomSpeed };
        });
        assert.equal(viewBefore.speed, 3);
        const viewport = await page.locator('iframe').boundingBox();
        await page.mouse.move(viewport.x + viewport.width * .8, viewport.y + viewport.height * .7);
        for (const delta of [-120, 120]) {
            const distance = await native.evaluate(() => editor.viewManager.mainView.camera.position.distanceTo(editor.viewManager.mainView.orbit.target));
            await page.mouse.wheel(0, delta);
            await native.waitForFunction(distance => Math.abs(editor.viewManager.mainView.camera.position.distanceTo(editor.viewManager.mainView.orbit.target) - distance) > .001, distance);
            const after = await native.evaluate(() => editor.viewManager.mainView.camera.position.distanceTo(editor.viewManager.mainView.orbit.target));
            assert.ok(Math.abs(after / distance - Math.pow(.95, delta < 0 ? 3 : -3)) < 1e-6);
        }
        await iframe.locator('#label-highlight').click();
        assert.ok(await native.evaluate(() => editor.selected_box.in_highlight));
        assert.ok(await native.evaluate(() => {
            const view = editor.viewManager.mainView;
            return view.orbit.target.distanceTo(editor.data.world.lidarPosToScene(editor.selected_box.position)) < 1e-6;
        }));
        await page.screenshot({ path: path.join(temporary, 'focused.png') });
        await iframe.locator('#label-highlight').click();
        const viewAfter = await native.evaluate(() => {
            const view = editor.viewManager.mainView;
            return { distance: view.camera.position.distanceTo(view.orbit.target),
                position: view.camera.position.toArray(), target: view.orbit.target.toArray(),
                annotations: JSON.stringify(editor.data.world.annotation.toBoxAnnotations()),
                modified: editor.data.world.annotation.modified, speed: view.orbit.zoomSpeed };
        });
        assert.equal(viewAfter.annotations, viewBefore.annotations);
        assert.equal(viewAfter.modified, viewBefore.modified);
        assert.ok(Math.abs(viewAfter.distance - viewBefore.distance) < 1e-6);
        viewAfter.position.forEach((value, index) => assert.ok(Math.abs(value - viewBefore.position[index]) < 1e-6));
        assert.deepEqual(viewAfter.target, viewBefore.target);
        console.log('PASS faster central zoom in/out, focus/restore, unchanged box geometry and dirty state');
        await native.locator('body').press('d');
        const moved = await native.evaluate(() => {
            const box = editor.selected_box;
            return { x: box.position.x, y: box.position.y, z: box.position.z, modified: box.world.annotation.modified };
        });
        assert.ok(moved.modified, 'native keyboard did not modify box');
        await iframe.locator('#save-button').click();
        await page.getByText('已保存到标注台', { exact: true }).waitFor();
        await native.waitForFunction(() => !editor.data.world.annotation.modified);
        await page.getByRole('button', { name: '返回标注台', exact: true }).click();
        await page.locator('iframe').waitFor({ state: 'detached' });
        const formal = await page.evaluate(id => editor.dataManager.getFrameObject(editor.getCurrentFrame().id)
            .find(box => box.userData.trackId === `cp-all-${id}`)?.position.toArray(), change.id);
        assert.deepEqual(formal, [moved.x, moved.y, moved.z]);
        assert.equal(await page.evaluate(() => editor.dataManager.getFrameObject(editor.getCurrentFrame().id).length), beforeCount + 1);
        console.log('PASS native save updates one formal box, leaves untouched predictions pending');
        await page.reload();
        await page.waitForFunction(() => window.editor?.getCurrentFrame());
        await pager.fill('4'); await pager.press('Enter');
        await page.waitForFunction(id => editor.dataManager.getFrameObject(editor.getCurrentFrame()?.id)?.some(box => box.userData.trackId === `cp-all-${id}`), change.id);
        await page.getByTestId('trial-sustechpoints').click();
        await iframe.locator('#save-button').waitFor();
        const reopened = page.frames().find(frame => frame.url().includes('/sustechpoints/'));
        await reopened.waitForFunction(() => window.editor?.data.world?.preloaded());
        assert.deepEqual(await reopened.evaluate(id => {
            const box = editor.data.world.annotation.boxes.find(box => String(box.obj_track_id) === id);
            return [box.position.x, box.position.y, box.position.z];
        }, change.id), formal);
        await reopened.evaluate(() => {
            const box = editor.data.world.annotation.boxes.find(box => box.obj_type === 'Car');
            editor.selectBox(box);
        });
        await reopened.locator('body').press('d');
        const returning = await reopened.evaluate(() => {
            editor.selected_box.obj_type = 'BicycleRider';
            return editor.data.world.annotation.toBoxAnnotations();
        });
        const workingPath = path.join(scene, 'annotations/working/scene-0061.json');
        const savedBeforeFailure = fs.readFileSync(workingPath, 'utf8');
        const failSave = route => route.request().method() === 'PUT'
            ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test save unavailable' }) })
            : route.continue();
        await page.route('**/trial-data/annotations', failSave);
        await page.getByRole('button', { name: '返回标注台', exact: true }).click();
        await page.getByRole('alertdialog', { name: '未保存的补标' }).waitFor();
        assert.deepEqual(await reopened.evaluate(() => editor.data.world.annotation.toBoxAnnotations()), returning);
        assert.ok(await reopened.evaluate(() => editor.data.world.annotation.modified));
        assert.equal(fs.readFileSync(workingPath, 'utf8'), savedBeforeFailure);
        await page.unroute('**/trial-data/annotations', failSave);
        const returnStarted = Date.now();
        await page.getByRole('button', { name: '返回标注台', exact: true }).click();
        await page.locator('iframe').waitFor({ state: 'detached' });
        const returnElapsed = Date.now() - returnStarted;
        const returnedBox = JSON.parse(fs.readFileSync(workingPath, 'utf8')).frames
            .find(frame => frame.scan_id === currentScan.id).boxes.find(box => box.track_id === `cp-all-${change.id}`);
        assert.equal(returnedBox.class_id, 'Cyclist');
        const nativeReturned = returning.find(box => box.obj_id === change.id);
        assert.deepEqual(returnedBox.center, Object.values(nativeReturned.psr.position));
        assert.deepEqual(returnedBox.size, Object.values(nativeReturned.psr.scale));
        assert.deepEqual(returnedBox.rotation, Object.values(nativeReturned.psr.rotation));
        assert.deepEqual(await page.evaluate(id => {
            const box = editor.dataManager.getFrameObject(editor.getCurrentFrame().id).find(box => box.userData.trackId === `cp-all-${id}`);
            return box.position.toArray();
        }, change.id), returnedBox.center);
        console.log(`PASS failed save retains edits; BicycleRider maps to Cyclist; one-click retry returns in ${returnElapsed}ms`);
        await page.getByTestId('trial-sustechpoints').click();
        await iframe.locator('#save-button').waitFor();
        const drawing = page.frames().find(frame => frame.url().includes('/sustechpoints/'));
        await drawing.waitForFunction(() => window.editor?.data.world?.preloaded() && editor.data.world.cameras.loaded());
        await drawing.evaluate(async id => {
            const { logger } = await import(location.pathname + 'static/js/log.js'); logger.hide();
            const box = editor.data.world.annotation.boxes.find(box => String(box.obj_track_id) === id);
            window.testBox = editor.data.world.annotation.boxToAnn(box);
            editor.selectBox(box);
        }, change.id);
        await drawing.locator('body').press('Delete');
        const rect = await drawing.evaluate(async () => {
            const THREE = await import(location.pathname + 'static/js/lib/three.module.js');
            const world = editor.data.world, { position, scale, rotation } = window.testBox.psr;
            const center = new THREE.Vector3(position.x, position.y, position.z);
            const target = world.lidarPosToScene(center), camera = editor.viewManager.mainView.camera;
            camera.position.copy(target).add(new THREE.Vector3(0, 0, 16));
            camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix(); editor.render();
            const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
            const bounds = editor.mouse.domElement.getBoundingClientRect(), pixels = [];
            for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const signZ of [-1, 1]) {
                const point = new THREE.Vector3(signX * scale.x / 2, signY * scale.y / 2, signZ * scale.z / 2).applyMatrix4(matrix).add(center);
                const projected = world.lidarPosToScene(point).project(camera);
                pixels.push({ x: bounds.x + (projected.x + 1) * bounds.width / 2, y: bounds.y + (1 - projected.y) * bounds.height / 2 });
            }
            return { left: Math.min(...pixels.map(point => point.x)) - 3, right: Math.max(...pixels.map(point => point.x)) + 3,
                top: Math.min(...pixels.map(point => point.y)) - 3, bottom: Math.max(...pixels.map(point => point.y)) + 3 };
        });
        const offset = await page.locator('iframe').boundingBox();
        await page.keyboard.down('Control');
        await page.mouse.move(offset.x + rect.left, offset.y + rect.top); await page.mouse.down();
        await page.mouse.move(offset.x + rect.right, offset.y + rect.bottom, { steps: 8 }); await page.mouse.up();
        await page.keyboard.up('Control');
        await drawing.waitForFunction(() => editor.selected_box && Number(editor.selected_box.obj_track_id) > editor.data.world.sceneMeta.maxObjectId);
        const added = await drawing.evaluate(() => editor.data.world.annotation.boxToAnn(editor.selected_box));
        await page.screenshot({ path: path.join(temporary, 'embedded.png') });
        await page.getByRole('button', { name: '返回标注台', exact: true }).click();
        await page.locator('iframe').waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate(id => {
            const box = editor.dataManager.getFrameObject(editor.getCurrentFrame().id).find(box => box.userData.trackId === `sustech-${id}`);
            return box && { position: box.position.toArray(), scale: box.scale.toArray() };
        }, added.obj_id), { position: Object.values(added.psr.position), scale: Object.values(added.psr.scale) });
        console.log(`PASS embedded Ctrl-drag adds new target ${added.obj_id}, saved into current workbench`);
        await page.screenshot({ path: path.join(temporary, 'workbench.png') });
        assert.equal(page.context().pages().length, 1);
        assert.ok(!requests.some(url => url.includes(':3202/')));
        assert.deepEqual(errors, []);
        assert.deepEqual(hashes(), before);
        assert.ok(!fs.existsSync(path.join(scene, 'annotations/sustechpoints')));
        console.log(`PASS reload/reopen, one-click save-and-return, one page and one working document; original data unchanged; ${temporary}`);
    } finally { await browser.close(); await server.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });