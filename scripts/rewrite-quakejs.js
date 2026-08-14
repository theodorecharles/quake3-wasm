#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('usage: rewrite-quakejs.js SOURCE OUTPUT');

let source = fs.readFileSync(sourcePath, 'utf8');

const platformStart = source.indexOf('function _Sys_PlatformInit() {');
const platformEnd = source.indexOf('\n  function _Sys_Dirname', platformStart);
if (platformStart < 0 || platformEnd < 0) throw new Error('QuakeJS platform launcher seam changed.');
source = `${source.slice(0, platformStart)}function _Sys_PlatformInit() {}\n${source.slice(platformEnd)}`;

const sysStart = source.indexOf('var SYS={');
const cssStart = source.indexOf('css:"', sysStart);
const cssEnd = source.indexOf('",DoXHR:function', cssStart);
if (sysStart < 0 || cssStart < 0 || cssEnd < 0) throw new Error('QuakeJS embedded launcher style seam changed.');
source = `${source.slice(0, cssStart)}css:""${source.slice(cssEnd + 1)}`;

const legacyMouse = `      ['mousedown', 'mouseup', 'mousemove', 'DOMMouseScroll', 'mousewheel', 'mouseout'].forEach(function(event) {\n        Module['canvas'].addEventListener(event, SDL.receiveEvent, true);\n      });\n  `;
if (!source.includes(legacyMouse)) throw new Error('QuakeJS mouse listener seam changed.');
source = source.replace(legacyMouse, '      // Mouse input is injected by the canonical framework adapter.\n  ');

if (source.includes('eula-frame-inner') || source.includes("id = 'dialog'")) {
  throw new Error('Legacy QuakeJS launcher markup remains in the deployable engine.');
}

fs.writeFileSync(outputPath, source);
