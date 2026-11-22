const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const processes = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');

const modulePath = require.resolve('./trial-prelabel.cjs');
function reload() {
    delete require.cache[modulePath];
    return require(modulePath);
}

test('local HTTP contract, single admission, Vite reload and publication', async (context) => {
    const root = '/unused/trial-prelabel-test';
    const calls = [];
    context.mock.method(processes, 'spawn', (file, args, options) => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        calls.push({ file, args, options, child });
        return child;
    });
    let handler;
    const install = () => reload().trialPrelabel(root).configureServer({ middlewares: { use(fn) { handler = fn; } } });
    install();
    const server = http.createServer((request, response) => handler(request, response, () => response.end('next')));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    function request(method, route, body, headers = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request(`${origin}/trial-prelabel/${route}`, {
                method, agent: false, headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
            }, (res) => {
                let text = '';
                res.setEncoding('utf8').on('data', (chunk) => { text += chunk; });
                res.on('end', () => resolve({ code: res.statusCode, data: JSON.parse(text), cache: res.headers['cache-control'] }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }
    const status = async () => (await request('GET', 'status')).data;
    assert.deepEqual(await status(), { state: 'idle', completed: 0, total: 39 });
    for (const [headers, expected] of [
        [{ Host: `foreign.invalid:${port}` }, 403], [{ Host: '127.0.0.1:1' }, 403],
        [{ Origin: `http://localhost:${port}` }, 403], [{ Origin: 'null' }, 403],
        [{ 'Sec-Fetch-Site': 'cross-site' }, 403], [{ Forwarded: 'for=192.0.2.1' }, 403],
        [{ 'Content-Type': 'text/plain' }, 415],
    ]) assert.equal((await request('POST', 'run', '{}', headers)).code, expected);
    for (const body of ['', 'null', '[]', '1', 'invalid', '{"args":[]}', '{"root":"/tmp"}']) {
        assert.equal((await request('POST', 'run', body)).code, 400);
    }
    assert.equal((await request('POST', 'run', ' '.repeat(1025))).code, 413);
    assert.equal((await request('GET', 'run')).code, 405);
    assert.equal((await request('POST', 'status', '{}')).code, 405);
    assert.equal((await request('POST', 'run?path=/tmp', '{}')).code, 404);
    assert.equal(calls.length, 0);

    const submissions = await Promise.all([request('POST', 'run', '{}'), request('POST', 'run', '{}')]);
    assert.deepEqual(submissions.map((entry) => entry.code).sort(), [202, 409]);
    const accepted = submissions.find((entry) => entry.code === 202);
    assert.equal(accepted.cache, 'no-store');
    const running = accepted.data;
    assert.ok(running.runId);
    assert.deepEqual(running, { state: 'running', completed: 0, total: 39, runId: running.runId });
    assert.equal(calls.length, 1);
    const { child, file, args, options } = calls[0];
    assert.equal(file, '/usr/bin/flock');
    assert.deepEqual(args, ['-n', '-E', '75', '-F', '/home/jerett/datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source',
        '/home/jerett/anaconda3/envs/point_pillar/bin/python', `${root}/scripts/build-centerpoint.py`, '--build']);
    assert.equal(options.cwd, root);
    assert.equal(options.shell, false);
    assert.equal(options.env.PYTHONPATH, undefined);
    assert.equal(options.env.OMP_NUM_THREADS, '1');
    const line = (frame) => `${frame}/39 history=3 car=18 ped=2 elapsed=1.2s\n`;
    child.stdout.write('setup noise\n1/');
    child.stdout.write(line(1).slice(2));
    child.stdout.write(line(1) + line(39));
    install();
    assert.deepEqual(await status(), { ...running, completed: 1 });
    assert.equal((await request('POST', 'run', '{}')).code, 409);
    assert.equal(calls.length, 1);
    for (let frame = 2; frame <= 39; frame++) child.stdout.write(line(frame));
    assert.deepEqual(await status(), { ...running, completed: 38 });
    child.stderr.end('OSError: publish failed\n');
    child.emit('close', 1, null);
    const failed = await status();
    assert.equal(failed.state, 'failed');
    assert.equal(failed.completed, 38);
    assert.match(failed.error, /publish failed/);
    const retry = await request('POST', 'run', '{}');
    assert.notEqual(retry.data.runId, running.runId);
    assert.equal(retry.data.completed, 0);
    const second = calls[1].child;
    for (let frame = 1; frame <= 39; frame++) second.stdout.write(line(frame));
    second.emit('exit', 0, null);
    assert.equal((await status()).completed, 38);
    second.emit('close', 0, null);
    install();
    assert.deepEqual(await status(), { ...retry.data, state: 'succeeded', completed: 39 });
});

test('another process holding the scene lock prevents the build and preserves the published file', async (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-prelabel-'));
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const previousDatabase = process.env.XTREME1_DB_ROOT;
    const database = path.join(root, 'database');
    const assets = path.join(database, 'scene-0061/source');
    fs.mkdirSync(assets, { recursive: true });
    process.env.XTREME1_DB_ROOT = database;
    context.after(() => {
        if (previousDatabase === undefined) delete process.env.XTREME1_DB_ROOT;
        else process.env.XTREME1_DB_ROOT = previousDatabase;
    });
    const target = path.join(assets, 'centerpoint.json');
    fs.writeFileSync(target, 'previous result');
    const holder = processes.spawn('/usr/bin/flock', ['-F', assets, process.execPath, '-e',
        'process.stdout.write("locked"); process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const closed = once(holder, 'close');
    try {
        await Promise.race([once(holder.stdout, 'data'), closed.then(() => { throw Error('lock holder exited early'); })]);
        const runner = reload().createRunner(root);
        assert.equal(runner.start(), true);
        for (let attempt = 0; attempt < 100 && runner.status().state === 'running'; attempt++) await delay(20);
        assert.equal(runner.status().state, 'failed');
        assert.match(runner.status().error, /scene lock/);
        assert.equal(runner.status().completed, 0);
        assert.equal(fs.readFileSync(target, 'utf8'), 'previous result');
    } finally {
        holder.stdin.end();
        await closed;
    }
});