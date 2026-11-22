const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { rawPoints, support } = require('./centerpoint-bev.cjs');
const { inspectScene, matches, captureBev } = require('./centerpoint-render.cjs');
const os = require('node:os');

const databaseRoot = process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini');
const sceneRoot = path.join(databaseRoot, 'scene-0061');
const sourceRoot = process.env.XTREME1_SOURCE_ROOT || path.join(sceneRoot, 'source');
const predictionRoot = path.join(sceneRoot, 'predictions/centerpoint-pubtracker');
const screenshot = process.env.TRIAL_SCREENSHOT || '/home/jerett/main/daily/xtreme1/centerpoint-scene-0061-all-classes.png';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const round = value => Number(value.toFixed(5));
const reviewable = box => ['Car', 'Pedestrian', 'Bicycle', 'Motorcycle'].includes(box.category) && box.score >= 0.5;
const sourceAsset = url => path.join(sourceRoot, url.replace(/^\/local-scene\//, ''));

function prepare() {
    const pointerPath = path.join(predictionRoot, 'active.json');
    assert.ok(fs.existsSync(pointerPath), `BLOCKED: missing active inference pointer: ${pointerPath}`);
    const pointer = JSON.parse(fs.readFileSync(pointerPath));
    const artifact = path.join(predictionRoot, 'runs', pointer.runId, pointer.tracking || 'tracking.json');
    assert.ok(fs.existsSync(artifact), `BLOCKED: missing active tracking result: ${artifact}`);
    const bytes = fs.readFileSync(artifact), predictions = JSON.parse(bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'index.json')));
    assert.equal(predictions.model, 'CenterPoint');
    assert.equal(predictions.scene, 'scene-0061');
    assert.equal(predictions.scene, manifest.scene);
    assert.ok(predictions.frames && !Array.isArray(predictions.frames) && typeof predictions.frames === 'object');
    const scans = new Set(manifest.frames.map(scan => scan.id));
    for (const [scanId, boxes] of Object.entries(predictions.frames)) {
        assert.ok(scans.has(scanId) && Array.isArray(boxes), `invalid lidarScanId: ${scanId}`);
        for (const box of boxes) {
            assert.ok(typeof box.id === 'string' && box.id.trim());
            const tracked = ['Car', 'Pedestrian', 'Bus', 'Truck', 'Trailer', 'Motorcycle', 'Bicycle'].includes(box.category);
            assert.ok(tracked || ['TrafficCone', 'Barrier', 'ConstructionVehicle'].includes(box.category));
            assert.ok(tracked ? typeof box.trackId === 'string' && box.trackId.trim() : box.trackId === null);
            assert.ok(box.velocityWorldXY.length === 2 && box.velocityWorldXY.every(Number.isFinite));
            for (const field of ['center', 'size']) assert.ok(Array.isArray(box[field]) && box[field].length === 3 && box[field].every(Number.isFinite));
            assert.ok(box.size.every(value => value > 0) && Number.isFinite(box.yaw));
            assert.ok(Number.isFinite(box.score) && box.score >= 0 && box.score <= 1);
        }
        for (const key of ['id', 'trackId']) {
            const values = boxes.map(box => box[key]).filter(value => value !== null);
            assert.equal(new Set(values).size, values.length, `duplicate ${key} in ${scanId}`);
        }
    }
    const keys = manifest.frames.filter(scan => scan.keyframe).map(frame => ({
        ...frame,
        pointsUrl: `/local-scene/${frame.cloud}`,
    }));
    const scan = keys.find(item => predictions.frames[item.id]?.filter(reviewable).length >= 3);
    assert.ok(scan && keys.length >= 2, 'BLOCKED: need a keyframe with >=3 real candidates and another keyframe');
    const allBoxes = predictions.frames[scan.id];
    const boxes = allBoxes.filter(reviewable);
    const other = keys.find(item => item !== scan && predictions.frames[item.id]?.some(box => reviewable(box) && boxes.some(first => first.trackId === box.trackId))) || keys.find(item => item !== scan && predictions.frames[item.id]?.some(reviewable));
    assert.ok(other, 'BLOCKED: need another keyframe with reviewable candidates');
    const points = rawPoints(fs.readFileSync(sourceAsset(scan.pointsUrl)));
    const evidence = allBoxes.map(box => support(points, box)).sort((first, second) => second.inside - first.inside);
    console.log('BEV raw LIDAR_TOP; local spans L/W/H and +/-1.5W comparison windows (metres)', JSON.stringify({
        scan: scan.id, pcd: scan.pointsUrl, points: points.length, candidates: boxes.length,
        supported: evidence.filter(item => item.supported).length, best: evidence.slice(0, 3), predictionSha256: digest(bytes),
    }, null, 2));
    assert.ok(evidence.some(box => box.supported), 'no box has >=8 returns, >=2 upper-half returns, >=0.3m vertical span and >=25% footprint span');
    return { bytes, predictions, keys, scan, other, boxes, points, evidence };
}

