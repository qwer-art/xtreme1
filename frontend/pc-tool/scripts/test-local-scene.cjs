const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Matrix4, Vector3, Quaternion, Euler } = require('three');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');

const url = process.env.TRIAL_URL || 'http://127.0.0.1:3200/local-trial';
const root = process.env.NUSCENES_ROOT || '/home/jerett/datasets/locomotion/nuscenes/v1.0-mini';
const table = name => JSON.parse(fs.readFileSync(path.join(root, 'v1.0-mini', `${name}.json`)));
const index = rows => new Map(rows.map(row => [row.token, row]));

function transform(row) {
    const [real, x, y, z] = row.rotation;
    return new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, real)).setPosition(...row.translation);
}

function fixture() {
    const scene = table('scene').find(row => row.name === 'scene-0061');
    const samples = new Set(table('sample').filter(row => row.scene_token === scene.token).map(row => row.token));
    const calibrations = index(table('calibrated_sensor'));
    const sensors = index(table('sensor'));
    const poses = index(table('ego_pose'));
    const all = table('sample_data').filter(row => samples.has(row.sample_token) &&
        sensors.get(calibrations.get(row.calibrated_sensor_token).sensor_token).channel === 'LIDAR_TOP')
        .sort((left, right) => left.timestamp - right.timestamp);
    const [first, second] = all.filter(row => row.is_key_frame);
    assert.equal(first.sample_token, 'ca9a282c9e77460f8360f564131a8af5');
    const world = row => transform(poses.get(row.ego_pose_token)).multiply(transform(calibrations.get(row.calibrated_sensor_token)));
    return { all, first, second, relative: world(second).invert().multiply(world(first)) };
}

function viewState() {
    const editor = window.editor;
    const xyz = value => [value.x, value.y, value.z];
    return editor.pc.getAnnotate3D().filter(object => !object.isHolder).map(object => {
        const { id, classId, trackId, trackName } = object.userData;
        return { id: id || object.uuid, classId, trackId, trackName, center: xyz(object.position),
            size: xyz(object.scale), rotation: xyz(object.rotation) };
    }).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function eventually(check) {
    const deadline = Date.now() + 12000;
    for (;;) {
        try { return await check(); } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 120));
        }
    }
}

