const CFG=window.BUILDING_LEDGER_CONFIG||{};
const $=s=>document.querySelector(s);
let DATA={titles:[],floors:[],units:[]};
let CURRENT_QUERY=null;

function setStatus(msg,type=""){
 const e=$("#status");
 e.textContent=msg;
 e.className="status "+type;
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function fmt(v,d=2){if(v===null||v===undefined||v==="")return "-";const x=Number(v);return Number.isFinite(x)?x.toLocaleString("ko-KR",{maximumFractionDigits:d}):String(v)}
function py(v){return v?fmt(n(v)/3.305785,2):"-"}
function date8(v){v=String(v||"");return /^\d{8}$/.test(v)?`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`:(v||"-")}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function worker(){return (CFG.WORKER_URL||"").replace(/\/$/,"")}
function displayLot(v){const x=Number(v||0);return Number.isFinite(x)?String(x):String(v||"")}
function clearResults(){
 DATA={titles:[],floors:[],units:[]};
 CURRENT_QUERY=null;
 $("#resultArea").classList.add("hidden");
 $("#summaryCards").innerHTML="";
 $("#basicInfo").innerHTML="";
 $("#titlesTable").innerHTML="";
 $("#floorsTable").innerHTML="";
 $("#unitsTable").innerHTML="";
 $("#resolvedAddress").textContent="-";
 $("#queryCodes").innerHTML="";
 $("#buildingTitle").textContent="";
 $("#unitNotice").textContent="";
}

async function api(path, opts={}){
 if(!worker()||worker().includes("YOUR-WORKER"))throw new Error("config.js에 Cloudflare Worker 주소를 입력하세요.");
 const r=await fetch(worker()+path,{headers:{"Content-Type":"application/json"},...opts});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
 return j;
}

async function health(){
 const e=$("#apiState");
 try{
   const j=await api("/api/health");
   e.innerHTML="<span></span>"+(j.keyConfigured?"연결됨":"API 키 미설정");
   e.className="api-state "+(j.keyConfigured?"connected":"error");
 }catch{
   e.innerHTML="<span></span>연결 안 됨";
   e.className="api-state error";
 }
}
health();

async function searchAddress(){
 const address=$("#address").value.trim();
 if(!address)return setStatus("주소를 입력하세요.","error");

 // 새 조회를 시작하는 순간 이전 결과를 지웁니다.
 clearResults();
 setStatus("조회 중입니다.");
 const btn=$("#searchAddress");
 btn.disabled=true;
 btn.classList.add("loading");

 try{
   const j=await api("/api/address-search",{method:"POST",body:JSON.stringify({address})});
   await runQuery(j.query, j.resolvedAddress||address);
 }catch(e){
   setStatus(e.message,"error");
 }finally{
   btn.disabled=false;
   btn.classList.remove("loading");
 }
}
$("#searchAddress").onclick=searchAddress;
$("#address").addEventListener("keydown",e=>{
 if(e.key==="Enter")searchAddress();
});

async function runQuery(q,label){
 CURRENT_QUERY=q;
 setStatus("건축물대장 정보를 불러오고 있습니다.");
 try{
  const j=await api("/api/building",{method:"POST",body:JSON.stringify(q)});
  DATA=j;
  render(j,label,q);
  $("#resultArea").classList.remove("hidden");
  setStatus(`조회 완료 · 표제부 ${j.titles.length}건 / 층별 ${j.floors.length}건 / 호별 ${j.units.length}건`,"ok");
 }catch(e){
  setStatus(e.message,"error");
  throw e;
 }
}

function renderQueryCodes(q){
 if(!q)return;
 const items=[
  ["시군구코드",q.sigunguCd||"-"],
  ["법정동코드",q.bjdongCd||"-"],
  ["본번",displayLot(q.bun)||"0"],
  ["부번",displayLot(q.ji)||"0"]
 ];
 $("#queryCodes").innerHTML=items.map(([a,b])=>`<span>${a}<b>${esc(b)}</b></span>`).join("");
}

function render(d,label,q){
 const t=d.titles[0]||d.recap[0]||{};
 const shownAddress=t.newPlatPlc||t.platPlc||label||"-";
 $("#resolvedAddress").textContent=shownAddress;
 renderQueryCodes(q);

 $("#buildingTitle").textContent=t.bldNm||t.platPlc||t.newPlatPlc||"";
 const park=n(t.totPkngCnt)||n(t.indrAutoUtcnt)+n(t.oudrAutoUtcnt)+n(t.indrMechUtcnt)+n(t.oudrMechUtcnt);

 $("#summaryCards").innerHTML=[
  ["주용도",t.mainPurpsCdNm||t.etcPurps||"-"],
  ["연면적",t.totArea?fmt(t.totArea)+"㎡":"-"],
  ["지상 / 지하",`${t.grndFlrCnt||"-"} / ${t.ugrndFlrCnt||"-"}층`],
  ["사용승인일",date8(t.useAprDay)],
  ["주차",park?fmt(park,0)+"대":"-"]
 ].map(([a,b])=>`<div class="metric"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join("");

 const infos=[
  ["건물명",t.bldNm],["동명",t.dongNm],["대지위치",t.platPlc],["도로명주소",t.newPlatPlc],
  ["주용도",t.mainPurpsCdNm],["기타용도",t.etcPurps],["구조",t.strctCdNm||t.etcStrct],["지붕",t.roofCdNm||t.etcRoof],
  ["대지면적",t.platArea&&fmt(t.platArea)+"㎡"],["건축면적",t.archArea&&fmt(t.archArea)+"㎡"],["연면적",t.totArea&&fmt(t.totArea)+"㎡"],["용적률산정연면적",t.vlRatEstmTotArea&&fmt(t.vlRatEstmTotArea)+"㎡"],
  ["건폐율",t.bcRat&&fmt(t.bcRat)+"%"],["용적률",t.vlRat&&fmt(t.vlRat)+"%"],["높이",t.heit&&fmt(t.heit)+"m"],["세대 / 가구",`${t.hhldCnt||0} / ${t.fmlyCnt||0}`],
  ["승강기",`${n(t.rideUseElvtCnt)}대`],["비상용승강기",`${n(t.emgenUseElvtCnt)}대`],["주차",park?fmt(park,0)+"대":"-"],["사용승인일",date8(t.useAprDay)]
 ];
 $("#basicInfo").innerHTML=infos.map(([a,b])=>`<div class="info"><span>${esc(a)}</span><b>${esc(b||"-")}</b></div>`).join("");

 table("#titlesTable",[
  ["동","dongNm"],["건물명","bldNm"],["주용도","mainPurpsCdNm"],["구조","strctCdNm"],["지상층","grndFlrCnt"],["지하층","ugrndFlrCnt"],["연면적㎡","totArea"],["연면적(평)",x=>py(x.totArea)],["사용승인일",x=>date8(x.useAprDay)]
 ],d.titles);

 table("#floorsTable",[
  ["동","dongNm"],["층","flrNoNm"],["용도",x=>x.etcPurps||x.mainPurpsCdNm],["구조",x=>x.etcStrct||x.strctCdNm],["면적㎡","area"],["면적(평)",x=>py(x.area)],["주/부속","mainAtchGbCdNm"]
 ],d.floors);

 table("#unitsTable",[
  ["동","dongNm"],["호","hoNm"],["층","flrNoNm"],["용도","purpose"],["전유㎡","exclusiveArea"],["전유(평)",x=>py(x.exclusiveArea)],
  ["주거공용㎡","residentialCommonArea"],["기타공용㎡","otherCommonArea"],["공급면적㎡","supplyArea"],["계약면적㎡","contractArea"]
 ],d.units);

 $("#unitNotice").textContent=d.units.length
  ?"공용면적 구분은 건축물대장에 기재된 용도 기준입니다."
  :"호별 전유·공용면적 데이터가 없는 건축물입니다.";
}

function table(sel,cols,rows){
 const e=$(sel);
 e.innerHTML="<thead><tr>"+cols.map(c=>`<th>${esc(c[0])}</th>`).join("")+"</tr></thead><tbody>"+
 rows.map(r=>"<tr>"+cols.map(([_,k])=>{
   let v=typeof k==="function"?k(r):r[k];
   return `<td>${esc(v??"-")}</td>`;
 }).join("")+"</tr>").join("")+"</tbody>";
}

function filterTable(input,tableSel){
 $(input).addEventListener("input",e=>{
  const q=e.target.value.toLowerCase();
  $(tableSel).querySelectorAll("tbody tr").forEach(tr=>{
   tr.style.display=tr.textContent.toLowerCase().includes(q)?"":"none";
  });
 });
}
filterTable("#floorFilter","#floorsTable");
filterTable("#unitFilter","#unitsTable");

document.querySelectorAll("[data-csv]").forEach(b=>b.onclick=()=>{
 const key=b.dataset.csv, rows=DATA[key]||[];
 if(!rows.length)return alert("저장할 데이터가 없습니다.");
 let cols;
 if(key==="units") cols=["dongNm","hoNm","flrNoNm","purpose","exclusiveArea","residentialCommonArea","otherCommonArea","supplyArea","contractArea"];
 else if(key==="floors") cols=["dongNm","flrNoNm","etcPurps","mainPurpsCdNm","area","strctCdNm","mainAtchGbCdNm"];
 else cols=["dongNm","bldNm","mainPurpsCdNm","strctCdNm","grndFlrCnt","ugrndFlrCnt","totArea","useAprDay"];
 const csv="\ufeff"+[cols.join(","),...rows.map(r=>cols.map(c=>`"${String(r[c]??"").replace(/"/g,'""')}"`).join(","))].join("\n");
 const a=document.createElement("a");
 a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 a.download=`building-${key}.csv`;
 a.click();
 URL.revokeObjectURL(a.href);
});
