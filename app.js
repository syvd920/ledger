const CFG=window.BUILDING_LEDGER_CONFIG||{};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>v===null||v===undefined||v===""?"—":Number.isFinite(Number(v))?Number(v).toLocaleString('ko-KR',{maximumFractionDigits:4}):String(v);
const area=v=>Number.isFinite(Number(v))&&Number(v)>0?fmt(v):"—";
const date=v=>/^\d{8}$/.test(String(v))?`${String(v).slice(0,4)}-${String(v).slice(4,6)}-${String(v).slice(6)}`:v||"—";
let DATA={recap:[],titles:[],floors:[],units:[],errors:[]},busy=false,controller=null,timer=null,selectedDong='',selectedUnit='',unitPage=0,allPage=0,floorPage=0;
const PAGE=48;
function status(message,type=''){$('#status').textContent=message;$('#status').className=type;}
async function api(path,body,signal){
 const base=(CFG.WORKER_URL||'').replace(/\/$/,'');if(!base)throw new Error('config.js의 Worker 주소를 확인해 주세요.');
 const local=new AbortController();const cancel=()=>local.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)local.abort();
 const timeout=setTimeout(()=>local.abort(),50000);
 try{
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:local.signal});
  const j=await r.json().catch(()=>({error:`Worker HTTP ${r.status} · 응답을 읽을 수 없습니다. 배포 상태 또는 Worker 오류를 확인하세요.`}));
  if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);return j;
 }catch(e){if(local.signal.aborted&&!signal?.aborted)throw new Error('Worker 응답 시간 초과 · 수신한 페이지는 보존됩니다.');throw e;}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
}
api('/api/health').then(j=>{$('#apiState').textContent=j.keyConfigured?'연결됨':'인증키 미설정';$('#apiState').classList.toggle('ok',j.keyConfigured);}).catch(()=>{$('#apiState').textContent='연결 확인 필요';});
let failedSteps=new Set();
const stepNames=['주소를 확인하고 있습니다','건물 기본정보를 조회하고 있습니다','층별정보를 조회하고 있습니다','호별정보를 정리하고 있습니다'];
function progress(n){$('#loadingTitle').textContent=stepNames[n];$('#loadingText').textContent=n===3?'전유부와 공용면적을 수신·연결 중입니다. 대단지는 시간이 더 걸릴 수 있습니다.':'제공기관 응답을 기다리고 있습니다.';document.querySelectorAll('#progressSteps li').forEach((li,i)=>li.className=failedSteps.has(i)?'failed':i<n?'done':i===n?'active':'');}
function reset(){DATA={recap:[],titles:[],floors:[],units:[],errors:[]};selectedDong='';selectedUnit='';unitPage=allPage=floorPage=0;$('#unitFilter').value='';$('#floorFilter').value='';$('#allUnits').open=false;$('#resultArea').hidden=true;$('#emptyState').hidden=true;tab('units');}
function stop(){controller?.abort();}
$('#cancelSearch').onclick=stop;$('#loadingDialog').addEventListener('cancel',e=>{e.preventDefault();stop();});
let RESOLVED=null,SOURCES={};
const SOURCE_LIST=[['titles','표제부',1],['recap','총괄표제부',1],['floors','층별정보',2],['expos','전유부',3],['areas','전유공용면적',3]];
function waitPage(signal){return new Promise((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',cancel);resolve();};const cancel=()=>{clearTimeout(t);reject(new Error('조회 중단'));};const t=setTimeout(done,250);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}
function syncSources(){
 DATA.errors=SOURCE_LIST.flatMap(([id,label])=>SOURCES[id]?.error?[SOURCES[id].error]:[]);
 DATA.sourceStatus=Object.fromEntries(SOURCE_LIST.map(([id])=>[id,{complete:SOURCES[id]?.complete||false,count:SOURCES[id]?.items.length||0}]));
 for(const id of ['titles','recap','floors'])DATA[id]=SOURCES[id]?.items||[];
 const result=buildUnits(SOURCES.expos?.items||[],SOURCES.areas?.items||[],{exposComplete:!!SOURCES.expos?.complete,areasComplete:!!SOURCES.areas?.complete});
 DATA.units=result.units;DATA.matchDiagnostics=result.diagnostics;
 if(RESOLVED)render(RESOLVED);
}
async function loadPages(id,label,step){
 const state=SOURCES[id];if(state.complete||state.exhausted||state.capped)return;state.error=null;
 progress(step);
 while(!state.complete){
  if(controller.signal.aborted)throw new Error('조회 중단');
  if(state.next>1000||state.items.length>=50000){state.error=`${label} · 안전 조회 한도에 도달했습니다. 받은 ${state.items.length}건은 보존했습니다.`;state.capped=true;break;}
  $('#loadingText').textContent=`${label} ${state.next}페이지 조회 중 · ${state.items.length.toLocaleString('ko-KR')}건 수신${state.total!==null?` / 제공기관 전체 ${state.total.toLocaleString('ko-KR')}건`:''}`;
  let j;
  try{j=await api('/api/building-page',{...RESOLVED.query,source:id,page:state.next,pagination:'count-audit-v1'},controller.signal);}
  catch(e){if(controller.signal.aborted)throw e;state.error=`${label} ${state.next}페이지 · ${e.message}`;break;}
  if(!j.ok){state.error=j.message||`${label} ${state.next}페이지 조회 실패`;break;}
  if(j.source!==id||j.page!==state.next||!Array.isArray(j.items)||j.nextPage!==state.next+1){state.error=`${label} · 잘못된 페이지 응답입니다.`;break;}
  state.trace??=[];
  state.trace.push({page:j.page,requested:j.requestedPageSize,reported:j.reportedPageSize,received:j.items.length,total:j.totalCount});
  if(state.trace.length>12)state.trace.shift();
  if(state.total!==null&&j.totalCount!==null&&j.totalCount!==state.total)state.changed=true;
  if(j.totalCount!==null)state.total=j.totalCount;
  const canonical=JSON.stringify(j.items.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]]))));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  state.fingerprints??=new Set();
  // Do not discard a short page or change the request size. A repeated full
  // page is not committed twice; preserve everything received before it.
  if(j.items.length&&state.fingerprints.has(fingerprint)){
   state.error=`${label} ${state.next}페이지 · 이미 받은 페이지가 반복되었습니다. 중복 합산 없이 ${state.items.length}건을 보존했습니다.`;state.exhausted=true;break;
  }
  if(j.items.length)state.fingerprints.add(fingerprint);
  state.seenRows??=new Set();
  const identified=j.items.filter(row=>row.rnum!=null||row.mgmExposPubuseAreaPk).map(row=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]]))));
  if(identified.some(key=>state.seenRows.has(key)))state.overlap=true;
  identified.forEach(key=>state.seenRows.add(key));
  state.items.push(...j.items);state.next=j.nextPage;
  state.emptyStreak=j.items.length?0:(state.emptyStreak||0)+1;
  // Only the accumulated count can establish a known-total completion.
  if(!state.changed&&!state.overlap&&state.total!==null&&state.items.length===state.total){state.complete=true;break;}
  if(state.emptyStreak>=2){
   state.exhausted=true;
   state.error=`${label} · 다음 두 페이지까지 확인했습니다. 수신 ${state.items.length}건 / 제공기관 전체 ${state.total??'미제공'}건${state.changed?' · 조회 중 전체 건수 변경':''}${state.overlap?' · 페이지 사이 동일 식별정보의 중복 자료 발견':''}. 전체 수신을 확인할 수 없어 일부 자료로 표시합니다.`;
   break;
  }
  await waitPage(controller.signal);
 }
 if(state.error){failedSteps.add(step);$('#loadingFailures').textContent=SOURCE_LIST.map(([key])=>SOURCES[key]?.error).filter(Boolean).join('\n');}
 syncSources();
}

async function runSearch(resume=false){
 if(busy)return;const address=$('#address').value.trim();if(!resume&&!address)return;
 busy=true;failedSteps.clear();
 if(!resume){reset();RESOLVED=null;SOURCES=Object.fromEntries(SOURCE_LIST.map(([id])=>[id,{items:[],next:1,total:null,complete:false,error:null}]));}
 selectedUnit='';controller=new AbortController();$('#searchAddress').disabled=true;$('#address').disabled=true;$('#resumeSearch').hidden=true;$('#loadingFailures').textContent='';progress(0);$('#loadingDialog').showModal();
 const start=Date.now();$('#elapsed').textContent='0초 경과';timer=setInterval(()=>{$('#elapsed').textContent=`${Math.floor((Date.now()-start)/1000)}초 경과`;},1000);
 status(resume?'수신한 자료를 유지하고 미완료 페이지부터 조회합니다.':'조회 중입니다.');
 try{
  const health=await api('/api/health',null,controller.signal);
  if(!health.countAudit)throw new Error('Cloudflare Worker를 먼저 4.0 버전으로 교체하고 Deploy해 주세요.');
  if(!RESOLVED)RESOLVED=await api('/api/address-search',{address},controller.signal);
  for(const [id,label,step] of SOURCE_LIST)if(!SOURCES[id].capped)await loadPages(id,label,step);
  syncSources();
  const incomplete=SOURCE_LIST.some(([id])=>!SOURCES[id].complete);
  const resumable=SOURCE_LIST.some(([id])=>!SOURCES[id].complete&&!SOURCES[id].capped&&!SOURCES[id].exhausted);
  status(`${incomplete?'일부 조회 완료':'조회 완료'} · 표제부 ${DATA.titles.length}건 · 층별 ${DATA.floors.length}건 · 호별 ${DATA.units.length}건${resumable?' · 실패한 요청은 이어서 조회할 수 있습니다.':incomplete?' · 수신 자료와 전체 건수 차이는 상단 안내를 확인하세요.':''}`,incomplete?'error':'');
 }catch(e){
  const aborted=controller.signal.aborted;
  if(RESOLVED){
   for(const [id,label] of SOURCE_LIST)if(!SOURCES[id].complete&&!SOURCES[id].error)SOURCES[id].error=`${label} · ${aborted?'조회 중단 · 받은 자료 보존':e.message}`;
   syncSources();
  }else $('#emptyState').hidden=false;
  status(aborted?'조회 중단 · 받은 자료는 보존했습니다. 이어서 조회할 수 있습니다.':e.message,'error');
 }finally{
  clearInterval(timer);$('#loadingDialog').close();busy=false;$('#searchAddress').disabled=false;$('#address').disabled=false;controller=null;
  $('#resumeSearch').hidden=!RESOLVED||!SOURCE_LIST.some(([id])=>!SOURCES[id].complete&&!SOURCES[id].capped&&!SOURCES[id].exhausted);
 }
}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();return runSearch(false);});
$('#resumeSearch').onclick=()=>runSearch(true);

const diagnosticButton=document.createElement('button');
diagnosticButton.type='button';diagnosticButton.className='secondary';diagnosticButton.textContent='조회 진단 저장';
$('#resumeSearch').after(diagnosticButton);
diagnosticButton.onclick=()=>{
 if(!RESOLVED){status('주소 조회 후 사용할 수 있습니다.');return;}
 const report={version:'4.0',address:RESOLVED.resolvedAddress,query:RESOLVED.query,sources:Object.fromEntries(SOURCE_LIST.map(([id])=>{const x=SOURCES[id];return [id,{received:x.items.length,total:x.total,complete:x.complete,nextPage:x.next,error:x.error,trace:x.trace||[]}];}))};
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='building-query-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function tab(id){document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});for(const name of ['units','basic','floors'])$(`#panel-${name}`).hidden=name!==id;}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function table(selector,cols,rows){$(selector).innerHTML=`<thead><tr>${cols.map(([name])=>`<th scope="col">${esc(name)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${cols.map(([,key])=>`<td>${esc(typeof key==='function'?key(r):(r[key]??'—'))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">표시할 자료가 없습니다.</td></tr>`}</tbody>`;}
const unitCols=[['동','dongNm'],['호','hoNm'],['층','flrNoNm'],['전유 ㎡',r=>area(r.exclusiveArea)],['주거공용 ㎡',r=>area(r.residentialCommonArea)],['기타공용 ㎡',r=>area(r.otherCommonArea)],['공급 ㎡',r=>area(r.supplyArea)],['계약 ㎡',r=>area(r.contractArea)],['상태','areaStatus']];
function pager(selector,count,page,onPage){const pages=Math.ceil(count/PAGE);$(selector).innerHTML=pages>1?`<button type="button" data-prev ${page===0?'disabled':''} aria-label="이전 페이지">← 이전</button><span>${page+1} / ${pages}</span><button type="button" data-next ${page>=pages-1?'disabled':''} aria-label="다음 페이지">다음 →</button>`:'';$(selector).querySelector('[data-prev]')?.addEventListener('click',()=>onPage(page-1));$(selector).querySelector('[data-next]')?.addEventListener('click',()=>onPage(page+1));}
function render(resolved){
 $('#resultArea').hidden=false;const t=DATA.titles[0]||DATA.recap[0]||{};
 $('#buildingTitle').textContent=t.bldNm||'건축물 조회 결과';$('#resolvedAddress').textContent=t.newPlatPlc||t.platPlc||resolved.resolvedAddress;
 $('#queryCodes').innerHTML=[['시군구코드',resolved.query.sigunguCd],['법정동코드',resolved.query.bjdongCd],['본번',Number(resolved.query.bun)],['부번',Number(resolved.query.ji)]].map(([k,v])=>`<span>${k}<b>${esc(v)}</b></span>`).join('');
 $('#warnings').hidden=!DATA.errors.length;$('#warnings').textContent=DATA.errors.join('\n');
 $('#summaryCards').innerHTML=[['주용도',t.mainPurpsCdNm||t.etcPurps||'—'],['연면적',t.totArea?`${area(t.totArea)} ㎡`:'—'],['지상 / 지하',`${fmt(t.grndFlrCnt)} / ${fmt(t.ugrndFlrCnt)} 층`],['사용승인일',date(t.useAprDay)],['조회된 동 / 호',`${new Set(DATA.units.map(u=>u.dongNm)).size} / ${DATA.units.length}`]].map(([k,v])=>`<div class="metric"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
 $('#basicInfo').innerHTML=[['건물명',t.bldNm],['동명',t.dongNm],['대지위치',t.platPlc],['도로명주소',t.newPlatPlc],['주용도',t.mainPurpsCdNm],['기타용도',t.etcPurps],['구조',t.strctCdNm||t.etcStrct],['지붕',t.roofCdNm||t.etcRoof],['대지면적 ㎡',area(t.platArea)],['건축면적 ㎡',area(t.archArea)],['연면적 ㎡',area(t.totArea)],['용적률산정연면적 ㎡',area(t.vlRatEstmTotArea)],['건폐율 %',fmt(t.bcRat)],['용적률 %',fmt(t.vlRat)],['높이 m',fmt(t.heit)],['세대 / 가구',`${fmt(t.hhldCnt)} / ${fmt(t.fmlyCnt)}`],['승용승강기',fmt(t.rideUseElvtCnt)],['비상용승강기',fmt(t.emgenUseElvtCnt)],['사용승인일',date(t.useAprDay)],['주차 대수',parking(t)]].map(([k,v])=>`<div class="info"><span>${k}</span><b>${esc(v??'—')}</b></div>`).join('');
 table('#titlesTable',[['동','dongNm'],['건물명','bldNm'],['주용도','mainPurpsCdNm'],['구조','strctCdNm'],['지상층','grndFlrCnt'],['지하층','ugrndFlrCnt'],['연면적 ㎡',r=>area(r.totArea)],['사용승인일',r=>date(r.useAprDay)]],DATA.titles);
 renderDongs();renderFloors();renderAll();$('#unitNotice').textContent='면적 단위: ㎡ · 공용 구분은 원본 용도로 추정합니다. 빈 값·0·연결 불확실·조회 불완전은 자료없음으로 처리합니다. 공급·계약면적은 필요한 항목이 모두 확인될 때만 계산한 참고값입니다.';
}
function parking(t){if(t.totPkngCnt!=null)return fmt(t.totPkngCnt);const keys=['indrAutoUtcnt','oudrAutoUtcnt','indrMechUtcnt','oudrMechUtcnt'];return keys.every(k=>t[k]!=null)?fmt(keys.reduce((a,k)=>a+Number(t[k]),0)):'—';}
function renderDongs(){
 const dongs=[...new Set(DATA.units.map(u=>u.dongNm))];$('#dongSelect').innerHTML='<option value="">동을 선택하세요</option>'+dongs.map(d=>`<option value="${esc(d)}">${esc(d)} · ${DATA.units.filter(u=>u.dongNm===d).length}호</option>`).join('');
 $('#dongSelect').value=selectedDong;$('#dongSelect').disabled=!dongs.length;
 $('#dongList').innerHTML=dongs.map(d=>`<button type="button" data-dong="${esc(d)}" aria-pressed="${d===selectedDong}"><span>${esc(d)}</span><span>${DATA.units.filter(u=>u.dongNm===d).length}</span></button>`).join('');
 $('#dongList').querySelectorAll('button').forEach(b=>b.onclick=()=>chooseDong(b.dataset.dong));renderUnits();
}
function chooseDong(d){selectedDong=d;selectedUnit='';unitPage=0;$('#unitFilter').value='';renderDongs();}
$('#dongSelect').onchange=e=>chooseDong(e.target.value);$('#unitFilter').oninput=()=>{unitPage=0;renderUnits();};
function renderUnits(){
 const rows=DATA.units.filter(u=>u.dongNm===selectedDong&&`${u.hoNm} ${u.flrNoNm}`.includes($('#unitFilter').value.trim()));
 $('#unitCount').textContent=selectedDong?`${rows.length}호`:'';$('#unitFilter').disabled=!selectedDong;
 $('#unitList').innerHTML=!selectedDong?`<p class="muted">${DATA.units.length?'왼쪽에서 동을 선택하세요.':'조회된 호별 자료가 없습니다. 조회 오류가 있다면 상단 원인을 확인하세요.'}</p>`:!rows.length?'<p class="muted">검색 조건에 맞는 호수가 없습니다.</p>':rows.slice(unitPage*PAGE,(unitPage+1)*PAGE).map(u=>`<button type="button" data-unit="${esc(u._pk)}" aria-pressed="${u._pk===selectedUnit}">${esc(u.hoNm)}<small>${esc(u.flrNoNm||'층 미기재')}${u.source!=='expos'?' · 확인 필요':''}</small></button>`).join('');
 $('#unitList').querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>{selectedUnit=b.dataset.unit;renderUnits();});
 pager('#unitPager',rows.length,unitPage,p=>{unitPage=p;renderUnits();});renderDetail();
}
function renderDetail(){
 const u=DATA.units.find(x=>x._pk===selectedUnit);if(!u){$('#unitDetail').innerHTML='<div class="empty-detail">동을 선택한 뒤 호수를 누르면 면적 상세가 표시됩니다.</div>';return;}
 const cards=[['전유면적','exclusiveArea'],['주거공용 · 추정','residentialCommonArea'],['기타공용 · 추정','otherCommonArea'],['공급면적 · 계산','supplyArea'],['계약면적 · 계산','contractArea']];
 $('#unitDetail').innerHTML=`<div class="detail-head"><div><span class="eyebrow">선택한 호수</span><h2>${esc(u.dongNm)} · ${esc(u.hoNm)}</h2></div><span class="badge">${esc(u.areaStatus)}</span></div><div class="area-grid">${cards.map(([label,key])=>`<div class="area-item"><label>${label}</label><strong>${area(u[key])}</strong><small>${u[key]>0?`${fmt(u[key]/3.305785)} 평`:'자료없음'}</small></div>`).join('')}</div><div class="detail-meta">${esc(u.flrNoNm||'층 미기재')} · ${esc(u.purpose||'용도 미기재')}<br>관리번호 ${esc(u.registerId||'미기재')} · 연결 기준 ${esc((u.matches||[]).join(', ')||'연결 자료 없음')}${u.unclassifiedCommonArea>0?`<br>미분류 공용면적 ${area(u.unclassifiedCommonArea)} ㎡`:''}${(u.warnings||[]).length?`<div class="warning">${esc(u.warnings.join('\n'))}</div>`:''}<details><summary>연결된 면적 원본 ${(u.rows||[]).length}건</summary><div class="table-wrap"><table><thead><tr><th>동 / 호</th><th>층</th><th>구분</th><th>용도</th><th>원본 면적 ㎡</th><th>관리번호</th></tr></thead><tbody>${(u.rows||[]).map(r=>`<tr><td>${esc(r.dongNm||'—')} / ${esc(r.hoNm||'—')}</td><td>${esc(r.flrNoNm||r.flrNo||'—')}</td><td>${esc(r.exposPubuseGbCdNm||'구분 없음')}</td><td>${esc(r.etcPurps||r.mainPurpsCdNm||'—')}</td><td>${esc(r.area==null||r.area===''?'빈 값':Number(r.area)===0?'0 (원본값 · 합계 제외)':r.area)}</td><td>${esc(r.mgmBldrgstPk||'—')}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}
function renderAll(){table('#unitsTable',unitCols,DATA.units.slice(allPage*PAGE,(allPage+1)*PAGE));pager('#allPager',DATA.units.length,allPage,p=>{allPage=p;renderAll();});}
function renderFloors(){const q=$('#floorFilter').value.trim().toLowerCase();const rows=DATA.floors.filter(r=>[r.dongNm,r.flrNoNm,r.etcPurps,r.mainPurpsCdNm].join(' ').toLowerCase().includes(q));table('#floorsTable',[['동','dongNm'],['층','flrNoNm'],['용도',r=>r.etcPurps||r.mainPurpsCdNm],['구조',r=>r.etcStrct||r.strctCdNm],['면적 ㎡',r=>area(r.area)],['주/부속','mainAtchGbCdNm']],rows.slice(floorPage*PAGE,(floorPage+1)*PAGE));pager('#floorPager',rows.length,floorPage,p=>{floorPage=p;renderFloors();});}
$('#floorFilter').oninput=()=>{floorPage=0;renderFloors();};
document.querySelectorAll('[data-csv]').forEach(b=>b.onclick=()=>{
 const key=b.dataset.csv,rows=DATA[key]||[];if(!rows.length){status('저장할 자료가 없습니다.');return;}
 const cols=key==='units'?['dongNm','hoNm','flrNoNm','purpose','exclusiveArea','residentialCommonArea','otherCommonArea','unclassifiedCommonArea','supplyArea','contractArea','areaStatus']:key==='floors'?['dongNm','flrNoNm','etcPurps','mainPurpsCdNm','area','strctCdNm']:['dongNm','bldNm','mainPurpsCdNm','strctCdNm','grndFlrCnt','ugrndFlrCnt','totArea','useAprDay'];
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const csv='\ufeff'+[cols.join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`building-${key}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

// Shared matching logic, identical to Worker.
function norm(v,suffix=""){
 let s=String(v??"").normalize("NFKC").trim().replace(/\s+/g,"").toUpperCase();
 if(suffix)s=s.replace(new RegExp(suffix+"$"),"");
 return s.replace(/\d+/g,x=>String(Number(x)));
}
function identity(r){return {pk:String(r.mgmBldrgstPk||"").trim(),dong:norm(r.dongNm,"동"),ho:norm(r.hoNm,"호"),floor:norm(r.flrNoNm||r.flrNo,"층")};}
function sameUnit(a,b){return !(a.dong&&b.dong&&a.dong!==b.dong)&&!(a.ho&&b.ho&&a.ho!==b.ho);}
function areaValue(v){if(v===null||v===undefined||String(v).trim()==="")return null;const n=Number(String(v).replace(/,/g,""));return Number.isFinite(n)&&n>0?n:null;}
function commonType(r){
 const t=[r.etcPurps,r.mainPurpsCdNm].filter(Boolean).join(" ");
 if(/주차|기계|전기|관리|경비|창고|펌프|발전|저수|정화|쓰레기|커뮤니티|부대|복리/.test(t))return "otherCommonArea";
 if(/계단|복도|승강기|엘리베이터|현관|홀|주거공용/.test(t))return "residentialCommonArea";
 return "unclassifiedCommonArea";
}
function round(v){return Math.round(v*10000)/10000;}
function buildUnits(expos,areas,{exposComplete=true,areasComplete=true}={}){
 const units=[],pkIndex=new Map(),pairIndex=new Map(),orphanIndex=new Map();
 const diagnostics={matchedByPk:0,matchedByIdentity:0,unmatched:0,ambiguous:0,zeroOrMissing:0,areaOnlyUnits:0};
 const addIndex=(map,k,u)=>{if(!k)return;if(!map.has(k))map.set(k,[]);if(!map.get(k).includes(u))map.get(k).push(u);};
 function create(r,source){
  const id=identity(r),u={dongNm:r.dongNm||"동 미기재",hoNm:r.hoNm||"호 미기재",flrNoNm:r.flrNoNm||r.flrNo||"",purpose:r.etcPurps||r.mainPurpsCdNm||"",_pk:`unit-${units.length+1}`,registerId:id.pk,source,identity:id,rows:[],matches:[],warnings:[],exclusiveArea:null,residentialCommonArea:null,otherCommonArea:null,unclassifiedCommonArea:null,supplyArea:null,contractArea:null};
  units.push(u);if(source==="expos"){addIndex(pkIndex,id.pk,u);if(id.dong&&id.ho)addIndex(pairIndex,`${id.dong}|${id.ho}`,u);}return u;
 }
 for(const r of expos){
  const id=identity(r);let existing=(pkIndex.get(id.pk)||[]).filter(u=>sameUnit(id,u.identity));
  if(!id.pk)existing=(pairIndex.get(`${id.dong}|${id.ho}`)||[]).filter(u=>id.floor&&u.identity.floor===id.floor&&!u.identity.pk);
  if(existing.length!==1)create(r,"expos");
 }
 for(const r of areas){
  const id=identity(r);let candidates=(pkIndex.get(id.pk)||[]).filter(u=>sameUnit(id,u.identity)),method="관리번호";
  if(candidates.length!==1){
   candidates=id.dong&&id.ho?(pairIndex.get(`${id.dong}|${id.ho}`)||[]):[];method="동·호";
   const isExclusive=String(r.exposPubuseGbCdNm||"").includes("전유");
   if(candidates.length>1&&isExclusive&&id.floor)candidates=candidates.filter(u=>u.identity.floor===id.floor);
  }
  let u;
  if(candidates.length===1){u=candidates[0];diagnostics[method==="관리번호"?"matchedByPk":"matchedByIdentity"]++;}
  else {
   const state=candidates.length>1?"ambiguous":"unmatched";diagnostics[state]++;
   // Never silently attach a row to one of several possible units.
   const orphanKey=JSON.stringify([state,id.pk,id.dong,id.ho]);u=orphanIndex.get(orphanKey);
   if(!u){u=create(r,state);orphanIndex.set(orphanKey,u);diagnostics.areaOnlyUnits++;u.warnings.push(state==="ambiguous"?"전유부 연결 후보가 여러 개입니다. 면적 원본만 표시합니다.":"전유부와 연결되지 않은 면적 원본입니다.");}
   method="면적 원본";
  }
  u.rows.push(r);if(!u.matches.includes(method))u.matches.push(method);
 }
 for(const u of units){
  const sums={},invalid=new Set();
  for(const r of u.rows){
   const g=String(r.exposPubuseGbCdNm||"");
   const field=g.includes("전유")?"exclusiveArea":g.includes("공용")?commonType(r):null;
   if(!field){u.warnings.push("전유·공용 구분 미기재 자료가 있어 합계를 계산하지 않았습니다.");invalid.add("unknown");continue;}
   const a=areaValue(r.area);
   if(a===null){invalid.add(field);diagnostics.zeroOrMissing++;continue;}
   sums[field]=(sums[field]||0)+a;
  }
  for(const field of ["exclusiveArea","residentialCommonArea","otherCommonArea","unclassifiedCommonArea"]){
   if(sums[field]!=null&&!invalid.has(field)&&areasComplete&&!invalid.has("unknown"))u[field]=round(sums[field]);
  }
  if(invalid.size)u.warnings.push("원본 면적이 0·빈 값·유효하지 않은 값이거나 구분이 없습니다. 해당 합계는 자료없음으로 표시합니다.");
  if(!areasComplete)u.warnings.push("전유공용면적 조회가 불완전하여 면적 합계를 확정할 수 없습니다.");
  if(!exposComplete)u.warnings.push("전유부 조회가 불완전합니다.");
  if(!u.rows.length)u.warnings.push(areasComplete?"연결된 면적 자료가 없습니다. 원본 부재 또는 식별정보 불일치 가능성이 있습니다.":"면적 API 조회 실패 또는 일부 수신으로 확인할 수 없습니다.");
  if(sums.unclassifiedCommonArea!=null||invalid.has("unclassifiedCommonArea"))u.warnings.push("용도로 구분할 수 없는 공용면적이 있습니다. 공급·계약면적은 계산하지 않습니다.");
  if(u.exclusiveArea!==null&&u.residentialCommonArea!==null&&!sums.unclassifiedCommonArea&&!invalid.has("unclassifiedCommonArea"))u.supplyArea=round(u.exclusiveArea+u.residentialCommonArea);
  if(u.supplyArea!==null&&u.otherCommonArea!==null)u.contractArea=round(u.supplyArea+u.otherCommonArea);
  u.areaStatus=!areasComplete?"조회 불완전":u.source!=="expos"?"매칭 확인 필요":!u.rows.length?"연결 자료 없음":invalid.size?"원본 면적 확인 필요":"면적 원본 연결";
  u.warnings=[...new Set(u.warnings)];delete u.identity;
 }
 units.sort((a,b)=>a.dongNm.localeCompare(b.dongNm,"ko",{numeric:true})||a.hoNm.localeCompare(b.hoNm,"ko",{numeric:true}));
 return {units,diagnostics};
}
