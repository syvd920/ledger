import {summarize,norm} from './area.js';
const $=s=>document.querySelector(s),CFG=window.BUILDING_LEDGER_CONFIG||{};
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>v===null||v===undefined||v===''?'미기재':Number.isFinite(Number(v))?Number(v).toLocaleString('ko-KR',{maximumFractionDigits:4}):String(v);
const labels={titles:'표제부',recap:'총괄표제부',floors:'층별개요',areas:'전유공용면적'};
let phase='',busy=false,abort=null,resolved=null,title=null,dong='',addressPage=1,addressText='',lastCandidates=[],trace=[],errors=[],states={},detail=null,sessionCalls=0;
const memories=new Map();
function status(s,error=false){$('#status').textContent=s;$('#status').className=error?'error':'';}
const kstDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function ledger(){try{return JSON.parse(localStorage.getItem('ledger-usage-v5'))||{};}catch{return {};}}
function usage(meta){
 let x=ledger();if(x.day!==kstDay())x={day:kstDay(),building:0,region:0,juso:0};
 if(meta){for(const k of ['building','region','juso'])x[k]=(x[k]||0)+(meta.calls?.[k]||0);sessionCalls+=Object.values(meta.calls||{}).reduce((a,b)=>a+b,0);try{localStorage.setItem('ledger-usage-v5',JSON.stringify(x));}catch{}}
 const limit=Number($('#dailyLimit').value)||10000;$('#usage').textContent=`이번 조회 ${sessionCalls}회 · 오늘 이 브라우저 관측 건축HUB ${x.building||0}회 / 잔여 추정 ${Math.max(0,limit-(x.building||0))}회 · 코드 ${x.region||0}회 · 주소 ${x.juso||0}회`;
 $('#usage').title='재시도 포함. 다른 사용자·기기·앱 호출과 중단 중 서버 호출은 포함되지 않으므로 실제 잔여량은 공공데이터포털에서 확인하세요. 캐시 적중은 0회입니다.';
}
$('#dailyLimit').oninput=()=>usage();usage();
async function api(path,body){
 const local=new AbortController(),outer=abort?.signal,cancel=()=>local.abort();outer?.addEventListener('abort',cancel,{once:true});if(outer?.aborted)local.abort();
 const timeout=setTimeout(()=>local.abort(),45000);
 try{
  const r=await fetch((CFG.WORKER_URL||'').replace(/\/$/,'')+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:local.signal});
  const j=await r.json().catch(()=>({error:`Worker HTTP ${r.status} · JSON 응답 아님`}));usage(j.meta);
  for(const t of j.meta?.trace||[])trace.push(t);
  renderTrace();if(!r.ok||j.error)throw new Error(j.error||`Worker HTTP ${r.status}`);return j;
 }catch(e){if(local.signal.aborted&&!outer?.aborted)throw new Error('Worker 응답 시간 초과 (45초) · 서버의 남은 호출은 관측 수에서 빠질 수 있습니다.');throw e;}
 finally{clearTimeout(timeout);outer?.removeEventListener('abort',cancel);}
}
async function task(message,fn){
 if(busy)return;busy=true;phase=message;abort=new AbortController();$('#loading').hidden=false;$('#loadingText').textContent=message;$('#resultArea').setAttribute('aria-busy','true');const start=Date.now();const timer=setInterval(()=>$('#loadingText').textContent=`${phase} · ${Math.floor((Date.now()-start)/1000)}초 경과`,1000);
 document.querySelectorAll('button').forEach(b=>{if(b.id!=='cancelSearch')b.disabled=true;});
 try{await fn();}catch(e){const msg=abort.signal.aborted?'조회 중단 · 받은 자료 보존 · 중단 중 서버 호출은 관측 수에서 빠질 수 있습니다.':e.message;status(msg,true);errors.push(msg);renderErrors();}
 finally{clearInterval(timer);busy=false;abort=null;$('#loading').hidden=true;$('#resultArea').setAttribute('aria-busy','false');document.querySelectorAll('button').forEach(b=>b.disabled=b.dataset.disabled==='true');}
}
$('#cancelSearch').onclick=()=>abort?.abort();
function renderTrace(){$('#trace').innerHTML=trace.map(t=>`<li><b>${esc(t.api)}</b> ${t.cache?'· '+esc(t.cache):''} · ${(t.attempts||[]).map(a=>`${a.attempt}차 HTTP ${a.http??'미수신'} / API ${esc(a.code??'미제공')} · ${esc(a.ok?'성공':a.message)}`).join('<br>')}</li>`).join('');}
function renderErrors(){$('#warnings').hidden=!errors.length;$('#warnings').textContent=errors.join('\n');}
function reset(){for(const selector of ['#buildingTitle','#resolvedAddress','#queryCodes','#summaryCards','#basicInfo','#titlesState','#titleCandidates','#titlesPager','#recapState','#recapTable','#recapPager'])$(selector).textContent='';titleRows=[];resolved=null;title=null;dong='';states={};detail=null;errors=[];trace=[];sessionCalls=0;$('#resultArea').hidden=true;$('#candidates').hidden=true;$('#emptyState').hidden=true;$('#unitList').innerHTML='';$('#unitsPager').innerHTML='';$('#detailPager').innerHTML='';$('#unitDetail').innerHTML='<div class="empty-detail">호를 선택하면 해당 호의 면적을 별도로 조회합니다.</div>';$('#floorsTable').innerHTML='';$('#floorsPager').innerHTML='';$('#floorsState').textContent='아직 조회하지 않았습니다.';$('#hoInput').value='';$('#dongInput').value='';$('#dongSelect').value='';$('#unitCount').textContent='동을 선택하면 해당 동의 한 페이지를 요청합니다.';usage();renderErrors();renderTrace();tab('basic');}
async function searchCandidates(page=1){
 if(page===1){reset();addressText=$('#address').value.trim();}addressPage=page;
 const j=await api('/api/address-search',{address:addressText,page});lastCandidates=j.candidates||[];
 $('#candidates').hidden=false;$('#candidateNotice').textContent=j.message;$('#addressNext').hidden=!j.hasMore;
 $('#candidateList').innerHTML=lastCandidates.length?lastCandidates.map((r,i)=>`<button type="button" class="candidate" data-candidate="${i}" ${r.query?'':'disabled data-disabled="true"'}><strong>${esc(r.label)}</strong><span>${esc(r.jibun||'')} ${esc(r.building||'')}</span>${r.related?`<small>관련지번: ${esc(r.related)}</small>`:''}<small>${esc(r.reason||`코드 ${r.query.sigunguCd}-${r.query.bjdongCd} / 대지구분 ${r.query.platGbCd}`)}</small></button>`).join(''):'<p>주소 후보가 없습니다. 도로명 재검색 또는 코드·블록 조회를 이용하세요.</p>';
 $('#candidateList').querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>task('건물 · 동 기본정보 조회',()=>start(lastCandidates[Number(b.dataset.candidate)])));
 status(`주소 후보 ${lastCandidates.length}건 · ${page}페이지 · 선택 전 건축물 API는 호출하지 않습니다.`);
}
$('#searchForm').onsubmit=e=>{e.preventDefault();task('주소 · 법정동 후보 확인',()=>searchCandidates());};
$('#addressNext').onclick=()=>task('다음 주소 후보 조회',()=>searchCandidates(addressPage+1));
$('#codeForm').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));if(v.platGbCd!=='2'&&!v.bun){status('일반·산 주소는 본번을 입력해 주세요.',true);return;}task('코드 조건으로 기본정보 조회',async()=>{reset();await start({label:`코드 ${v.sigunguCd}-${v.bjdongCd} · ${v.platGbCd==='2'?`${v.block}블록 ${v.lot}로트`:`${v.bun}-${v.ji||0}`}`,query:{...v,ji:v.ji||'0'},block:v.block,lot:v.lot});});};
async function start(candidate){
 resolved=candidate;$('#candidates').hidden=true;$('#resultArea').hidden=false;$('#emptyState').hidden=true;
 $('#resolvedAddress').textContent=candidate.label;$('#queryCodes').textContent=`시군구 ${candidate.query.sigunguCd} · 법정동 ${candidate.query.bjdongCd} · 대지구분 ${candidate.query.platGbCd} · 본번 ${candidate.query.bun||'미확정'} / 부번 ${candidate.query.ji||'미확정'}${candidate.block?` · 블록 ${candidate.block} / 로트 ${candidate.lot||'미기재'}`:''}`;
 states={};titleRows=[];title=null;dong='';
 // Independent sources: one failure must not erase the other result.
 for(const s of candidate.query.platGbCd==='2'&&!candidate.query.bun?['titles']:['titles','recap']){
  if(abort.signal.aborted)break;
  try{await load(s,1);}catch(e){if(abort.signal.aborted)throw e;errors.push(`${labels[s]} · ${e.message}`);renderErrors();}
 }
 if(!title){$('#buildingTitle').textContent='표제부 미확인';$('#summaryCards').innerHTML='';$('#basicInfo').innerHTML='';}
 renderDongs();status(`기본 조회 종료 · 자동 전유부/공용면적 호출 0회${errors.length?' · 일부 실패는 진단 확인':''}`);
}
function stateKey(s,extra){return JSON.stringify([resolved.query,s,extra]);}
async function getPage(s,page,extra={}){
 const body={...resolved.query,source:s,page,...extra},key=JSON.stringify(body);const old=memories.get(key);
 if(old&&Date.now()-old.at<900000){trace.push({api:labels[s],attempts:[{attempt:0,http:null,code:null,ok:true}],cache:'브라우저 캐시'});renderTrace();return old.value;}
 const j=await api('/api/building-page',body);
 if(j.page!==page||j.source!==s||!Array.isArray(j.items))throw new Error('Worker 페이지 응답 불일치');
 memories.set(key,{value:j,at:Date.now()});if(memories.size>40)memories.delete(memories.keys().next().value);return j;
}
async function load(s,page=1,extra={}){
 phase=`${labels[s]} · ${extra.dongNm||''} ${extra.hoNm||''} · ${page}페이지 조회`;
 const key=stateKey(s,extra),old=states[key],j=await getPage(s,page,extra);
 const fingerprint=JSON.stringify(j.items.map(({rnum,...r})=>r));
 if(old&&old.page!==page&&j.items.length&&old.fingerprint===fingerprint)throw new Error(`${labels[s]} · 동일 자료 페이지 반복 · 받은 자료를 보존하고 중단했습니다.`);
 if(old&&old.totalCount!==null&&j.totalCount!==old.totalCount)throw new Error(`${labels[s]} · 조회 중 전체 건수가 바뀌었습니다. 새 주소 조회로 다시 시작하세요.`);
 states[key]={...j,fingerprint};
 if(s==='titles'){renderTitles(j);renderDongs();}
 if(s==='recap'){table('#recapTable',[['건물명','bldNm'],['지번','platPlc'],['동수','totDongCnt'],['연면적','totArea']],j.items);$('#recapState').textContent=pageText(j);pager('#recapPager',j,p=>load(s,p));}
 if(s==='floors'){table('#floorsTable',[['동','dongNm'],['층','flrNoNm'],['층번호','flrNo'],['용도','mainPurpsCdNm'],['면적 ㎡','area']],j.items);$('#floorsState').textContent=pageText(j)+' · 현재 지번 범위 자료';pager('#floorsPager',j,p=>load(s,p));}
 if(s==='areas'&&extra.scope==='dong')renderUnits(j,extra);
 return j;
}
function pageText(j){return `${labels[j.source]} ${j.page}페이지 · 현재 ${j.items.length}행 / 전체 ${j.totalCount??'미제공'}행 · ${j.cached?'Worker 캐시':'수신'} · ${j.fetchedAt}`;}
function pager(selector,j,fn){
 const el=$(selector);el.innerHTML=`<button data-prev ${j.page===1?'disabled data-disabled="true"':''}>이전</button><span>${j.page}페이지 · ${j.totalCount===null?'전체 건수 미제공':`총 ${Math.ceil(j.totalCount/j.pageSize)}페이지`} · 다음 최대 2회 호출</span><button data-next ${j.hasMore?'':'disabled data-disabled="true"'}>다음 페이지</button>`;
 el.querySelector('[data-prev]').onclick=()=>task('이전 페이지 조회',()=>fn(j.page-1));el.querySelector('[data-next]').onclick=()=>task('다음 한 페이지 조회',()=>fn(j.page+1));
}
function table(selector,cols,rows){$(selector).innerHTML=`<thead><tr>${cols.map(([l])=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${cols.map(([,k])=>`<td>${esc(fmt(r[k]))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">현재 페이지 자료 없음</td></tr>`}</tbody>`;}
let titleRows=[];
function renderTitles(j){
 const b=norm(resolved.block||resolved.query.block),l=norm(resolved.lot||resolved.query.lot);
 titleRows=j.items.filter(r=>(!b||norm(r.block)===b)&&(!l||norm(r.lot)===l));
 $('#titlesState').textContent=pageText(j)+` · 현재 페이지 조건 일치 ${titleRows.length}건${b||l?' · 블록/로트 원문 일치 비교':''} · 전체 동 목록 완료를 의미하지 않습니다.`;
 $('#titleCandidates').innerHTML=titleRows.length?titleRows.map((r,i)=>`<button data-title="${i}"><span>${esc(r.dongNm||'동명 없음')} · ${esc(r.bldNm||r.platPlc||'건물명 없음')}</span><small>블록 ${esc(r.block||'—')} / 로트 ${esc(r.lot||'—')} · ${esc(r.mgmBldrgstPk||'관리번호 미기재')}</small></button>`).join(''):'<p>현재 페이지에 일치하는 표제부가 없습니다. 다른 페이지 또는 확정 지번을 확인하세요.</p>';
 $('#titleCandidates').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(busy)return;selectTitle(titleRows[Number(b.dataset.title)]);});
 if(!title&&titleRows.length)selectTitle(titleRows[0]);pager('#titlesPager',j,p=>load('titles',p));
}
function selectTitle(t){title=t;$('#buildingTitle').textContent=t.bldNm||t.dongNm||'건축물 조회 결과';
 $('#summaryCards').innerHTML=[['용도',t.mainPurpsCdNm],['연면적 ㎡',t.totArea],['지상층',t.grndFlrCnt],['세대수 (원본)',t.hhldCnt],['사용승인',t.useAprDay]].map(([k,v])=>`<div class="metric"><span>${k}</span><strong>${esc(fmt(v))}</strong></div>`).join('');
 $('#basicInfo').innerHTML=[['건물명',t.bldNm],['동명',t.dongNm],['대지위치',t.platPlc],['도로명',t.newPlatPlc],['대지면적 ㎡',t.platArea],['건축면적 ㎡',t.archArea],['연면적 ㎡',t.totArea],['용도',t.mainPurpsCdNm],['블록',t.block],['로트',t.lot],['관리번호',t.mgmBldrgstPk],['자료 생성일',t.crtnDay]].map(([k,v])=>`<div class="info"><span>${k}</span><b>${esc(fmt(v))}</b></div>`).join('');
}
function renderDongs(){const dongs=[...new Set(titleRows.map(r=>norm(r.dongNm)).filter(Boolean))];$('#dongSelect').innerHTML='<option value="">동 선택</option>'+dongs.map(d=>`<option>${esc(d)}</option>`).join('');$('#dongSelect').value=dongs.includes(dong)?dong:'';}
function clearUnit(){detail=null;$('#unitDetail').innerHTML='<div class="empty-detail">면적 미조회 · 호를 선택해 주세요.</div>';$('#detailPager').innerHTML='';}
async function chooseDong(value){dong=norm(value);clearUnit();$('#unitCount').textContent='호 목록 미확정 · 선택 동의 한 페이지를 조회합니다.';$('#unitList').innerHTML='';$('#unitsPager').innerHTML='';$('#hoInput').value='';$('#dongInput').value=dong;await load('areas',1,{scope:'dong',dongNm:dong});status(`${dong} 호 목록 첫 페이지 수신 · 전체 단지 스캔 없음`);}
$('#dongSelect').onchange=e=>{const d=e.target.value;if(d)task('선택 동의 호 목록 한 페이지 조회',()=>chooseDong(d));};
$('#dongForm').onsubmit=e=>{e.preventDefault();task('입력한 동의 호 목록 조회',()=>chooseDong($('#dongInput').value));};
function renderUnits(j,extra){
 const units=[...new Map(j.items.filter(r=>norm(r.hoNm)).map(r=>[norm(r.hoNm),r])).values()];
 $('#unitCount').textContent=pageText(j)+` · 현재 페이지 고유 호 ${units.length}개 · 한 호가 여러 페이지에 나뉠 수 있습니다.`;
 $('#unitList').innerHTML=units.length?units.map((r,i)=>`<button data-ho="${i}">${esc(r.hoNm)}<small>${esc(r.flrNoNm||r.flrNo||'층 미기재')}</small></button>`).join(''):'<p>현재 페이지에 호명 자료가 없습니다. 실제 동·호명 표기나 직접 호 입력을 확인하세요.</p>';
 $('#unitList').querySelectorAll('button').forEach(b=>b.onclick=()=>task('선택 호의 면적 조회',()=>loadDetail(norm(units[Number(b.dataset.ho)].hoNm))));pager('#unitsPager',j,p=>load('areas',p,extra));
}
$('#unitForm').onsubmit=e=>{e.preventDefault();task('입력한 호의 면적 조회',async()=>{dong=norm($('#dongInput').value||$('#dongSelect').value);await loadDetail(norm($('#hoInput').value));});};
async function loadDetail(ho,page=1){
 if(page===1){clearUnit();detail={ho,rows:[],next:1,fingerprints:new Set(),total:null};}
 phase=`${dong||'동명 없음'} ${ho} 면적 · ${page}페이지 조회`;
 const d=detail;if(!d||d.ho!==ho||page!==d.next)throw new Error('호 상세 페이지 순서 불일치');
 const j=await getPage('areas',page,{scope:'unit',dongNm:dong,hoNm:ho});const fingerprint=JSON.stringify(j.items.map(({rnum,...r})=>r));
 if(d.fingerprints.has(fingerprint)&&j.items.length)throw new Error('호 상세의 동일 페이지가 반복되었습니다. 합산하지 않습니다.');
 if(d.total!==null&&j.totalCount!==d.total)throw new Error('호 상세 전체 건수가 변경되었습니다. 다시 호를 선택해 주세요.');
 if(d.rows.length+j.items.length>2000)throw new Error('호 상세 2,000행 안전 한도입니다. 배치 자료 확인이 필요합니다.');
 d.fingerprints.add(fingerprint);d.total=j.totalCount;d.rows.push(...j.items);d.next=page+1;
 const complete=j.totalCount!==null&&d.rows.length===j.totalCount&&!j.hasMore;
 const v=summarize(d.rows,{complete});$('#hoInput').value=ho;
 $('#unitDetail').innerHTML=`<div class="detail-head"><h2>${esc(dong||'동명 없음')} · ${esc(ho)}</h2><span class="badge">${esc(v.state)}</span></div><div class="area-grid">${[['전유면적',v.exclusive],['공용 합계',v.common],['주거공용','구분 불가'],['공급면적','미산출'],['계약면적','미산출']].map(([k,n])=>`<div class="area-item"><label>${k}</label><strong>${esc(n===null?'—':fmt(n))}</strong><small>${typeof n==='number'?n===0?'0 ㎡ · 원본 0 포함':'㎡':'확정 자료 없음'}</small></div>`).join('')}</div><div class="detail-meta"><p>${esc(v.note)}</p><p>수신 ${d.rows.length} / 전체 ${j.totalCount??'미제공'}행 · 원본 0 ${v.zeroCount}행 · 관리번호 ${esc(v.ids.join(', ')||'미기재')}</p><details><summary>면적 원본 확인</summary><div class="table-wrap"><table id="areaRows"></table></div></details></div>`;
 table('#areaRows',[['동','dongNm'],['호','hoNm'],['층','flrNoNm'],['전유/공용','exposPubuseGbCdNm'],['용도','etcPurps'],['원본 면적 ㎡','area'],['관리번호','mgmBldrgstPk']],d.rows);
 $('#detailPager').innerHTML=j.hasMore?`<button id="detailNext">이 호의 다음 면적 페이지 (최대 2회 호출)</button>`:'';
 $('#detailNext')?.addEventListener('click',()=>task('동일 호의 다음 면적 페이지 조회',()=>loadDetail(ho,d.next)));
 status(`${dong||'동명 없음'} ${ho} · ${v.state}`);
}
$('#loadFloors').onclick=()=>task('층별정보 한 페이지 조회',()=>load('floors'));
function tab(id){document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});for(const n of ['basic','units','floors'])$(`#panel-${n}`).hidden=n!==id;}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(!busy)tab(b.dataset.tab);});
$('#diagnostics').onclick=()=>{const report={version:'5.0',observedAt:new Date().toISOString(),address:resolved?.label,query:resolved?.query,sessionCalls,usage:ledger(),errors,trace,pages:Object.values(states).map(({items,...r})=>({...r,received:items.length,fingerprint:undefined}))};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ledger-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
api('/api/health').then(j=>{$('#apiState').textContent=j.version==='5.0'?(j.keyConfigured?`연결됨 · 주소키 ${j.jusoConfigured?'설정':'미설정'}`:'공공데이터 키 미설정'):'Worker 5.0 배포 필요';}).catch(e=>{$('#apiState').textContent='연결 확인 필요';status(e.message,true);});
