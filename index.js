/** Entry point. Importing this file doesn't alter a user's RP preset or chat. */
import * as mn from './src/runtime.js';
import {SHELVES, retrieve, validateArchive, splitMemoryBook} from './src/core.js';
import {initNotifications, notifyMemoryUpdated} from './src/notifications.js';
const BASE=new URL('.',import.meta.url);
let selectedShelf='chronology',activeTab='archive',candidates=[];
const $ = selector=>document.querySelector(`#mnemosyne-panel ${selector}`);
function status(message,bad=false){const el=$('#mn-status');if(el){el.textContent=message;el.dataset.level=bad?'error':'info';}}
function displayError(error){status(error?.message??String(error),true);console.error('[Mnemosyne]',error);}
function bind(selector,event,fn){const el=$(selector);el?.addEventListener(event,async ev=>{try{await fn(ev);}catch(e){displayError(e);}});}
function mkOption(value,label){const option=document.createElement('option');option.value=value;option.textContent=label;return option;}
function renderProfiles(){const sel=$('#mn-profile');if(!sel)return;sel.replaceChildren(mkOption('','— Выберите дешёвую модель —'));
  for(const p of mn.connectionProfiles())sel.append(mkOption(p.id,`${p.name} · ${p.model??p.api??''}`));sel.value=mn.settings().profileId??'';
}
function updateChat(){const s=mn.getStats(),v=$('#mn-overview');if(!v)return;
  v.textContent=s?`Источников: ${s.sourceCount} · фактов: ${s.factCount} · полочек: ${s.chunkCount} · импортов: ${s.imports} · новых ответов до автообновления: ${Math.max(0,s.batchEvery-s.pending)} · ${s.valid?'целостность OK':'ОШИБКИ'}`:'Открой сохранённый чат для работы с памятью.';
  $('#mn-sync').textContent=s?.lastSync?`Снимок сервера: ${new Date(s.lastSync).toLocaleString()}`:'Резервная копия ещё не создана';
  $('#mn-injection').textContent=mn.injectionInfo()||'Память ещё не подставлялась в запрос';
  renderShelves();renderLog();
}
function renderShelves(){const parent=$('#mn-shelves');if(!parent)return;parent.replaceChildren();
  for(const [id,name] of Object.entries(SHELVES)){
    const button=document.createElement('button');button.type='button';button.textContent=name;button.dataset.shelf=id;button.className=id===selectedShelf?'mn-chip current':'mn-chip';
    button.addEventListener('click',()=>{selectedShelf=id;renderShelves();});parent.append(button);
  }
  const list=$('#mn-records');list.replaceChildren();
  const items=mn.shelfRecords(selectedShelf).slice(0,80);
  if(!items.length){list.textContent='Пока пусто. Импортируй Memory Book или обработай текущий чат.';return;}
  for(const item of items){
    const details=document.createElement('details');details.className='mn-record';
    const summary=document.createElement('summary');summary.textContent=(item.text??item.raw??'').slice(0,150);
    const meta=document.createElement('div');meta.className='mn-meta';meta.textContent=`Источник: ${item.sourceId??item.sourceIds?.join(', ')??'—'} · ${item.certainty??'legacy'} · ${item.lifecycle??''}`;
    const pre=document.createElement('pre');pre.textContent=item.raw??item.text;details.append(summary,meta,pre);list.append(details);
  }
}
function renderLog(){const root=$('#mn-log');if(!root)return;root.replaceChildren();for(const l of mn.log.slice(0,35)){
  const line=document.createElement('div');line.className=`mn-log-line ${l.level}`;line.textContent=`${l.at} · ${l.level}: ${l.message}`;root.append(line);
}}
function switchTab(tab){activeTab=tab;for(const button of document.querySelectorAll('#mnemosyne-panel [data-tab]'))button.classList.toggle('current',button.dataset.tab===tab);
  for(const section of document.querySelectorAll('#mnemosyne-panel [data-page]'))section.hidden=section.dataset.page!==tab;
}
function getInput(){return $('#mn-import-text').value;}
async function listDetection(){candidates=mn.detectLegacy();const sel=$('#mn-detected');sel.replaceChildren(mkOption('','— выбери найденный документ —'));
  candidates.forEach((x,i)=>sel.append(mkOption(String(i),`${x.path} (${x.length.toLocaleString('ru')} символов)`)));
  status(candidates.length?`Обнаружено ${candidates.length} похожих источников; выбери и просмотри.`:'Автоматически Memory Book не найдена; можно вставить текст или выбрать файл.');
}
async function restoreFile(file){const text=await file.text();const r=await mn.restoreBackup(text);status(`Восстановлено: ${r.sourceCount} исходников, ${r.factCount} фактов`);updateChat();}
async function initUI(){const container=document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings')||document.querySelector('#extensions_settings_container');
  if(!container)throw Error('SillyTavern extension settings area not found');
  const html=await fetch(new URL('./settings.html',BASE)).then(r=>{if(!r.ok)throw Error('Settings template missing');return r.text();});
  const host=document.createElement('div');host.innerHTML=html;container.append(host);
  const s=mn.settings();$('#mn-enabled').checked=s.enabled;$('#mn-interval').value=s.batchEvery;$('#mn-budget').value=s.contextTokens;$('#mn-auto-update').checked=s.autoUpdate;$('#mn-auto-backup').checked=s.autoBackup;$('#mn-success-notifications').checked=s.successNotifications;
  for(const b of document.querySelectorAll('#mnemosyne-panel [data-tab]'))b.addEventListener('click',()=>switchTab(b.dataset.tab));
  bind('#mn-enabled','change',()=>{s.enabled=$('#mn-enabled').checked;mn.saveSettings();status(s.enabled?'Подстановка памяти включена.':'Подстановка памяти выключена.');});
  bind('#mn-profile','change',()=>{s.profileId=$('#mn-profile').value;mn.saveSettings();status('Профиль архивариуса сохранён; основная модель RP не менялась.');});
  bind('#mn-interval','change',()=>{s.batchEvery=Math.max(1,Math.min(200,Number($('#mn-interval').value)||40));$('#mn-interval').value=s.batchEvery;mn.saveSettings();});
  bind('#mn-budget','change',()=>{s.contextTokens=Math.max(300,Math.min(12000,Number($('#mn-budget').value)||2400));$('#mn-budget').value=s.contextTokens;mn.saveSettings();});
  bind('#mn-auto-update','change',()=>{s.autoUpdate=$('#mn-auto-update').checked;mn.saveSettings();status(s.autoUpdate?'Автообновление включено.':'Автообновление выключено.');});
  bind('#mn-auto-backup','change',()=>{s.autoBackup=$('#mn-auto-backup').checked;mn.saveSettings();});
  bind('#mn-success-notifications','change',()=>{s.successNotifications=$('#mn-success-notifications').checked;mn.saveSettings();});
  bind('#mn-scan','click',async()=>{await mn.fullRescan({notify:true});updateChat();});
  bind('#mn-extract','click',async()=>{status('Архивариус обрабатывает новые события…');const r=await mn.processBacklog({force:true});status(`Готово: ${r.batches} пачек, ${r.facts} фактов`);updateChat();});
  bind('#mn-sync-now','click',async()=>{status('Сохраняю резервную копию на сервер SillyTavern…');const r=await mn.backupNow();status(`Сохранено: ${r.path}`);updateChat();});
  bind('#mn-export','click',()=>{mn.exportBackup();status('Полный архив экспортирован в JSON.');});
  bind('#mn-restore','change',async()=>{const f=$('#mn-restore').files?.[0];if(!f)return;if(!window.confirm('Заменить текущий архив этой резервной копией? Сначала экспортируй текущую!'))return;await restoreFile(f);});
  bind('#mn-detect','click',listDetection);
  bind('#mn-detected','change',()=>{const i=Number($('#mn-detected').value);if(Number.isInteger(i)&&candidates[i])$('#mn-import-text').value=candidates[i].text;});
  bind('#mn-import-file','change',async()=>{const f=$('#mn-import-file').files?.[0];if(f){$('#mn-import-text').value=await f.text();status(`Прочитан файл: ${f.name}`);}});
  bind('#mn-legacy-deep','click',async()=>{const n=mn.currentArchive()?.chunks?.length||0;if(!n)throw Error('Сначала импортируй Memory Book.');if(!window.confirm(`Архивариус дополнительно проиндексирует ${n} фрагментов старой Memory Book с оплатой запросов к выбранной модели. Продолжить?`))return;status('Разбираю наследие небольшими порциями; ошибки JSON будут автоматически перепроверены…');const v=await mn.processLegacy();status(`Готово: ${v.batches} пакетов, ${v.facts} новых фактов`);updateChat();});
  bind('#mn-import','click',async()=>{const text=getInput();if(!text.trim())throw Error('Выбери Memory Book, вставь текст или загрузите файл.');
    const chunks=splitMemoryBook(text);if(!window.confirm(`Импортировать ${chunks.length} разделов/фрагментов? Оригинал сохранится целиком; Summarize не изменится.`))return;
    const r=await mn.importLegacy(text,$('#mn-import-name').value.trim()||'Memory Book');
    status(r.duplicate?'Эта версия уже импортирована':`Готово: ${r.count} записей сохранено с оригиналом; ошибок покрытия: ${r.missing.length}`);updateChat();});
  bind('#mn-check','click',async()=>{const r=await mn.checkHealth();$('#mn-diagnostics').textContent=JSON.stringify(r,null,2);status(r.valid?'Проверка целостности пройдена.':'Обнаружены проблемы, смотри диагностику.',!r.valid);});
  bind('#mn-search','input',()=>{const a=mn.currentArchive();const q=$('#mn-search').value.trim();const output=$('#mn-results');output.replaceChildren();if(!a||q.length<3)return;
    const words=q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const sourceHits=a.sources.filter(x=>words.every(w=>x.raw.toLocaleLowerCase().includes(w))).slice(-10).reverse();
    const memoryHits=retrieve(a,q,{maxCharacters:3200,maxItems:8});
    for(const match of memoryHits){const div=document.createElement('div');div.className='mn-hit';div.textContent=match.text;output.append(div);}
    for(const match of sourceHits){const details=document.createElement('details');details.className='mn-record';const summary=document.createElement('summary');summary.textContent=`Исходник ${match.id} · ${match.role} ${match.active?'(активный свайп)':'(архивная версия)'}`;
      const pre=document.createElement('pre');pre.textContent=match.raw;details.append(summary,pre);output.append(details);}
  });
  document.addEventListener('mnemosyne:status',()=>{renderLog();updateChat();});
  document.addEventListener('mnemosyne:injected',()=>updateChat());
  document.addEventListener('mnemosyne:updated',event=>notifyMemoryUpdated(event.detail?.message,mn.settings().successNotifications));
  renderProfiles();switchTab('archive');updateChat();
}