const formalId = (scan, box) => `centerpoint:${scan.id}:${box.id}`;

async function eventually(label, check) {
    const deadline = Date.now() + 20000;
    let last;
    do {
        try { return await check(); } catch (error) { last = error; }
        await new Promise(resolve => setTimeout(resolve, 125));
    } while (Date.now() < deadline);
    throw new Error(`${label}: ${last.message}`);
}

async function browserRun(data) {
    const url = new URL(process.env.TRIAL_URL || 'http://127.0.0.1:3200/local-trial');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/local-trial' && url.protocol === 'http:');
    const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
        args: ['--enable-unsafe-swiftshader'] });
    try {
        const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
        assert.deepEqual((await context.storageState()).origins, []);
        const forbidden = [], predictionResponses = [];
        await context.route(/^https?:/, route => {
            const request = route.request(), target = new URL(request.url());
            const databaseWrite = /^\/trial-data\/(?:annotations|annotations\/archive|reviews)$/.test(target.pathname);
            if (/\/(?:segment(?:ation)?)(?:\/|$)/i.test(target.pathname) ||
                (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !databaseWrite)) {
                forbidden.push(`${request.method()} ${target.pathname}`); return route.abort();
            }
            return target.origin === url.origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on('response', response => {
            if (new URL(response.url()).pathname === '/trial-data/centerpoint') predictionResponses.push(response);
        });
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        const test = name => page.getByTestId(name);
        if (data) {
            const emptyDatabaseStatus = await page.evaluate(() => fetch('/trial-data/annotations', { cache: 'no-store' }).then(response => response.status));
            assert.equal(emptyDatabaseStatus, 404, 'opening with an empty browser profile must not persist an empty document');
        }
        if (!data) {
            const state = await eventually('isolated raw cloud', async () => {
                const state = await page.evaluate(inspectScene); assert.ok(state?.count > 0 && state.id); return state;
            });
            const scan = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'index.json'))).frames.find(item => item.id === state.id);
            verifyRaw(state, rawPoints(fs.readFileSync(sourceAsset(`/local-scene/${scan.cloud}`))));
            assert.deepEqual(forbidden, []);
            console.log(`PROBE ONLY: isolated Chrome ${browser.version()}, ${state.id}: ${state.count} points; no review, no screenshot`); return;
        }
        const { scan, keys, other, boxes } = data;
        const go = async frame => {
            const field = test('trial-index'), index = String(keys.indexOf(frame) + 1);
            await page.waitForFunction(() => window.editor?.getCurrentFrame()?.id && !document.querySelector('[data-testid="trial-index"]')?.matches(':disabled'));
            if (await field.inputValue() !== index) { await field.fill(index); await field.press('Enter'); }
            await page.waitForFunction(id => window.editor?.getCurrentFrame()?.id === id, frame.id);
        };
        const rows = page.locator('[data-testid="centerpoint-panel"] [data-candidate-id]');
        const row = async box => {
            const group = page.locator(`.cp-group[data-category="${box.category}"]`);
            const toggle = group.locator('.cp-type');
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            const ids = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.candidateId));
            assert.ok(ids.includes(box.id), `missing review row ${box.id}`);
            return rows.nth(ids.indexOf(box.id));
        };
        const checkFrame = (frame, pending, accepted) => eventually(`frame ${frame.id}: review/render/save`, async () => {
            const state = await page.evaluate(inspectScene);
            assert.equal(state?.id, frame.id);
            const ids = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.candidateId));
            assert.deepEqual(ids.sort(), pending.map(box => box.id).sort(), 'review rows');
            assert.deepEqual(state.previews.map(box => box.id).sort(), pending.map(box => formalId(frame, box)).sort(), 'rendered candidates');
            for (const box of pending) assert.ok(matches(state.previews.find(item => item.id === formalId(frame, box)), box), `3D vertices or heading: ${box.id}`);
            const expected = accepted.map(box => ({ ...canonical(box), id: formalId(frame, box) }));
            equalBoxes(state.accepted.map(canonical), expected);
            const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('xtreme1:local-trial:v3:scene-0061'))?.frames.find(frame => frame.scan_id === id)?.boxes || [], frame.id);
            equalBoxes(saved.map(box => canonical({ id: box.bbox_id, trackId: box.track_id, category: box.class_id,
                center: box.center, size: box.size, yaw: box.rotation[2] })), expected);
            assert.deepEqual(forbidden, []);
            return state;
        });
        console.log('1/4: automatic candidates, raw PCD, measured 3D geometry and BEV pixels');
        await go(scan);
        const first = await checkFrame(scan, boxes, []);
        verifyRaw(first, data.points);
        assert.ok(predictionResponses.length, 'page never requested real centerpoint.json');
        assert.equal(digest(await predictionResponses[0].body()), digest(data.bytes), 'served predictions differ from disk');
        const target = data.evidence.find(item => item.supported && data.boxes.some(box => box.id === item.id));
        assert.ok(target, 'no reviewable candidate has sufficient raw point-cloud support');
        const captured = await captureBev(page, target);
        assert.ok(captured.hits.filter(count => count >= 7).length >= 3 && captured.cloudPixels >= 8,
            `BEV screenshot lacks edges/returns: hits=${captured.hits}; cloudPixels=${captured.cloudPixels}`);
        console.log(`BEV image: scan=${scan.id}, candidate=${target.id}, focused hits(out of 12)=${captured.hits}, cloudPixels=${captured.cloudPixels}`);

        console.log('2/4: edit and reject exceptions, confirm the frame');
        const otherBoxes = (data.predictions.frames[other.id] || []).filter(reviewable);
        const original = boxes.find(box => otherBoxes.some(item => item.trackId === box.trackId)) || boxes[0];
        const cameraVisible = await page.evaluate(() => {
            const group = window.editor.pc.scene.getObjectByName('centerpoint-preview');
            const views = window.editor.pc.renderViews.filter(view => view.name.startsWith('image-2d-small-'));
            return group.children.filter(edge => edge.name.startsWith('centerpoint:')).filter(edge => {
                const box = edge.getObjectByName('centerpoint-bounds');
                return views.some(view => {
                    const { center, size } = view.getBoxRect(box);
                    return center.x + size.x / 2 > 0 && center.x - size.x / 2 < view.imgSize.x &&
                        center.y + size.y / 2 > 0 && center.y - size.y / 2 < view.imgSize.y;
                });
            }).map(edge => edge.name);
        });
        const choices = boxes.filter(box => box !== original);
        const toEdit = choices.find(box => cameraVisible.includes(formalId(scan, box)));
        assert.ok(toEdit, 'no remaining candidate projects into a camera image');
        const toReject = choices.find(box => box !== toEdit);
        assert.ok(toReject, 'need another candidate to reject');
        await (await row(toEdit)).getByTestId('centerpoint-select').click();
        const linked = await eventually('selected candidate linked to camera and orthogonal views', async () => {
            const state = await page.evaluate(inspectScene);
            assert.equal(state.selectedPreview, formalId(scan, toEdit));
            assert.match(state.previewLabel, /^#\d+ ID:/);
            assert.deepEqual(state.sideViews.map(view => view.axis).sort(), ['-x', '-y', 'z']);
            assert.ok(state.sideViews.every(view => view.targetId === formalId(scan, toEdit) && view.visualId === formalId(scan, toEdit)));
            return state;
        });
        const sensor = await page.evaluate(id => {
            const group = window.editor.pc.scene.getObjectByName('centerpoint-preview');
            const edge = group.children.find(object => object.name === id);
            const box = edge.getObjectByName('centerpoint-bounds');
            const view = window.editor.pc.renderViews.find(candidate => {
                if (!candidate.name.startsWith('image-2d-small-')) return false;
                const { center, size } = candidate.getBoxRect(box);
                return center.x + size.x / 2 > 0 && center.x - size.x / 2 < candidate.imgSize.x &&
                    center.y + size.y / 2 > 0 && center.y - size.y / 2 < candidate.imgSize.y;
            });
            return window.editor.state.imgViews.find(camera => camera.imgObject?.src === view?.img?.src)?.name;
        }, formalId(scan, toEdit));
        assert.ok(sensor, 'selected candidate has no camera projection');
        await page.locator(`.camera-picker [data-slot="${sensor}"]`).click();
        await page.waitForFunction(name => window.editor.pc.renderViews.some(view =>
            view.name.startsWith('image-2d-small-') && view.isViewRenderable() &&
            view.img?.src === window.editor.state.imgViews.find(camera => camera.name === name)?.imgObject?.src), sensor);
        const cameraLabels = await page.evaluate(() => {
            const view = window.editor.pc.renderViews.find(view => view.name.startsWith('image-2d-small-') && view.isViewRenderable());
            if (!view) throw new Error('no active camera view');
            const context = view.proxy.context, fillText = context.fillText, labels = [];
            context.fillText = function (text, ...args) { labels.push(String(text)); return fillText.call(this, text, ...args); };
            try { view.renderPreviewBoxes(); }
            finally { context.fillText = fillText; }
            const group = window.editor.pc.scene.getObjectByName('centerpoint-preview');
            const expected = group.children.filter(edge => edge.name.startsWith('centerpoint:') && edge.visible).filter(edge => {
                const box = edge.getObjectByName('centerpoint-bounds');
                const { center, size } = view.getBoxRect(box);
                return center.x + size.x / 2 >= 0 && center.x - size.x / 2 <= view.imgSize.x &&
                    center.y + size.y / 2 >= 0 && center.y - size.y / 2 <= view.imgSize.y;
            }).map(edge => edge.getObjectByName('centerpoint-label').userData.text);
            return { labels, expected };
        });
        assert.ok(cameraLabels.expected.length > 1, 'test camera should show multiple candidate boxes');
        assert.deepEqual(cameraLabels.labels.filter(label => cameraLabels.expected.includes(label)).sort(),
            cameraLabels.expected.sort(), 'camera must label every projected candidate with the same point-cloud index and track ID');
        assert.ok(cameraLabels.expected.includes(linked.previewLabel), `selected camera label missing: ${linked.previewLabel}`);
        const edited = { ...toEdit, center: [...toEdit.center], size: [...toEdit.size], yaw: round(toEdit.yaw + 0.21) };
        edited.center[0] = round(toEdit.center[0] + 0.37); edited.size[0] = round(toEdit.size[0] + 0.26);
        for (const [label, value] of [['center-0', edited.center[0]], ['size-0', edited.size[0]], ['yaw', edited.yaw]]) {
            const field = test('centerpoint-adjust').getByLabel(label, { exact: true });
            await field.fill(String(value)); await field.press('Tab');
        }
        const adjusted = boxes.map(box => box === toEdit ? edited : box);
        await checkFrame(scan, adjusted, []);
        const accepted = adjusted.filter(box => box !== toReject);
        await (await row(toReject)).getByTestId('centerpoint-reject').click();
        await checkFrame(scan, accepted, []);
        await test('centerpoint-confirm').click();
        await checkFrame(scan, [], accepted);

        console.log('3/4: different scan, shared track when available, return to edited frame');
        await go(other); await checkFrame(other, otherBoxes, []);
        const shared = otherBoxes.find(box => box.trackId === original.trackId);
        if (otherBoxes.length) await test('centerpoint-confirm').click();
        await checkFrame(other, [], otherBoxes);
        await go(scan); await checkFrame(scan, [], accepted);
        console.log('4/4: reload, verify complete formal and pending sets on both scans');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await go(scan); await checkFrame(scan, [], accepted);
        await go(other); await checkFrame(other, [], otherBoxes);
        await page.getByRole('button', { name: '文件' }).click();
        await test('trial-archive').click();
        const archiveStatus = await eventually('confirmed annotations archived to database', async () => {
            const text = await test('trial-archive-status').textContent();
            assert.match(text || '', /^已归档版本 /);
            return text;
        });
        assert.ok(predictionResponses.length >= 2, 'missing offline reload');
        assert.equal(digest(await predictionResponses.at(-1).body()), digest(data.bytes));
        assert.deepEqual(forbidden, []);
        fs.mkdirSync(path.dirname(screenshot), { recursive: true });
        try { fs.writeFileSync(screenshot, captured.png, { flag: 'wx' }); console.log(`Saved ${screenshot}`); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            assert.equal(digest(fs.readFileSync(screenshot)), digest(captured.png), `existing PNG differs from the verified live capture; preserved ${screenshot}`);
            console.log(`Existing PNG identical to live capture: ${screenshot}`);
        }
        console.log(`PASS real CenterPoint; edited=${edited.id}, rejected=${toReject.id}, accepted track=${original.trackId}, cross-frame=${shared?.trackId ?? 'no shared ID in input'}, archive=${archiveStatus}, segmentationRequests=0`);
    } finally { await browser.close(); }
}

function verifyRaw(state, points) {
    assert.equal(state.count, points.length);
    for (const [ordinal, index] of [0, Math.floor(points.length / 2), points.length - 1].entries()) {
        assert.ok(points[index].every((value, axis) => Math.abs(value - state.probes[ordinal][axis]) < 0.0001), `raw/render point ${index}`);
    }
}
function canonical(box) {
    return { id: box.id, trackId: box.trackId, category: box.category, center: box.center.map(round), size: box.size.map(round), yaw: round(Math.atan2(Math.sin(box.yaw), Math.cos(box.yaw))) };
}
function equalBoxes(actual, expected) {
    const sorted = boxes => [...boxes].sort((first, second) => first.id.localeCompare(second.id));
    assert.deepEqual(sorted(actual), sorted(expected));
}

async function main() {
    const mode = process.argv[2];
    if (!process.env.XTREME1_DB_ROOT && mode !== '--assets')
        throw new Error('Set XTREME1_DB_ROOT to an isolated test database; browser tests write annotations.');
    if (mode === '--probe-browser') return browserRun();
    assert.ok(!mode || mode === '--assets', `unknown mode ${mode}`);
    const data = prepare();
    if (!mode) await browserRun(data);
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });