const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/components/ImgView/trialLidarDepth.ts'), 'utf8');
const api = {};
new Function('exports', ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }))(api);
const camera = { fx: 500, fy: 500, cx: 50, cy: 50 };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const xyz = (x, y, depth) => [(x - 50) * depth / 500, (y - 50) * depth / 500, depth];
const project = (points, transform = identity) => api.visibleLidarSamples(points.flat(), transform, camera, 100, 100)
    .map(({ x, y, depth }) => [Math.round(x), Math.round(y), depth]).sort((first, second) => first[0] - second[0]);
const points = [xyz(50, 50, 10), xyz(50, 50, 32), xyz(50, 56, 32), xyz(50, 62, 10.1),
    xyz(56, 56, 32), xyz(50, 76, 32), xyz(-1, 50, 10), xyz(50, 50, -20), [NaN, 0, 3]];
const expected = [[50, 76, 32], [50, 62, 10.1], [50, 50, 10], [56, 56, 32]];
assert.deepEqual(project(points), expected);
assert.deepEqual(project([...points].reverse()), expected);
assert.deepEqual(project([xyz(50, 50, 10)], identity.map((value, index) => index === 3 ? 0.4 : value)), [[70, 50, 10]]);
assert.equal(project([xyz(44, 50, 5), xyz(56, 50, 12), xyz(50, 50, 30)]).length, 3);
console.log('PASS optical-depth collision, supported gap, open silhouette, incompatible surfaces, order, clipping and extrinsics');