async function run(browser) {
    const { all, first, second, relative } = fixture();
    const fresh = () => browser.newContext({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true });
    const writer = await fresh();
    let page = await writer.newPage();
    const control = name => page.getByTestId(`trial-${name}`);
    const snapshot = () => page.evaluate(viewState);
    const match = expected => eventually(async () => assert.deepEqual(await snapshot(), expected));
    const frame = async row => {
        await page.waitForFunction(({ token, sample, key }) => {
            const editor = window.editor;
            const id = editor?.getCurrentFrame()?.id;
            return (id === token || (key && id === sample)) && editor.pc.groupPoints.children[0]?.geometry.attributes.position.count > 0;
        }, { token: row.token, sample: row.sample_token, key: row.is_key_frame });
        await eventually(async () => assert.equal(await page.evaluate(() => window.editor.state.imgViews.length), row.is_key_frame ? 6 : 0));
    };
    const number = async (name, value) => {
        await control(name).fill(String(value));
        await control(name).press('Tab');
    };
    const open = async () => {
        page.setDefaultTimeout(12000);
        await page.goto(url);
        await control('mode').selectOption('key');
        await number('index', 1);
        await frame(first);
    };
    const key = async shortcut => {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press(shortcut);
    };
    const draw = async (className, horizontal) => {
        const before = await snapshot();
        const label = page.locator(`.class-title[title="${className}"]:visible`).or(
            page.getByText(className, { exact: true }).filter({ visible: true })).first();
        await label.click();
        const area = await page.locator('.main-view').first().boundingBox();
        assert.ok(area, 'main point-cloud view is visible');
        await key('f');
        for (const [left, top] of [[horizontal, .54], [horizontal + .07, .54], [horizontal + .07, .59]]) {
            await page.mouse.click(area.x + area.width * left, area.y + area.height * top);
        }
        return eventually(async () => {
            const after = await snapshot();
            assert.equal(after.length, before.length + 1, 'F and three clicks add exactly one box');
            const added = after.find(box => !before.some(old => old.id === box.id));
            assert.equal(added.classId, className);
            return added;
        });
    };
    const assign = async (id, track) => {
        await control('track').fill(track);
        await control('assign').click();
        await eventually(async () => {
            const box = (await snapshot()).find(item => item.id === id);
            assert.ok([box.trackId, box.trackName].includes(track), `assigned ${track} to ${id}`);
        });
    };
    const download = async () => {
        const pending = page.waitForEvent('download');
        await control('export').click();
        const file = await pending;
        assert.equal(await file.failure(), null);
        const buffer = fs.readFileSync(await file.path());
        JSON.parse(buffer);
        return { name: file.suggestedFilename(), mimeType: 'application/json', buffer };
    };

    await open();
    await match([]);
    console.log('A: native draws and track assignment');
    const manual = await draw('Car', .34);
    await assign(manual.id, '101');
    const source = await draw('Pedestrian', .57);
    await assign(source.id, '202');
    await key('Control+s');
    const savedA = await snapshot();
    const copy = control('copy');
    const copyToggle = await copy.evaluate(element => element.matches('input[type=checkbox], [role=checkbox]'));
    if (copyToggle) await copy.check();
    await control('next').click();
    await frame(second);
    if (!copyToggle) await copy.click();
    const copied = await eventually(async () => {
        const boxes = await snapshot();
        assert.equal(boxes.length, 1, 'only selected A box copied');
        return boxes[0];
    });
    const original = savedA.find(box => box.id === source.id);
    assert.ok(!savedA.some(box => box.id === copied.id), 'copy has a fresh object id');
    for (const field of ['classId', 'trackId', 'trackName']) assert.equal(copied[field], original[field]);
    const predicted = new Vector3(...original.center).applyMatrix4(relative);
    assert.ok(predicted.distanceTo(new Vector3(...copied.center)) < 1e-4, 'B center = inv(worldFromB) * worldFromA * centerA');
    assert.deepEqual(copied.size, original.size);
    const forward = new Vector3(1, 0, 0).applyEuler(new Euler(...original.rotation)).transformDirection(relative);
    const actual = new Vector3(1, 0, 0).applyEuler(new Euler(...copied.rotation));
    assert.ok(Math.abs(Math.atan2(forward.x * actual.y - forward.y * actual.x, forward.x * actual.x + forward.y * actual.y)) < 1e-4, 'pose-compensated heading');
    if (copyToggle) await copy.uncheck();

    console.log('B: independent native draw, shared track and translation');
    const added = await draw('Car', .36);
    await assign(added.id, '101');
    await key('d');
    await eventually(async () => assert.notDeepEqual((await snapshot()).find(box => box.id === added.id).center, added.center));
    const savedB = await snapshot();
    assert.deepEqual(savedB.find(box => box.id === copied.id), copied);
    assert.equal(new Set([...savedA, ...savedB].map(box => box.id)).size, 4);
    assert.equal(savedA.find(box => box.id === manual.id).trackId, savedB.find(box => box.id === added.id).trackId);
    await control('overlay').check();
    await number('radius', 2);
    await match(savedB);
    await control('overlay').uncheck();
    await match(savedB);
    await key('Control+s');
    await control('prev').click();
    await frame(first);
    await match(savedA);

    async function verifyBoth() {
        await match(savedA);
        await control('next').click();
        await frame(second);
        await match(savedB);
        await control('mode').selectOption('all');
        await frame(second);
        assert.equal(Number(await control('index').inputValue()), all.indexOf(second) + 1);
        await match(savedB);
        const between = all.indexOf(second) - 1;
        assert.ok(!all[between].is_key_frame);
        await number('index', between + 1);
        await frame(all[between]);
        await match([]);
        await control('next').click();
        await frame(second);
        await control('mode').selectOption('key');
        await frame(second);
        assert.equal(await control('index').inputValue(), '2');
        await match(savedB);
    }

    console.log('Reopen saved frames, switch modes, check nonkey cameras and download');
    await page.close();
    page = await writer.newPage();
    await open();
    await verifyBoth();
    const file = await download();
    await writer.close();
    console.log(`Fresh profile: import ${file.name} (${file.buffer.length} bytes)`);
    const reader = await fresh();
    page = await reader.newPage();
    await open();
    await match([]);
    await control('next').click();
    await frame(second);
    await match([]);
    await control('prev').click();
    await frame(first);
    await control('import').setInputFiles(file);
    await verifyBoth();
    await reader.close();
    console.log('PASS scene-0061: 2 labeled frames, 4 distinct boxes, 2 shared tracks');
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        headless: true, args: ['--enable-unsafe-swiftshader'] });
    try { await run(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });