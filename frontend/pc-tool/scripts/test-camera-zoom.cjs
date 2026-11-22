const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/home/jerett/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/node_modules/playwright-core');
const url = process.env.TRIAL_URL || 'http://127.0.0.1:3200/local-trial';

async function openCamera(browser, options) {
    const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
    const writes = [];
    await page.route('**/*', route => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
        writes.push(route.request().method() + ' ' + route.request().url());
        return route.abort();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const stage = page.locator('.camera-stage .render:visible');
    await stage.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.camera-picker img')].every(image => image.naturalWidth));
    const rect = await stage.boundingBox();
    const point = { x: Math.round(rect.x + rect.width * .4), y: Math.round(rect.y + rect.height * .55) };
    const button = name => page.getByRole('button', { name, exact: true });
    return { page, stage, point, button, writes };
}

function inspect(point) {
    const proxy = window.renderProxy, view = proxy.views.find(item => item.container.offsetWidth);
    const renderFrame = view.renderFrame, gl = proxy.renderer.getContext();
    let matrix, viewport, scissor;
    view.renderFrame = function () {
        renderFrame.call(this);
        matrix = proxy.context.getTransform();
        viewport = gl.getParameter(gl.VIEWPORT);
        scissor = gl.getParameter(gl.SCISSOR_BOX);
    };
    try { proxy.renderFrame(); } finally { view.renderFrame = renderFrame; }
    const rect = view.clientRect, rail = proxy.clientRect;
    const pixel = { x: point.x - rect.left, y: point.y - rect.top };
    view.domToImg(pixel);
    const onCanvas = matrix.transformPoint(pixel);
    const ratio = proxy.renderer.getPixelRatio();
    const projectX = (viewport[0] + pixel.x / view.img.naturalWidth * viewport[2]) / ratio;
    const projectY = rail.height - (viewport[1] + (1 - pixel.y / view.img.naturalHeight) * viewport[3]) / ratio;
    const reference = document.createElement('canvas');
    reference.width = proxy.canvas.width; reference.height = proxy.canvas.height;
    const context = reference.getContext('2d');
    context.setTransform(matrix);
    context.drawImage(view.img, 0, 0);
    const pixels = ctx => ctx.getImageData(0, 0, reference.width, reference.height).data;
    const actual = pixels(proxy.context), expected = pixels(context);
    let matches = 0, samples = 0;
    for (let row = 1; row < 10; row++) for (let col = 1; col < 10; col++) {
        const x = Math.round(rect.left - rail.left + col * rect.width / 10);
        const y = Math.round(rect.top - rail.top + row * rect.height / 10);
        const offset = (y * reference.width + x) * 4;
        if (expected[offset + 3] !== 255) continue;
        samples++;
        if (actual.subarray(offset, offset + 4).every((value, index) => value === expected[offset + index])) matches++;
    }
    return { pixel, zoom: view.containerMatrix.elements[0], sourceScale: matrix.a, matches, samples,
        offset: view.containerMatrix.elements.slice(12, 14),
        cursorError: Math.hypot(onCanvas.x + rail.left - point.x, onCanvas.y + rail.top - point.y),
        projectionError: Math.hypot(projectX - onCanvas.x, projectY - onCanvas.y),
        clipped: scissor[0] / ratio >= rect.left - rail.left - 1 && scissor[1] / ratio >= rail.bottom - rect.bottom - 1 &&
            (scissor[0] + scissor[2]) / ratio <= rect.right - rail.left + 1 && (scissor[1] + scissor[3]) / ratio <= rail.bottom - rect.top + 1 };
}

async function desktop(browser) {
    const { page, stage, point, button, writes } = await openCamera(browser, { viewport: { width: 1440, height: 900 } });
    const sample = () => page.evaluate(inspect, point);
    const rail = page.locator('.camera-picker');
    const before = await sample();
    const tiles = await rail.screenshot();
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -240);
    await page.waitForFunction(() => document.querySelector('.camera-zoomed'));
    const wheel = await sample();
    assert.ok(wheel.zoom > 1);
    assert.ok(Math.hypot(before.pixel.x - wheel.pixel.x, before.pixel.y - wheel.pixel.y) < 1e-7);
    await page.mouse.down(); await page.mouse.move(point.x + 19, point.y + 13); await page.mouse.up();
    const pan = await sample();
    assert.deepEqual(pan.offset.map((value, index) => Math.round(value - wheel.offset[index])), [19, 13]);
    await button('放大图像').press('Enter'); await button('放大图像').click();
    const native = await sample();
    assert.ok(native.sourceScale > 1, 'source pixels should be individually inspectable');
    for (const state of [before, wheel, pan, native]) {
        assert.ok(state.samples >= 30 && state.matches > state.samples * .5, `original-photo samples ${state.matches}/${state.samples}`);
        assert.ok(state.cursorError < 1e-4 && state.projectionError < 2 && state.clipped, JSON.stringify(state));
    }
    assert.ok(tiles.equals(await rail.screenshot()), 'thumbnail strip including projected outlines changed');
    await stage.dblclick({ position: { x: 75, y: 75 } });
    await button('返回点云').click();
    await button('恢复全图').click();
    const reset = await sample();
    assert.deepEqual([reset.zoom, ...reset.offset], [1, 0, 0]);
    assert.deepEqual(reset.pixel, before.pixel);
    assert.deepEqual(writes, []);
    console.log(`PASS desktop: cursor anchor, drag (19,13), keyboard +, optical scale ${native.sourceScale.toFixed(2)}, original pixels ${native.matches}/${native.samples}, GL error ${native.projectionError.toFixed(2)} px, identical thumbnails, expand/return/reset; 0 writes`);
    await page.close();
}

async function mobile(browser) {
    const { page, point, button, writes } = await openCamera(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const plus = button('放大图像'), bounds = await plus.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
    await plus.tap(); await plus.tap(); await button('缩小图像').tap();
    const sample = () => page.evaluate(inspect, point);
    const before = await sample();
    assert.equal(before.zoom, 1.5);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 20, y: point.y + 12 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await sample();
    assert.deepEqual(after.offset.map((value, index) => Math.round(value - before.offset[index])), [20, 12]);
    await button('恢复全图').tap();
    assert.equal((await sample()).zoom, 1);
    assert.deepEqual(writes, []);
    console.log('PASS mobile: 44px touch targets, +/−, touch drag (20,12), fit reset; 0 writes');
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
        args: ['--enable-unsafe-swiftshader'] });
    try { await desktop(browser); await mobile(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });