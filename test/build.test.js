'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('build', () => {
  it('生成 .user.js 文件,含 Tampermonkey 元数据头与各模块', () => {
    execSync('node build.js', { cwd: path.join(__dirname, '..') });
    const file = path.join(__dirname, '..', 'bilibili-live-stealth.user.js');
    assert.ok(fs.existsSync(file), '应生成 user.js');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('// ==UserScript=='), '应有元数据头');
    assert.ok(content.includes('@run-at       document-start'), '应在 document-start 注入');
    assert.ok(content.includes('@match        *://live.bilibili.com/*'), '应匹配直播页');
    assert.ok(content.includes('installHttpHook'), '应内联 HTTP hook');
    assert.ok(content.includes('installWsHook'), '应内联 WS hook');
    assert.ok(content.includes('installUi'), '应内联 UI');
    assert.ok(content.includes('createConfig'), '应内联 config');
    assert.ok(content.includes('unsafeWindow'), '入口应用 unsafeWindow');
  });
});