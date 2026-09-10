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
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});
 const j=await r.json().catch(()=>({error:'서버 응답을 해석할 수 없습니다.'}));if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);return j;
}
api('/api/health').then(j=>{$('#apiState').textContent=j.keyConfigured?'연결됨':'인증키 미설정';$('#apiState').classList.toggle('ok',j.keyConfigured);}).catch(()=>{$('#apiState').textContent='연결 확인 필요';});
let failedSteps=new Set();
const stepNames=['주소를 확인하고 있습니다','건물 기본정보를 조회하고 있습니다','층별정보를 조회하고 있습니다','호별정보를 정리하고 있습니다'];
function progress(n){$('#loadingTitle').textContent=stepNames[n];$('#loadingText').textContent=n===3?'전유부와 공용면적을 수신·연결 중입니다. 대단지는 시간이 더 걸릴 수 있습니다.':'제공기관 응답을 기다리고 있습니다.';document.querySelectorAll('#progressSteps li').forEach((li,i)=>li.className=failedSteps.has(i)?'failed':i<n?'done':i===n?'active':'');}
function reset(){DATA={recap:[],titles:[],floors:[],units:[],errors:[]};selectedDong='';selectedUnit='';unitPage=allPage=floorPage=0;$('#unitFilter').value='';$('#floorFilter').value='';$('#allUnits').open=false;$('#resultArea').hidden=true;$('#emptyState').hidden=true;tab('units');}
function stop(){controller?.abort();}
$('#cancelSearch').onclick=stop;$('#loadingDialog').addEventListener('cancel',e=>{e.preventDefault();stop();});
$('#searchForm').addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;const address=$('#address').value.trim();if(!address)return;
 busy=true;failedSteps.clear();reset();controller=new AbortController();$('#searchAddress').disabled=true;$('#address').disabled=true;progress(0);$('#loadingDialog').showModal();
 const start=Date.now();$('#elapsed').textContent='0초 경과';timer=setInterval(()=>{$('#elapsed').textContent=`${Math.floor((Date.now()-start)/1000)}초 경과`;},1000);
 status('조회 중입니다.');let resolved=null;
 try{
  resolved=await api('/api/address-search',{address},controller.signal);
  for(const [i,stage] of ['basic','floors','units'].entries()){
   progress(i+1);
   try{
    const j=await api('/api/building',{...resolved.query,stage},controller.signal);
    if(stage==='basic'&&Array.isArray(j.units))throw new Error('Worker를 먼저 새 버전으로 교체해 주세요. 현재 Worker는 단계별 조회를 지원하지 않습니다.');
    if(j.errors?.length)failedSteps.add(i+1);
    const priorErrors=DATA.errors;DATA={...DATA,...j,sourceStatus:{...DATA.sourceStatus,...j.sourceStatus},errors:[...priorErrors,...(j.errors||[])]};
    render(resolved);
   }catch(err){if(controller.signal.aborted)throw err;failedSteps.add(i+1);DATA.errors.push(`${['건물 기본정보','층별정보','호별정보'][i]} · ${err.message}`);if(err.message.includes('Worker를 먼저'))break;}
  }
  render(resolved);const count=DATA.titles.length+DATA.floors.length+DATA.units.length;
  status(count?`${DATA.errors.length?'일부 조회 완료':'조회 완료'} · 표제부 ${DATA.titles.length}건 · 층별 ${DATA.floors.length}건 · 호별 ${DATA.units.length}건`:DATA.errors.length?'조회하지 못했습니다. 아래 실패 원인을 확인해 주세요.':'해당 지번에서 조회된 건축물대장이 없습니다.',DATA.errors.length?'error':'');
 }catch(err){
  const aborted=controller.signal.aborted;status(aborted?'조회가 중단되었습니다. 이미 수신한 자료는 아래에 남아 있습니다.':err.message,'error');
  if(resolved){DATA.errors.push(aborted?'사용자가 조회를 중단했습니다. 미수신 항목은 확인할 수 없습니다.':err.message);render(resolved);}else $('#emptyState').hidden=false;
 }finally{clearInterval(timer);$('#loadingDialog').close();busy=false;$('#searchAddress').disabled=false;$('#address').disabled=false;controller=null;}
});
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
