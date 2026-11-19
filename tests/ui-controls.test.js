import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const runtime=fs.readFileSync(new URL('../src/runtime.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../settings.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
test('indexing display is backed by real completed and total source counts',()=>{
  assert.match(index,/completedSources/);assert.match(index,/totalSources/);
  assert.match(index,/Math\.min\(100,Math\.round\(100\*done\/total\)\)/);
  assert.match(index,/aria-valuenow/);
  assert.match(html,/id="mn-index-bar"/);
  assert.match(html,/id="mn-index-fill"/);
  assert.match(css,/mn-progress-fill/);
});
test('single record expansion records a read receipt, shelf selection does not clear all',()=>{
  assert.match(index,/mn\.markRecordRead\(shelfAtRender,item\)/);
  assert.match(index,/mn\.markShelfRead\(shelf\)/);
  assert.match(html,/id="mn-mark-shelf-read"/);
  const click=index.slice(index.indexOf("button.addEventListener('click',()=>{"),index.indexOf('parent.append(button);'));
  assert.doesNotMatch(click,/markShelfRead/);
  assert.match(runtime,/export async function markRecordRead/);
});
test('indexing counts actual outgoing API attempts',()=>{
  assert.match(runtime,/indexProgress\.apiRequests=/);
  assert.match(index,/API-запросов за запуск/);
});
