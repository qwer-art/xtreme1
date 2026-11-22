const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');
const url = process.env.TRIAL_URL || 'http://127.0.0.1:3200/local-trial';
const channel = process.env.TRIAL_CAMERA || 'CAM_FRONT_LEFT';
const rect = (process.env.TRIAL_RECT || '1260,320,1548,899').split(',').map(Number);

async function run(browser) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
    const writes = [];
    await page.route('**/*', route => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
        writes.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const pager = page.getByTestId('trial-index');
    await pager.fill('4'); await pager.press('Enter');
    await page.waitForFunction(() => window.editor?.getCurrentFrame()?.id === 'c4f1a270736445e185379a80c29a5139');
    const camera = page.getByRole('button', { name: channel, exact: true });
    await camera.click();
    const tool = page.getByTestId('camera-pedestrian-toggle'), layer = page.getByTestId('camera-pedestrian-drag');
    await tool.click(); await layer.waitFor(); await page.keyboard.press('Escape'); await layer.waitFor({ state: 'detached' });
    await tool.click(); await page.locator(`.camera-picker button:not([data-slot="${channel}"])`).first().click();
    await camera.click(); assert.equal(await layer.count(), 0);
    await page.getByTestId('trial-instances-tab').click();
    const stage = await page.locator('.camera-stage .render:visible').boundingBox();
    await page.mouse.move(stage.x + stage.width * .88, stage.y + stage.height * .98);
    await page.mouse.wheel(0, -28);
    await page.waitForFunction(() => document.querySelector('.camera-stage .camera-zoomed'));
    const [start, end] = await page.evaluate(([left, top, right, bottom]) => {
        window.editor.addEventListener('trial-camera-pedestrian-rect', event => { window.draggedPixels = event.data.rect; });
        const view = window.renderProxy.views.find(item => item.container.offsetWidth);
        window.renderProxy.renderFrame();
        return [[right, top], [left, bottom]].map(([x, y]) => {
            const point = { x, y }; view.imgToDom(point);
            return { x: point.x + view.clientRect.left, y: point.y + view.clientRect.top };
        });
    }, rect);
    const row = page.getByTestId('camera-pedestrian-candidate');
    await tool.click(); await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up(); await row.waitFor();
    const actual = await page.evaluate(() => window.draggedPixels);
    [actual.left, actual.top, actual.right, actual.bottom].forEach((value, index) => assert.ok(Math.abs(value - rect[index]) < 4));
    assert.equal(await page.getByTestId('trial-review-tab').getAttribute('aria-pressed'), 'true');
    assert.equal(await row.getByRole('button', { name: /Pedestrian/ }).getAttribute('aria-pressed'), 'true');
    assert.ok(await row.getByTestId('point-sam-accept').isEnabled());
    function inspectOutline() {
        const proxy = window.renderProxy, view = proxy.views.find(item => item.container.offsetWidth);
        view.renderBox = false; proxy.renderFrame();
        const edge = view.pointCloud.scene.getObjectByName('trial-candidate-preview')?.children[0];
        if (!edge) return 0;
        let hits = 0;
        const vertices = edge.geometry.getAttribute('position'), corner = edge.position.clone();
        const pixel = index => view.worldToImg(corner.fromBufferAttribute(vertices, index).applyMatrix4(edge.matrixWorld)).clone();
        for (let index = 0; index < vertices.count; index += 2) {
            const mid = pixel(index).lerp(pixel(index + 1), .5); view.imgToDom(mid);
            const image = proxy.context.getImageData(Math.round(mid.x + view.proxyOffset.x) - 2, Math.round(mid.y + view.proxyOffset.y) - 2, 5, 5).data;
            if (image.some((value, offset) => offset % 4 === 0 && value === 0x76 && image[offset + 1] === 0xe8 && image[offset + 2] === 0xbb)) hits++;
        }
        return hits;
    }
    assert.ok(await page.evaluate(inspectOutline) >= 6, 'missing calibrated photo outline');
    await page.getByText('微调候选框', { exact: true }).click();
    const height = page.getByRole('spinbutton', { name: 'size-2', exact: true });
    const nextHeight = Number(await height.inputValue()) + .2;
    await height.fill(String(nextHeight)); await height.press('Tab');
    assert.ok(await page.evaluate(inspectOutline) >= 6, 'adjusted outline missing');
    await row.getByTestId('point-sam-reject').click(); await row.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(inspectOutline), 0);
    await tool.tap();
    const touch = await page.context().newCDPSession(page);
    for (const [type, touchPoints] of [['touchStart', [start]], ['touchMove', [end]], ['touchEnd', []]])
        await touch.send('Input.dispatchTouchEvent', { type, touchPoints });
    await row.waitFor(); await row.getByTestId('point-sam-reject').click();
    assert.deepEqual(writes, []);
    console.log('PASS escape, camera switch, zoomed raw pixels, mouse + touch rectangles, selected Pedestrian review, calibrated photo pixels, adjustment, rejection, zero writes');
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader'] });
    try { await run(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });