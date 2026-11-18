import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newArchive, importMemoryBook, validateArchive, splitMemoryBook, guessShelves,
  snapshotChat, mergeSources, syncActiveSources, normalizeFact,
  addFacts, retrieve, parseJsonReply, renderContext, terms,
} from '../src/core.js';

const sample=`MEMORY BOOK\n[Main characters]\n- Agent Alpha: has access to Zone C.\n\n[Relationships]\n- Agent Alpha and Agent Beta share access to Zone C.\n\n[Events Chronicle]\n— Nov 1, 08:15: Agent Beta transferred an access token to Agent Alpha.\n\n[Core items]\n- Access token: stored in Zone C.\n\n[Important quotes]\n- “Verify the access token.”`;

test('one-time Memory Book import stores original exactly and categorizes shelves', () => {
  const archive=newArchive('chat-1');const out=importMemoryBook(archive,sample,{label:'Old Book'});
  assert.equal(out.duplicate,false);assert.ok(out.count>=4);
  assert.equal(archive.imports[0].raw,sample);
  assert.ok(archive.chunks.some(c=>c.shelves.includes('people')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('relationships')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('chronology')));
  assert.ok(archive.chunks.some(c=>c.shelves.includes('items')));
  assert.equal(validateArchive(archive).valid,true);
  assert.equal(importMemoryBook(archive,sample,{label:'Old Book'}).duplicate,true);
  assert.equal(archive.imports.length,1);
});

test('secrets and knowledge are separate shelves, no artificial text loss in original',()=>{
  const archive=newArchive('c');const raw='[Secrets]\nSystem Node 7 has a hidden internal identifier.\n\n[Knowledge Ledger]\nOnly Agent Alpha knows System Node 7 identity.';
  importMemoryBook(archive,raw);assert.equal(archive.imports[0].raw,raw);
  assert.ok(archive.chunks.some(x=>x.shelves.includes('secrets')));
  assert.ok(archive.chunks.some(x=>x.shelves.includes('knowledge')));
});

test('new source preserves alternative swipes while active source changes',()=>{
  const chat=[{mes:'first',swipes:['first','second'],swipe_id:0,is_user:false}];
  const archive=newArchive('c');mergeSources(archive,snapshotChat(chat),new Set([0]));
  assert.equal(archive.sources.length,2);
  const ids=new Set(archive.sources.map(s=>s.id));assert.equal(ids.size,2);
  chat[0].swipe_id=1;chat[0].mes='second';syncActiveSources(archive,chat);
  assert.equal(archive.sources.filter(s=>s.active).length,1);
  assert.equal(archive.sources.find(s=>s.active).raw,'second');
  assert.equal(archive.sources.find(s=>!s.active).raw,'first');
});

test('indexed facts require valid source citation and never leak inactive swipe facts',()=>{
  const archive=newArchive('c');const chat=[{mes:'First: alpha access code',swipes:['First: alpha access code','Second: beta access code'],swipe_id:0,is_user:false}];
  mergeSources(archive,snapshotChat(chat),new Set([0]));const a=archive.sources.find(x=>x.active),b=archive.sources.find(x=>!x.active);
  addFacts(archive,[a.id],[{shelf:'items',text:'The alpha access code is active',source_ids:[a.id],certainty:'confirmed'}]);
  assert.ok(retrieve(archive,'alpha access code').some(x=>x.text.includes('alpha access code')));
  chat[0].swipe_id=1;chat[0].mes='Second: beta access code';syncActiveSources(archive,chat);
  assert.ok(!retrieve(archive,'alpha access code').some(x=>x.text.includes('alpha access code')&&x.kind==='fact'));
  assert.equal(normalizeFact({shelf:'items',text:'Fake',source_ids:['bogus']},[b.id],archive),null);
});

test('extractor accepts JSON and fenced JSON; context marks knowledge constraints',()=>{
  assert.deepEqual(parseJsonReply('```json\n{"facts":[]}\n```'),{facts:[]});
  assert.deepEqual(parseJsonReply(' {"facts":[]} '),{facts:[]});
  const v=renderContext([{text:'[secret] A piece of lore'}]);
  assert.match(v,/Reader-only secrets remain unknown to NPCs/);
});

test('U+2800 and Russian search terms are normalized',()=>{
  assert.ok(terms('Модуль⠀читает документ').includes('модуль'));
});

import {pendingExtraction,extractionView} from '../src/core.js';

test('automatic scheduling counts only pending answers since activation, not the entire chat',()=>{
  const archive=newArchive('chat-X');archive.autoStartIndex=10;
  const chat=[];
  for(let i=0;i<13;i++)chat.push({mes:`Reply ${i}`,is_user:false});
  mergeSources(archive,snapshotChat(chat));
  assert.equal(pendingExtraction(archive).assistantCount,3);
  assert.equal(pendingExtraction(archive,{force:true}).assistantCount,13);
  const ids=pendingExtraction(archive).sources.map(x=>x.id);
  archive.batches.push({status:'done',sourceIds:ids});
  assert.equal(pendingExtraction(archive).assistantCount,0);
});

test('deep legacy facts keep chunk citations and remain retrievable after import',()=>{
  const a=newArchive('legacy');importMemoryBook(a,'[Events Chronicle]\nOn May 8, Agent Delta placed item Q-4 in Zone C.');
  const c=a.chunks[0];
  const added=addFacts(a,[c.id],[{shelf:'items',text:'Agent Delta placed item Q-4 in Zone C',source_ids:[c.id],certainty:'confirmed',tags:['Agent Delta','item Q-4']}]);
  assert.equal(added.length,1);assert.equal(validateArchive(a).valid,true);
  assert.ok(retrieve(a,'Agent Delta item Q-4',{maxCharacters:2500}).some(x=>x.text.includes('item Q-4')));
  const again=addFacts(a,[c.id],[{shelf:'items',text:'Agent Delta placed item Q-4 in Zone C',source_ids:[c.id]}]);
  assert.equal(again.length,0);
});

test('no unrelated secret gets injected without a real term match',()=>{
  const a=newArchive('secrets');importMemoryBook(a,'[Secrets]\nSystem Node 7 stores a restricted identifier.');
  assert.equal(retrieve(a,'ordinary weather report').length,0);
});

test('archivist sees recap and scene, not only first 10k chars of metadata-heavy message',()=>{
  const raw='<mobile_header location="Zone C"/>'+'<ru>'+('Neutral sample. '.repeat(2000))+'</ru>'+
  '<sample_easel>[I. Staging] Inventory value is 12</sample_easel>'+
  '<en><details closed><summary>recap</summary>The access token was moved into Zone C.</details></en>';
  const input=extractionView({role:'assistant',raw});
  assert.match(input,/The access token was moved/);
  assert.match(input,/Inventory value is 12/);
  assert.ok(input.length<15000);
});

test('silent continuity: unrelated active facts do not enter RP context',()=>{
  const a=newArchive('silent');importMemoryBook(a,'[Relationships]\nAgent Gamma can access Zone C.');
  const c=a.chunks[0];
  addFacts(a,[c.id],[{shelf:'relationships',text:'Agent Gamma can access Zone C.',people:['Agent Gamma'],lifecycle:'active',source_ids:[c.id]}]);
  assert.equal(retrieve(a,'System Node 9 restarts',{mode:'automatic'}).length,0);
});

test('silent continuity: a name alone does not summon a historical flashback',()=>{
  const a=newArchive('no-flashbacks');importMemoryBook(a,'[Events Chronicle]\nAgent Alpha assigned object X-17 to Agent Beta.');
  const c=a.chunks[0];
  addFacts(a,[c.id],[{shelf:'chronology',text:'Agent Alpha assigned object X-17 to Agent Beta.',people:['Agent Alpha','Agent Beta'],lifecycle:'historical',source_ids:[c.id]}]);
  const background=retrieve(a,'Agent Alpha entered the area',{mode:'automatic'});
  assert.equal(background.length,1);
  assert.equal(background[0].anchor,true);
  assert.ok(background[0].text.length<340);
  assert.equal(retrieve(a,'Agent Alpha entered the area',{mode:'automatic',maxAnchors:0}).length,0);
  assert.ok(retrieve(a,'Agent Alpha inspected object X-17',{mode:'automatic'}).some(x=>x.kind==='fact'));
  assert.ok(retrieve(a,'Do you remember Agent Alpha?',{mode:'automatic'}).length>0);
  assert.ok(retrieve(a,'Помнишь, Agent Alpha?',{mode:'automatic'}).length>0);
});

test('silent continuity prompt forbids forced flashbacks but permits present consequences',()=>{
  const prompt=renderContext([{text:'[relationships] They trust each other',historical:false},{text:'[chronology] Old scene',historical:true}]);
  assert.match(prompt,/NEVER insert flashbacks/);
  assert.match(prompt,/preserve current relationships/);
  assert.match(prompt,/Past references/);
});


test('neutral custom easel tag is parsed without a project-specific name',()=>{
  const raw='<ru>Sample scene.</ru><test_easel>STATUS: object is present</test_easel>';
  const view=extractionView({role:'assistant',raw});
  assert.match(view,/STATUS: object is present/);
});

test('retrieval returns empty context when no relevant source exists',()=>{
  const a=newArchive('blank');
  assert.deepEqual(retrieve(a,'Sample action',{mode:'automatic'}),[]);
  assert.equal(renderContext([]),'');
});

test('memory retrieval after explicit recollection request can include a sourced episode',()=>{
  const a=newArchive('recall');importMemoryBook(a,'[Events Chronicle]\nAgent Alpha assigned object X-17 to Agent Beta.');
  const ch=a.chunks[0];
  addFacts(a,[ch.id],[{shelf:'chronology',text:'Agent Alpha assigned object X-17 to Agent Beta.',people:['Agent Alpha','Agent Beta'],lifecycle:'historical',source_ids:[ch.id]}]);
  const hits=retrieve(a,'Do you remember Agent Alpha?',{mode:'automatic'});
  assert.ok(hits.some(x=>x.kind==='fact'&&!x.anchor));
});
