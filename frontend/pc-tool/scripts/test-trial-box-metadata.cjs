const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');

async function run() {
    const root = path.resolve(__dirname, '..');
    const original = path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-box-metadata-'));
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
        logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        args: ['--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/local-trial`);
        await page.waitForFunction(() => window.editor?.getCurrentFrame());
        await page.getByTestId('trial-index').fill('4');
        await page.getByTestId('trial-index').press('Enter');
        await page.waitForFunction(() => editor.state.frameIndex === 3 && !editor.state.loading);
        const fixture = await page.evaluate(async () => {
            const api = await import('/src/common/trialAnnotations.ts');
            const { scans } = await import('/src/common/trialScene.ts');
            const THREE = await import('/node_modules/three/build/three.module.js');
            const document = await api.exportAnnotations(editor);
            document.frames.forEach(frame => { frame.boxes = []; });
            const current = scans.find(scan => scan.id === editor.getCurrentFrame().id);
            const next = scans.filter(scan => scan.views.length && scan.timestamp > current.timestamp)[0];
            const world = new THREE.Vector3(10, 0, 0).applyMatrix4(new THREE.Matrix4().fromArray(current.worldFromLidar));
            const seconds = (next.timestamp - current.timestamp) / 1e6;
            const nextCenter = world.clone().add(new THREE.Vector3(seconds * 2, 0, 0))
                .applyMatrix4(new THREE.Matrix4().fromArray(next.worldFromLidar).invert()).toArray();
            const makeBox = (id, track, center) => ({ bbox_id: id, track_id: track, track_name: track,
                class_id: 'Pedestrian', center, size: [.5, .5, 1.8], rotation: [0, 0, 0] });
            document.frames.find(frame => frame.scan_id === current.id).boxes = [
                makeBox('metadata-moving', 'person-7', [10, 0, 0]),
                makeBox('metadata-single', 'sustech-new-single', [14, 6, 0]),
            ];
            document.frames.find(frame => frame.scan_id === next.id).boxes = [makeBox('metadata-next', 'person-7', nextCenter)];
            await api.importAnnotations(editor, document);
            editor.pc.selectObject(editor.dataManager.getFrameObject(current.id).find(box => box.uuid === 'metadata-moving'));
            editor.pc.render();
            return { scanId: current.id, seconds };
        });
        await page.getByTestId('trial-selected-identity').filter({ hasText: 'ID person-7' }).waitFor();
        const moving = page.locator('[data-box-id="metadata-moving"]');
        await moving.waitFor();
        assert.match(await moving.innerText(), /idx 1/);
        assert.match(await moving.innerText(), /ID person-7/);
        assert.match(await moving.innerText(), /语义 Pedestrian/);
        assert.match(await moving.innerText(), /速度 2\.00 m\/s/);
        assert.match(await page.locator('[data-box-id="metadata-single"]').innerText(), /idx 2[\s\S]*待同 ID 第二帧/);
        const stored = JSON.parse(fs.readFileSync(path.join(scene, 'annotations/working/scene-0061.json')));
        const boxes = stored.frames.find(frame => frame.scan_id === fixture.scanId).boxes;
        assert.equal(boxes[0].idx, 1);
        assert.ok(Math.abs(boxes[0].velocity.speed_mps - 2) < 1e-8);
        assert.equal(boxes[0].velocity.interval_s, fixture.seconds);
        assert.equal(boxes[1].velocity.speed_mps, null);
        await page.screenshot({ path: path.join(temporary, 'desktop.png') });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(() => { window.dispatchEvent(new Event('resize')); editor.pc.render(); });
            await page.screenshot({ path: path.join(temporary, `${width}.png`) });
            const layout = await page.getByTestId('trial-box-label').evaluateAll(labels => labels.map(label => ({
                width: label.clientWidth, content: label.scrollWidth,
                left: label.getBoundingClientRect().left, right: label.getBoundingClientRect().right,
                top: label.getBoundingClientRect().top, bottom: label.getBoundingClientRect().bottom,
            })));
            assert.ok(layout.length >= (width === 1440 ? 2 : 1));
            assert.ok(await moving.isVisible());
            layout.forEach(label => { assert.ok(label.content <= label.width); assert.ok(label.left >= 0 && label.right <= width); });
            layout.forEach((label, index) => layout.slice(index + 1).forEach(other => {
                assert.ok(label.right <= other.left || other.right <= label.left || label.bottom <= other.top || other.bottom <= label.top);
            }));
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(async () => {
            const api = await import('/src/common/trialAnnotations.ts');
            api.assignTrack(editor, 'person-new');
        });
        await page.waitForFunction(() => document.querySelector('[data-box-id="metadata-moving"]')?.textContent.includes('待同 ID 第二帧'));
        assert.match(await moving.innerText(), /ID person-new/);
        const exported = await page.evaluate(async () => (await import('/src/common/trialAnnotations.ts')).exportAnnotations(editor));
        assert.equal(exported.frames.find(frame => frame.scan_id === fixture.scanId).boxes[0].velocity.speed_mps, null);
        await page.reload();
        await page.waitForFunction(() => window.editor?.getCurrentFrame());
        await page.getByTestId('trial-index').fill('4'); await page.getByTestId('trial-index').press('Enter');
        await moving.waitFor();
        assert.match(await moving.innerText(), /ID person-new[\s\S]*待同 ID 第二帧/);
        assert.deepEqual(errors, []);
        assert.deepEqual(hashes(), before);
        console.log(`PASS label idx/ID/semantics/2mps, single-frame missing state, stored velocity, reassignment and reload, desktop/mobile bounds; original data unchanged; ${temporary}`);
    } finally { await browser.close(); await server.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });