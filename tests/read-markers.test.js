import test from 'node:test';
import assert from 'node:assert/strict';
import {recordKey,readSnapshot,diffReadSnapshot,setRecordRead} from '../src/read-markers.js';
import {newArchive,importMemoryBook,addFacts,normalizeFact,currentStateRecords} from '../src/core.js';
const f=(id,text,status='pending',entity='task-1')=>({id,text,shelf:'promises',entityKey:entity,promiseStatus:status});
test('new records are distinguished from unchanged records',()=>{
  const old=f('1','A will deliver the parcel.');
  const seen=readSnapshot([old]);
  assert.deepEqual([diffReadSnapshot([old],seen).added,diffReadSnapshot([old],seen).changed],[0,0]);
  assert.deepEqual([diffReadSnapshot([old,f('2','B prepares supplies.','pending','task-2')],seen).added,
    diffReadSnapshot([old,f('2','B prepares supplies.','pending','task-2')],seen).changed],[1,0]);
});
test('status transition with same entity is modified, not new',()=>{
  const old=f('one','A will deliver the parcel.','pending');const seen=readSnapshot([old]);
  const newer=f('two','A delivered the parcel.','fulfilled');
  assert.equal(recordKey(old),recordKey(newer));
  const diff=diffReadSnapshot([newer],seen);assert.equal(diff.added,0);assert.equal(diff.changed,1);
  assert.equal(diff.entries.get(recordKey(newer)).previous.promiseStatus,'pending');
});
test('new citation to the same fact does not create a changed badge',()=>{
  const old={...f('one','A will deliver the parcel.'),sourceIds:['s1']};
  const seen=readSnapshot([old]);
  const latest={...old,sourceIds:['s1','s2']};
  assert.equal(diffReadSnapshot([latest],seen).changed,0);
});
test('read snapshot resets unread counts when a shelf is opened',()=>{
  const old=f('one','A will deliver the parcel.');const newer=f('two','A delivered the parcel.','fulfilled');
  let seen=readSnapshot([old]);assert.equal(diffReadSnapshot([newer],seen).changed,1);
  seen=readSnapshot([newer]);assert.equal(diffReadSnapshot([newer],seen).changed,0);
});
test('same wording may produce separate immutable promise status revisions',()=>{
  const a=newArchive('test');importMemoryBook(a,'[Promises]\nA will deliver the parcel.');
  const id=a.chunks[0].id;
  const base={shelf:'promises',text:'A will deliver the parcel.',entity_key:'parcel-1',source_ids:[id]};
  const pending=normalizeFact({...base,promise_status:'pending'},[id],a);
  const fulfilled=normalizeFact({...base,promise_status:'fulfilled'},[id],a);
  assert.notEqual(pending.id,fulfilled.id);
  assert.equal(addFacts(a,[id],[{...base,promise_status:'pending'}]).length,1);
  assert.equal(addFacts(a,[id],[{...base,promise_status:'fulfilled'}]).length,1);
  assert.equal(currentStateRecords(a.facts,'promises').length,1);
  assert.equal(currentStateRecords(a.facts,'promises')[0].promiseStatus,'fulfilled');
});

test('reading one record clears exactly its marker and preserves sibling badges',()=>{
  const old=f('a','A will deliver the parcel.');
  const second=f('b','B will visit the library.','pending','library-visit');
  const first=f('a2','A delivered the parcel.','fulfilled');
  const seen=readSnapshot([old]);
  let d=diffReadSnapshot([first,second],seen);
  assert.deepEqual([d.added,d.changed],[1,1]);
  setRecordRead(seen,first);
  d=diffReadSnapshot([first,second],seen);
  assert.deepEqual([d.added,d.changed],[1,0]);
  assert.equal(d.entries.has(recordKey(second)),true);
  setRecordRead(seen,second);
  assert.deepEqual([diffReadSnapshot([first,second],seen).added,diffReadSnapshot([first,second],seen).changed],[0,0]);
});
test('after reading, later changes with the same entity become changed again',()=>{
  const first=f('a','A will deliver the parcel.');
  const updated=f('b','A delivered the parcel.','fulfilled');
  const seen=readSnapshot([first]);setRecordRead(seen,updated);
  assert.equal(diffReadSnapshot([updated],seen).changed,0);
  const modified=f('c','A delivered the parcel and apologized.','fulfilled');
  assert.equal(diffReadSnapshot([modified],seen).changed,1);
});
