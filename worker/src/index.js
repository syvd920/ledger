const BUILDING_BASE="https://apis.data.go.kr/1613000/BldRgstHubService";
const REGION_URL="https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList";
const ALLOWED_ORIGINS = []; // 예: ["https://아이디.github.io"]. 비워두면 모든 Origin 허용.
const PAGE_SIZE=1000, MAX_PAGES=50;

export default {
 async fetch(request, env) {
  const origin=request.headers.get("Origin")||"";
  const cors=makeCors(origin);
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  const url=new URL(request.url);
  try{
   if(url.pathname==="/api/health") return out({ok:true,keyConfigured:!!env.DATA_GO_KR_SERVICE_KEY},200,cors);
   if(!env.DATA_GO_KR_SERVICE_KEY) return out({error:"Cloudflare Worker Secret(DATA_GO_KR_SERVICE_KEY)이 설정되지 않았습니다."},500,cors);
   if(url.pathname==="/api/address-search" && request.method==="POST"){
    const {address}=await request.json(); const parsed=parseJibunAddress(address);
    if(!parsed) return out({error:"법정동+지번 형식으로 입력해 주세요. 예: 서울특별시 강남구 역삼동 123-4"},400,cors);
    const region=await findRegion(env.DATA_GO_KR_SERVICE_KEY,parsed.regionText);
    if(!region) return out({error:`법정동 코드를 찾지 못했습니다: ${parsed.regionText}. '코드로 조회'를 이용해 주세요.`},404,cors);
    const code=String(region.locatjumin_cd||region.region_cd||region.locatjuminCd||"").replace(/\D/g,"");
    if(code.length<10) return out({error:"법정동 코드 응답 형식이 예상과 다릅니다. 코드로 조회를 이용해 주세요."},502,cors);
    return out({resolvedAddress:`${region.locallow_nm||parsed.regionText} ${parsed.san?"산 ":""}${parsed.bun}${parsed.ji?("-"+parsed.ji):""}`,query:{
      sigunguCd:code.slice(0,5),bjdongCd:code.slice(5,10),platGbCd:parsed.san?"1":"0",bun:pad4(parsed.bun),ji:pad4(parsed.ji||0)
    }},200,cors);
   }
   if(url.pathname==="/api/building" && request.method==="POST"){
    const q=await request.json(); validateQuery(q);
    const params={sigunguCd:q.sigunguCd,bjdongCd:q.bjdongCd,platGbCd:q.platGbCd??"0",bun:pad4(q.bun),ji:pad4(q.ji)};
    const [recap,titles,floors,expos,areas]=await Promise.all([
      fetchAll("getBrRecapTitleInfo",params,env.DATA_GO_KR_SERVICE_KEY),
      fetchAll("getBrTitleInfo",params,env.DATA_GO_KR_SERVICE_KEY),
      fetchAll("getBrFlrOulnInfo",params,env.DATA_GO_KR_SERVICE_KEY),
      fetchAll("getBrExposInfo",params,env.DATA_GO_KR_SERVICE_KEY),
      fetchAll("getBrExposPubuseAreaInfo",params,env.DATA_GO_KR_SERVICE_KEY)
    ]);
    const units=buildUnits(expos,areas);
    return out({query:params,recap,titles,floors,units,rawCounts:{expos:expos.length,areas:areas.length}},200,cors);
   }
   return out({error:"Not found"},404,cors);
  }catch(e){return out({error:e.message||"처리 중 오류가 발생했습니다."},500,cors)}
 }
};

function makeCors(origin){
 const allowed=!ALLOWED_ORIGINS.length||ALLOWED_ORIGINS.includes(origin);
 return {"Access-Control-Allow-Origin":allowed?(origin||"*"):"null","Vary":"Origin","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Cache-Control":"no-store"};
}
function out(obj,status,headers){return new Response(JSON.stringify(obj),{status,headers:{...headers,"Content-Type":"application/json; charset=utf-8"}})}
function pad4(v){return String(v||0).replace(/\D/g,"").padStart(4,"0")}
function validateQuery(q){if(!/^\d{5}$/.test(q.sigunguCd||"")||!/^\d{5}$/.test(q.bjdongCd||""))throw new Error("시군구코드/법정동코드는 각각 5자리여야 합니다.")}

