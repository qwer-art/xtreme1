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
    const lidar = button('点云投影');
    assert.equal(await lidar.getAttribute('aria-pressed'), 'true');
    const capture = (mode = 'current') => page.evaluate(captureLidar, mode);
    const first = await capture();
    assert.ok(first.ink > 1000 && first.aligned > 100, JSON.stringify(first));
    const probe = await capture('occlusion');
    assert.deepEqual(probe.collision, probe.near);
    assert.notDeepEqual(probe.collision, probe.far);
    assert.equal(probe.far[3], 255);
    assert.equal(probe.gap[3], 0);
    await lidar.click();
    assert.equal(await capture(), null);
    assert.equal(await page.locator('.camera-stage .trial-depth-legend:visible').count(), 0);
    await page.evaluate(() => { for (const view of window.renderProxy.views) view.renderBox = false; window.renderProxy.renderFrame(); });
    assert.ok(tiles.equals(await rail.screenshot()), 'thumbnails changed with points and boxes off');
    await page.evaluate(() => { for (const view of window.renderProxy.views) view.renderBox = true; window.renderProxy.renderFrame(); });
    await lidar.click();
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
    assert.ok(tiles.equals(await rail.screenshot()), 'thumbnail strip changed after zoom');
    await stage.dblclick({ position: { x: 75, y: 75 } });
    await button('返回点云').waitFor();
    const expanded = await capture('expanded');
    assert.deepEqual(expanded, first);
    await button('返回点云').click();
    await button('恢复全图').click();
    const reset = await sample();
    assert.deepEqual([reset.zoom, ...reset.offset], [1, 0, 0]);
    assert.deepEqual(reset.pixel, before.pixel);
    const other = page.locator('.camera-picker button[aria-pressed=false]').first();
    await other.click();
    const switched = await capture();
    assert.ok(switched.aligned > 100 && switched.url !== first.url, JSON.stringify(switched));
    const pager = page.getByTestId('trial-index');
    await pager.fill('4'); await pager.press('Enter');
    await page.waitForFunction(old => window.editor?.state.frameIndex === 3 && window.renderProxy?.views.some(view =>
        view.container.offsetWidth && view.img?.complete && view.option.imgUrl !== old &&
        window.editor.dataResource.dataMap[window.editor.getCurrentFrame().id]?.viewConfig.some(camera => camera.imgUrl === view.option.imgUrl)), switched.url);
    const nextScan = await capture();
    assert.ok(nextScan?.aligned > 100 && nextScan.url !== switched.url);
    assert.deepEqual(writes, []);
    console.log(`PASS main point overlay: ${first.aligned} independently projected returns on ink, near/far/gap pixels, toggle, clean thumbnails, enlarged view, camera and frame changes; 0 writes`);
    console.log(`PASS desktop: cursor anchor, drag (19,13), keyboard +, optical scale ${native.sourceScale.toFixed(2)}, original pixels ${native.matches}/${native.samples}, GL error ${native.projectionError.toFixed(2)} px, identical thumbnails, expand/return/reset; 0 writes`);
    await page.close();
}

function captureLidar(mode) {
    const editor = window.editor;
    const view = mode === 'expanded' ? editor.pc.renderViews.find(item => item.name === editor.state.config.singleViewPrefix) :
        window.renderProxy.views.find(item => item.container.offsetWidth);
    const resource = editor.dataResource.dataMap[editor.getCurrentFrame().id];
    const source = resource.pointsData.position;
    const context = view.proxy.context, draw = context.drawImage;
    let result = null;
    context.drawImage = function(image, ...args) {
        if (image instanceof HTMLCanvasElement) {
            const pixels = image.getContext('2d'), { width, height } = image;
            const bytes = pixels.getImageData(0, 0, width, height).data;
            const pixel = (x, y) => Array.from(bytes.slice((width * y + x) * 4, (width * y + x) * 4 + 4));
            if (mode === 'occlusion') {
                result = { near: pixel(400, 400), collision: pixel(420, 400), gap: pixel(420, 412), far: pixel(450, 412) };
            } else {
                let ink = 0, aligned = 0;
                for (let offset = 3; offset < bytes.length; offset += 4) if (bytes[offset] === 255) ink++;
                const point = view.camera.position.clone();
                for (let offset = 0; offset < source.length; offset += 9) {
                    view.worldToImg(point.fromArray(source, offset));
                    const x = Math.floor(point.x), y = Math.floor(point.y);
                    if (Math.abs(point.z) < 1 && x >= 0 && x < width && y >= 0 && y < height && bytes[(width * y + x) * 4 + 3]) aligned++;
                }
                result = { ink, aligned, url: view.option.imgUrl };
            }
        }
        return draw.call(this, image, ...args);
    };
    try {
        if (mode === 'occlusion') {
            const { fx, fy, cx, cy } = view.option.cameraInternal;
            const inverse = view.matrixExternal.clone().invert();
            resource.pointsData.position = [[400,400,8], [420,400,8], [420,400,50], [420,412,50], [420,424,8], [450,412,50]].flatMap(([x,y,z]) =>
                view.camera.position.clone().set((x-cx)*z/fx, (y-cy)*z/fy, z).applyMatrix4(inverse).toArray());
        }
        view.proxy.renderFrame();
        return result;
    } finally {
        context.drawImage = draw;
        if (mode === 'occlusion') { resource.pointsData.position = source; view.proxy.renderFrame(); }
    }
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