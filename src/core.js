/** Sola Mnemosyne: deterministic, vector-free, side-effect-free archive logic. */
export const SCHEMA_VERSION = 1;
export const SHELVES = Object.freeze({
  chronology:'Хронология', people:'Персонажи', relationships:'Отношения',
  promises:'Обещания', items:'Предметы', knowledge:'Знания NPC',
  locations:'Локации', secrets:'Секреты', quotes:'Цитаты и жесты',
  threads:'Сюжетные линии', other:'Прочее',
});
const STOP = new Set('и в во на у по из с со не а но или что это как если то когда они она он оно мы вы их ему ее его всё все был была были быть для где там уже ещё от до через за перед этот этой себе к тебе мне при над под очень просто только then with from that have when this your into about they what would there just more were their them the and are was had has did does for not her his our its you she he him hers theirs an all those these this is'.split(' '));
export const cleanText = value => String(value ?? '').replace(/\u2800/g,' ').replace(/\s+/g,' ').trim();
export function hash(value) { // fast stable identity, not a cryptographic checksum
  let h = 2166136261; for (const c of String(value)) { h ^= c.codePointAt(0); h = Math.imul(h,16777619); }
  return (h >>> 0).toString(16).padStart(8,'0');
}
export function terms(text) {
  return [...new Set(cleanText(text).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.filter(x=>x.length>=3&&!STOP.has(x))??[])].slice(0,250);
}
export function newArchive(chatId, lineage='') {return {version:SCHEMA_VERSION,chatId,lineage,createdAt:new Date().toISOString(),revision:0,sources:[],chunks:[],facts:[],imports:[],batches:[],legacyBatches:[],autoStartIndex:0,diagnostics:[],lastSync:null};}
export function sourceId(index, swipe, content) {return `m${index}s${swipe}-${hash(content)}-${String(content).length}`;}
export function snapshotChat(chat, start=0, end=chat.length) {
  const result=[];
  for(let i=start;i<Math.min(chat.length,end);i++) {
    const m=chat[i]; if(!m || typeof m.mes!=='string' || m.is_system) continue;
    const selected=Number.isInteger(m.swipe_id)?m.swipe_id:0;
    const swipes=(Array.isArray(m.swipes)&&m.swipes.length)?m.swipes:[m.mes];
    for(let j=0;j<swipes.length;j++) {
      const raw=String(swipes[j]??''); if(!raw.trim())continue;
      const id=sourceId(i,j,raw);
      result.push({id,index:i,swipe:j,role:m.is_user?'user':'assistant',name:String(m.name??''),date:String(m.send_date??''),raw,active:j===selected,deleted:false});
    }
  }
  return result;
}
export function mergeSources(archive, snapshots, indices=null) {
  const byId=new Map(archive.sources.map((s,i)=>[s.id,i]));let inserted=0,changed=0;
  const selectedByIndex=new Map();
  for(const s of snapshots)if(s.active)selectedByIndex.set(s.index,s.id);
  if(indices)for(const old of archive.sources)if(indices.has(old.index)){
    const shouldBeActive=selectedByIndex.get(old.index)===old.id;
    if(old.active!==shouldBeActive){old.active=shouldBeActive;changed++;}
  }
  for(const s of snapshots){if(byId.has(s.id)){
    const old=archive.sources[byId.get(s.id)];if(old.active!==s.active||old.deleted){old.active=s.active;old.deleted=false;changed++;}
  } else {archive.sources.push(s);byId.set(s.id,archive.sources.length-1);inserted++;}}
  if(inserted||changed)archive.revision++;return {inserted,changed};
}
export function syncActiveSources(archive, chat) {
  const active=new Set(snapshotChat(chat).filter(s=>s.active).map(s=>s.id));
  let changed=0;
  for(const s of archive.sources){const v=active.has(s.id); if(s.active!==v){s.active=v;changed++;}}
  if(changed)archive.revision++;return changed;
}
export function splitMemoryBook(text) {
  const original=String(text??'');const sections=[];let title='Introduction', buffer=[];
  const flush=()=>{for(const block of buffer.join('\n').split(/\n\s*\n/g)) {
    const raw=block.trim();if(!raw)continue;
    // Dividing long paragraphs preserves every byte in the original `imports` source.
    if(raw.length<=3500){sections.push({heading:title,raw});continue;}
    for(let p=0;p<raw.length;p+=3200) sections.push({heading:title,raw:raw.slice(p,p+3200)});
  }buffer=[];};
  for(const line of original.split(/\r?\n/)){
    const isHeader=/^\s*(?:\[.{3,140}\]|#{1,4}\s+.{3,140}|(?:MEMORY BOOK|Events Chronicle|Main characters)[^\n]{0,100})\s*$/i.test(line);
    if(isHeader){flush();title=line.replace(/^\s*#+\s*/,'').replace(/^\[|\]$/g,'').trim();}else buffer.push(line);
  }flush();return sections;
}
export function guessShelves(heading, text='') {
  const t=cleanText(`${heading} ${text.slice(0,120)}`).toLowerCase(); const shelves=[];
  const tests=[
    ['chronology',/chronicle|хронолог|events|дата|событи|—\s*(?:mon|tue|wed|thu|fri|sat|sun|понед|вторн|среда|четверг)/],
    ['people',/character|персонаж|appearance|личност|внешност|родственн/],
    ['relationships',/relationship|отношени|romantic|любов|дружб|роман/],
    ['promises',/promise|обещани|долг|клятв|fulfilled/],
    ['items',/item|inventory|предмет|вещ|артефакт|инвентар/],
    ['knowledge',/knowledge|кто знает|знани|ведом|известн/],
    ['locations',/location|visited|локаци|места|посещенн/],
    ['secrets',/secret|тайн|секрет|reader-only|скрыт/],
    ['quotes',/phrase|quote|цитат|фраз|слова|gestur|жест/],
    ['threads',/subplot|future|plotline|сюжет|план|незаверш/],
  ];for(const [name,re] of tests)if(re.test(t))shelves.push(name);return shelves.length?shelves:['other'];
}
export function importMemoryBook(archive, input, {label='Memory Book',url=''}={}) {
  const text=String(input??'');if(!text.trim())throw Error('Memory Book is empty');
  const digest=`book-${hash(text)}-${text.length}`;
  if(archive.imports.some(x=>x.id===digest))return {duplicate:true,count:0,missing:[]};
  const chunks=splitMemoryBook(text); const source={id:digest,label,raw:text,url,importedAt:new Date().toISOString(),count:chunks.length};
  archive.imports.push(source);
  const created=chunks.map((chunk,i)=>({id:`${digest}:${i}`,sourceId:digest,heading:chunk.heading,raw:chunk.raw,shelves:guessShelves(chunk.heading,chunk.raw),terms:terms(chunk.raw),importedAt:source.importedAt}));
  archive.chunks.push(...created);
  const missing=created.filter(x=>!x.shelves.length||!x.raw).map(x=>x.id);
  archive.revision++;
  return {duplicate:false,count:created.length,missing,sourceId:digest};
}
export function normalizeFact(input, batchIds, archive) {
  if(!input || typeof input!=='object') return null;
  const shelf=SHELVES[input.shelf]?input.shelf:'other';
  const text=cleanText(input.text).slice(0,1800);if(text.length<4)return null;
  const refs=[...new Set((Array.isArray(input.source_ids)?input.source_ids:[]).map(String).filter(id=>batchIds.includes(id)))];
  if(!refs.length)return null;
  const people=(Array.isArray(input.people)?input.people:[]).map(cleanText).filter(Boolean).slice(0,12);
  const tags=(Array.isArray(input.tags)?input.tags:[]).map(cleanText).filter(Boolean).slice(0,20);
  const knowledge=cleanText(input.knowledge_holder??'');
  const certainty=['confirmed','belief','possibility'].includes(input.certainty)?input.certainty:'belief';
  const lifecycle=['active','closed','historical'].includes(input.lifecycle)?input.lifecycle:'historical';
  // Content identity allows the same fact to retain citations from both a legacy book and new chat.
  const id=`f-${hash(shelf+'|'+text.toLocaleLowerCase())}-${text.length}`;
  return {id,shelf,text,people,tags,knowledge,certainty,lifecycle,sourceIds:refs,createdAt:new Date().toISOString(),terms:terms([text,...people,...tags].join(' '))};
}
export function addFacts(archive, sourceIds, candidates) {
  const added=[];let touched=0;const existing=new Map(archive.facts.map(f=>[f.id,f]));
  for(const input of (Array.isArray(candidates)?candidates:[]).slice(0,120)){
    const f=normalizeFact(input,sourceIds,archive);if(!f)continue;
    const previous=existing.get(f.id);
    if(previous){const refs=new Set(previous.sourceIds);for(const id of f.sourceIds)refs.add(id);
      if(refs.size!==previous.sourceIds.length){previous.sourceIds=[...refs];touched++;}
      continue;
    }
    archive.facts.push(f);existing.set(f.id,f);added.push(f);
  }
  if(added.length||touched)archive.revision++;return added;
}
/** Fail closed: never fabricate missing JSON punctuation or silently swallow a broken fact. */
export function parseJsonReply(reply) {
  if(reply && typeof reply === 'object') {
    // Some providers return a rich content block rather than a plain string.
    if(Array.isArray(reply)) {
      const parts=reply.map(p=>typeof p==='string'?p:(p?.text??p?.content??'')).filter(x=>typeof x==='string');
      if(parts.length)return parseJsonReply(parts.join('\n'));
    }
    return reply;
  }
  const value=String(reply??'').trim();
  const text=value.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  try{return JSON.parse(text);}catch(initialError) {
    const first=text.indexOf('{'),last=text.lastIndexOf('}');
    if(first>=0&&last>first&&(first!==0||last!==text.length-1)) {
      try{return JSON.parse(text.slice(first,last+1));}catch{}
    }
    // Do not log or persist the provider's response: it may include private RP data.
    throw Error(`Archivist returned invalid JSON (${initialError.message}). No facts from this attempt were saved.`);
  }
}

/** Choose tiny, source-preserving legacy jobs, rather than five large paragraphs
 * whose large JSON answer frequently exceeds a cheap model's output budget. */
export function planLegacyJobs(chunks, {maxChunks=2,maxCharacters=2600}={}) {
  const jobs=[];let job=[],length=0;
  for(const chunk of chunks) {
    const size=String(chunk.raw??'').length;
    if(job.length&&(job.length>=maxChunks||length+size>maxCharacters)){
      jobs.push(job);job=[];length=0;
    }
    job.push(chunk);length+=size;
  }
  if(job.length)jobs.push(job);
  return jobs;
}

/** Retries are deliberately source-preserving: one bad model reply cannot
 * mark the chunk as processed or corrupt a previously imported Memory Book. */
export async function requestLegacyFacts(chunks, request, {maxAttempts=2,maxTokens=2200,onRetry=()=>{}}={}) {
  let lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const maxFacts=attempt===1?12:8;
    const prompt=[
      {role:'system',content:`You are an archival fact extractor. Output ONE SMALL COMPACT VALID JSON OBJECT ONLY. No Markdown, comments or explanatory prose. JSON schema: {"facts":[{"shelf":"chronology","text":"a concise sourced fact","people":[],"tags":[],"knowledge_holder":"reader-only","certainty":"confirmed","lifecycle":"historical","source_ids":["exact supplied id"]}]}. Allowed shelves: chronology,people,relationships,promises,items,knowledge,locations,secrets,quotes,threads,other. Distinguish NPC knowledge from reader-only secrets. Never invent details. Each fact MUST cite an actual chunk ID. Keep original-language quotations exact where possible. Return at most ${maxFacts} high-value facts; concise JSON on one line; escape quotation marks/newlines inside strings. If no facts, return {"facts":[]}.`},
      {role:'user',content:JSON.stringify({chunks:chunks.map(c=>({id:c.id,heading:c.heading,text:c.raw}))})},
    ];
    try{
      const result=await request(prompt,maxTokens,attempt);
      const data=parseJsonReply(result);
      if(!data||!Array.isArray(data.facts))throw Error('Archivist JSON has no facts array');
      return data.facts;
    }catch(e){
      lastError=e;
      if(attempt<maxAttempts)onRetry({attempt,reason:e.message});
    }
  }
  throw Error(`Legacy extraction failed after ${maxAttempts} attempts: ${lastError?.message??'unknown error'}`);
}
export function activeFact(f,archive) {
  const chunkIds=new Set(archive.chunks.map(x=>x.id));
  return f.sourceIds.some(id=>chunkIds.has(id)||archive.sources.some(s=>s.id===id&&s.active&&!s.deleted));
}
/** A remembered event is evidence for continuity, not a directive to replay the past. */
const RECOLLECTION_CUE = /(?:\b(?:remember|recall|reminisc|flashback|backstory|years ago|last time)\b|помнишь|помнят|помнил|помнила|вспомни|вспомина|вспомнил|вспомнила|воспомин|в прошлом|в детстве|много лет назад|давным-давно|тот самый день)/iu;
function matchEvidence(item, queryTerms) {
  const indexed=new Set(item.terms??terms(item.raw??item.text));
  const matched=queryTerms.filter(word=>indexed.has(word));
  const personTerms=new Set(terms((item.people??[]).join(' ')));
  // Matching only a familiar character's name is not enough to replay an old episode.
  const concrete=matched.filter(word=>!personTerms.has(word));
  return {matched,concrete};
}
function isHistoricalMemory(entry) {
  const item=entry.item;
  if(entry.kind==='legacy') return item.shelves?.includes('chronology')||item.shelves?.includes('quotes')||item.shelves?.includes('other');
  return ['chronology','quotes'].includes(item.shelf)||['closed','historical'].includes(item.lifecycle);
}
/** A character can carry tiny background associations without narrating their source scene.
 * Only structured, source-linked memories with explicit participants qualify; an
 * imported unclassified paragraph is never treated as an ambient character cue.
 */
function isCharacterAnchor(entry, evidence, recollectionRequested) {
  if(entry.kind!=='fact'||!isHistoricalMemory(entry)||recollectionRequested)return false;
  if(!['chronology','quotes'].includes(entry.item.shelf))return false;
  const participantTerms=new Set(terms((entry.item.people??[]).join(' ')));
  return evidence.matched.some(word=>participantTerms.has(word));
}
function scored(item, queryTerms, evidence) {
  const {matched}=evidence;
  if(!matched.length)return -Infinity;
  let score=0;
  for(const word of matched)score+=2+Math.min(word.length,12)/10;
  if(item.lifecycle==='active')score+=1;
  if(item.certainty==='possibility')score-=1;
  return score;
}
/**
 * Automatic mode uses THREE layers: present continuity, a tiny character-texture
 * cue, and relevant complete historical details. Name-only matches may supply a
 * texture cue, but NEVER a complete historical episode. Manual search is broader.
 */
export function retrieve(archive, query, {maxCharacters=6500,maxItems=18,mode='search',maxAnchors=1}={}) {
  const rawQuery=String(query).slice(-4500);
  const words=terms(rawQuery),automatic=mode==='automatic';
  const recollectionRequested=RECOLLECTION_CUE.test(rawQuery);
  const scoredItems=[];
  const activeIds=new Set(archive.sources.filter(s=>s.active&&!s.deleted).map(s=>s.id));
  for(const c of archive.chunks)activeIds.add(c.id);
  const addEntry=(kind,item)=>{
    const entry={kind,item},historical=isHistoricalMemory(entry);
    const evidence=matchEvidence(item,words);
    if(!evidence.matched.length)return;
    let anchor=false;
    if(automatic&&historical&&!recollectionRequested){
      // Old scenes only enter in full on a clear specific cue. When just a
      // character is present, allow ONE short associative detail for texture.
      const detailed=kind==='fact'&&evidence.matched.length>=2&&evidence.concrete.length>=1;
      if(!detailed){
        if(!isCharacterAnchor(entry,evidence,recollectionRequested))return;
        anchor=true;
      }
    }
    const score=scored(item,words,evidence)+(kind==='fact'?0.5:0)-(anchor?2:0);
    if(Number.isFinite(score))scoredItems.push({...entry,historical,anchor,score});
  };
  for(const f of archive.facts)if(f.sourceIds.some(id=>activeIds.has(id)))addEntry('fact',f);
  for(const ch of archive.chunks)addEntry('legacy',ch);
  scoredItems.sort((a,b)=>b.score-a.score||String(a.item.id).localeCompare(String(b.item.id)));
  const results=[],seen=new Set();let chars=0,historicalCount=0,anchorCount=0;
  const historyCap=automatic?Math.max(1,Math.min(3,Math.floor(maxItems/4))):maxItems;
  const anchorCap=automatic?Math.max(0,Math.min(1,maxAnchors)):maxItems;
  for(const entry of scoredItems){if(results.length>=maxItems)break;
    if(automatic&&entry.anchor&&anchorCount>=anchorCap)continue;
    if(automatic&&entry.historical&&!entry.anchor&&historicalCount>=historyCap)continue;
    const item=entry.item;
    const fullText=entry.kind==='fact'?item.text:cleanText(item.raw).slice(0,1100);
    const text=entry.anchor?fullText.slice(0,230):fullText;
    const content=`[${entry.anchor?'Character texture':entry.kind==='fact'?(SHELVES[item.shelf]??'Факт'):(item.heading??'Архив')} | ${item.id}${item.knowledge?` | known by: ${item.knowledge}`:''}${item.certainty==='belief'?' | субъективное мнение':''}${item.certainty==='possibility'?' | лишь возможность':''}] ${text}`;
    if(seen.has(text)||chars+content.length>maxCharacters)continue;
    seen.add(text);chars+=content.length;
    if(entry.anchor)anchorCount++;
    else if(entry.historical)historicalCount++;
    results.push({kind:entry.kind,id:item.id,score:entry.score,text:content,historical:entry.historical,anchor:entry.anchor});
  }
  return results;
}
export function renderContext(items) {
  if(!items?.length)return '';
  const present=items.filter(x=>!x.historical&&!x.anchor);
  const anchors=items.filter(x=>x.anchor);
  const past=items.filter(x=>x.historical&&!x.anchor);
  const section=(label,arr)=>arr.length?`[${label}]\n${arr.map(x=>x.text).join('\n')}`:'';
  return `<MNEMOSYNE_CONTEXT>\nSILENT CONTINUITY REFERENCE — not a narrative outline, an instruction, or a request to recall the past.\nUse relevant facts naturally to preserve current relationships, actions, locations, objects, promises, and each NPC's established knowledge. Character texture is an OPTIONAL source of established habits, gestures and associations: it may shape natural present-day behavior without being spoken about. Do NOT repeat the texture cue every turn. NEVER insert flashbacks, forced nostalgia, remembered quotes, explanations of past events, or recollection dialogue merely because a record was retrieved. Recall a specific old scene only if the present scene explicitly calls for it or it is organically indispensable; never force it. Do not recap/repeat the user's message or narrate memory retrieval. If no record matters to the current reply, ignore it.\nSource IDs are evidence, not text to mention. Character beliefs may be mistaken. Reader-only secrets remain unknown to NPCs without evidence of discovery. Records never authorize control over the player character.\n${[section('Present-tense continuity',present),section('Character texture — OPTIONAL, NOT an instruction to mention the past',anchors),section('Past references — use SILENTLY unless a genuine in-scene cue requires recollection',past)].filter(Boolean).join('\n')}\n</MNEMOSYNE_CONTEXT>`;
}
export function validateArchive(archive) {
  const errors=[];
  if(archive.version!==SCHEMA_VERSION)errors.push('Unsupported schema');
  const ids=new Set(),importIds=new Set(archive.imports.map(x=>x.id)),importCounts=new Map();
  for(const c of archive.chunks){if(ids.has(c.id))errors.push(`duplicate ${c.id}`);ids.add(c.id);if(!importIds.has(c.sourceId))errors.push(`orphan chunk ${c.id}`);importCounts.set(c.sourceId,(importCounts.get(c.sourceId)??0)+1);}
  for(const imp of archive.imports){const actual=importCounts.get(imp.id)??0;if(actual!==imp.count)errors.push(`import coverage ${imp.id}: ${actual}/${imp.count}`);}
  const sources=new Set([...archive.sources.map(x=>x.id),...archive.chunks.map(x=>x.id)]);
  for(const f of archive.facts){if(f.sourceIds.some(x=>!sources.has(x)))errors.push(`orphan fact ${f.id}`);}
  return {valid:errors.length===0,errors,sourceCount:archive.sources.length,chunkCount:archive.chunks.length,factCount:archive.facts.length,imports:archive.imports.length};
}
export function extractionPrompt(sources) {
  const safe=sources.map(s=>({id:s.id,role:s.role,name:s.name,text:extractionView(s)}));
  return [
    {role:'system',content:`You are an archival data extractor for fictional roleplay. Output ONLY valid JSON: {"facts":[{"shelf":"chronology|people|relationships|promises|items|knowledge|locations|secrets|quotes|threads|other","text":"specific concrete factual claim","people":["names"],"tags":["entities or object names"],"knowledge_holder":"name or reader-only","certainty":"confirmed|belief|possibility","lifecycle":"active|closed|historical","source_ids":["source id"]}]}. Preserve Russian names and exact promises where possible. Facts MUST be supported by cited text. Separate events from plans and subjective beliefs. No future prediction or gameplay guidance. Do not merge incompatible swipes. Keep essential emotional details and chronology. Max 45 facts. Do not repeat whole message. If no durable facts, facts [].`},
    {role:'user',content:JSON.stringify({task:'Extract durable facts and memorable details, maintain strict sources',messages:safe})}
  ];
}

/** Source-based scheduling: no modulo timing, no automatic bill for imported old chat history. */
export function pendingExtraction(archive,{force=false}={}) {
  const processed=new Set((archive.batches??[]).filter(b=>b.status==='done').flatMap(b=>b.sourceIds));
  const start=force?0:Math.max(0,Number(archive.autoStartIndex)||0);
  const sources=archive.sources.filter(s=>s.active&&!s.deleted&&!processed.has(s.id)&&s.index>=start);
  return {sources,assistantCount:sources.filter(s=>s.role==='assistant').length};
}

/** Extract a concise model-facing view, while retaining the unabridged source in archives. */
export function extractionView(source) {
  const raw=String(source.raw??'');
  if(source.role==='user')return cleanText(raw).slice(0,7000);
  const recap=raw.match(/<en>\s*<details[^>]*>\s*<summary>recap<\/summary>([\s\S]*?)<\/details>\s*<\/en>/i)?.[1]
    ||raw.match(/<en>([\s\S]*?)<\/en>/i)?.[1]||'';
  const prose=raw.match(/<ru>([\s\S]*?)<\/ru>/i)?.[1]||'';
  const easel=raw.match(/<([a-z][\w-]*_easel)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2]
    ||raw.match(/<easel\b[^>]*>([\s\S]*?)<\/easel\s*>/i)?.[1]||'';
  if(!recap&&!prose)return cleanText(raw).slice(0,14000);
  return [recap?`RECAP: ${cleanText(recap).slice(0,7800)}`:'',
    prose?`PROSE (selected): ${cleanText(prose).slice(0,3200)}`:'',
    easel?`EASEL (state, NOT canon forecasts): ${cleanText(easel).slice(0,2000)}`:''].filter(Boolean).join('\n');
}