async function dataFetch(url,key,params){
 const u=new URL(url);
 u.searchParams.set("serviceKey",key); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));
 const r=await fetch(u.toString()); const txt=await r.text();
 if(!r.ok) throw new Error(`공공데이터 API HTTP ${r.status}`);
 let j; try{j=JSON.parse(txt)}catch{throw new Error("공공데이터 API가 JSON이 아닌 응답을 반환했습니다. 인증키(일반 인증키/디코딩 키)를 확인하세요.")}
 const header=j?.response?.header||j?.StanReginCd?.[0]?.head?.[0]||{};
 const code=header.resultCode||header.result_code;
 if(code && !["00","0","INFO-000"].includes(String(code))) throw new Error(header.resultMsg||header.result_msg||`공공데이터 오류 ${code}`);
 return j;
}
async function fetchAll(endpoint,params,key){
 let all=[]; for(let page=1;page<=MAX_PAGES;page++){
  const j=await dataFetch(`${BUILDING_BASE}/${endpoint}`,key,{...params,_type:"json",numOfRows:PAGE_SIZE,pageNo:page});
  const body=j?.response?.body||{}; let items=body?.items?.item||[];
  if(!Array.isArray(items))items=items?[items]:[]; all.push(...items);
  const total=Number(body.totalCount||0); if(items.length<PAGE_SIZE||all.length>=total)break;
 } return all;
}
async function findRegion(key,regionText){
 const tries=[regionText,regionText.replace(/^서울\s/,"서울특별시 ").replace(/^부산\s/,"부산광역시 ").replace(/^대구\s/,"대구광역시 ").replace(/^인천\s/,"인천광역시 ").replace(/^광주\s/,"광주광역시 ").replace(/^대전\s/,"대전광역시 ").replace(/^울산\s/,"울산광역시 ")];
 for(const q of [...new Set(tries)]){
  const j=await dataFetch(REGION_URL,key,{type:"json",pageNo:1,numOfRows:100,locatadd_nm:q});
  let rows=j?.StanReginCd?.[1]?.row||j?.response?.body?.items?.item||[];
  if(!Array.isArray(rows))rows=rows?[rows]:[];
  const exact=rows.find(x=>(x.locallow_nm||"").trim()===q.trim());
  const active=exact||rows.find(x=>String(x.locatjumin_cd||"").length>=10 && !(x.locallow_nm||"").includes("폐지"));
  if(active)return active;
 } return null;
}
function parseJibunAddress(s){
 s=String(s||"").replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
 const m=s.match(/^(.*?(?:동|가|리))\s+(산\s*)?(\d+)(?:-(\d+))?(?:\s.*)?$/);
 if(!m)return null; return {regionText:m[1].trim(),san:!!m[2],bun:m[3],ji:m[4]||""};
}
function num(v){const x=Number(v);return Number.isFinite(x)?x:0}
function classifyCommon(r){
 const s=[r.etcPurps,r.mainPurpsCdNm,r.mainAtchGbCdNm].filter(Boolean).join(" ");
 if(/주차|기계|전기|관리|경비|창고|펌프|발전|저수|정화|쓰레기|커뮤니티|부대|복리/i.test(s))return "other";
 return "residential";
}
function buildUnits(expos,areas){
 const map=new Map();
 const keyOf=r=>r.mgmBldrgstPk||`${r.dongNm||""}|${r.hoNm||""}|${r.flrNo||r.flrNoNm||""}`;
 for(const r of expos){
  const k=keyOf(r); if(!map.has(k))map.set(k,{dongNm:r.dongNm||"",hoNm:r.hoNm||"",flrNoNm:r.flrNoNm||r.flrNo||"",purpose:r.etcPurps||r.mainPurpsCdNm||"",exclusiveArea:0,residentialCommonArea:0,otherCommonArea:0,supplyArea:0,contractArea:0,_pk:k});
 }
 for(const r of areas){
  const k=keyOf(r); if(!map.has(k))map.set(k,{dongNm:r.dongNm||"",hoNm:r.hoNm||"",flrNoNm:r.flrNoNm||r.flrNo||"",purpose:r.etcPurps||r.mainPurpsCdNm||"",exclusiveArea:0,residentialCommonArea:0,otherCommonArea:0,supplyArea:0,contractArea:0,_pk:k});
  const u=map.get(k), a=num(r.area), g=String(r.exposPubuseGbCdNm||"");
  if(g.includes("전유")){u.exclusiveArea+=a;if(!u.purpose)u.purpose=r.etcPurps||r.mainPurpsCdNm||""}
  else if(g.includes("공용")){if(classifyCommon(r)==="other")u.otherCommonArea+=a;else u.residentialCommonArea+=a}
 }
 for(const u of map.values()){u.exclusiveArea=round(u.exclusiveArea);u.residentialCommonArea=round(u.residentialCommonArea);u.otherCommonArea=round(u.otherCommonArea);u.supplyArea=round(u.exclusiveArea+u.residentialCommonArea);u.contractArea=round(u.supplyArea+u.otherCommonArea)}
 return [...map.values()].filter(x=>x.hoNm||x.exclusiveArea).sort((a,b)=>String(a.dongNm).localeCompare(String(b.dongNm),"ko",{numeric:true})||String(a.hoNm).localeCompare(String(b.hoNm),"ko",{numeric:true}));
}
function round(v){return Math.round(v*10000)/10000}