/** Asynchronous generation interceptor: independent archive queries and prompt injection. */
globalThis.solaMnemosyneBeforeGeneration=async (_chat,_contextSize,_abort,type)=>{
  try{await mn.beforeGeneration(type);}catch(e){console.error('[Mnemosyne] interceptor',e);}
};

async function init(){initNotifications();await initUI();const c=SillyTavern.getContext();
  const events=c.event_types,source=c.eventSource;
  source.on(events.CHAT_CHANGED,async()=>{try{await mn.openChat();updateChat();}catch(e){displayError(e);}});
  source.on(events.MESSAGE_RECEIVED,async()=>{try{await mn.archiveEvent();const a=mn.currentArchive();const count=a?.sources.filter(s=>s.active&&s.role==='assistant').length??0;
    if(mn.settings().autoUpdate&&mn.settings().profileId&&a){mn.maybeAutoProcess().then(updateChat).catch(displayError);}
    updateChat();}catch(e){displayError(e);}});
  for(const name of ['MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED'])if(events[name])source.on(events[name],async()=>{
    try{await mn.fullRescan();updateChat();}catch(e){displayError(e);}
  });
  try{await mn.openChat();}catch(e){displayError(e);}
  updateChat();
}
init().catch(e=>{console.error('[Mnemosyne] Could not initialize',e);});
