export const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function areaValue(v){if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;}
export function summarize(rows,{complete=false}={}){
 const ids=[...new Set(rows.map(r=>norm(r.mgmBldrgstPk)).filter(Boolean))];
 const groups=[...new Set(rows.map(r=>`${norm(r.dongNm)}|${norm(r.hoNm)}|${norm(r.block)}|${norm(r.lot)}`))];
 const conflict=ids.length>1||groups.length>1;
 let exclusive=null,common=null,unknown=0,invalid=false,zeroCount=0;
 for(const r of rows){const a=areaValue(r.area);if(a===0)zeroCount++;if(a===null){invalid=true;continue;}
  const name=norm(r.exposPubuseGbCdNm);const code=norm(r.exposPubuseGbCd);
  if(name.includes('전유')||code==='1')exclusive=(exclusive??0)+a;
  else if(name.includes('공용')||code==='2')common=(common??0)+a;
  else unknown++;
 }
 const safe=complete&&!conflict&&!invalid&&!unknown;
 const round=n=>n===null?null:Math.round(n*10000)/10000;
 return {exclusive:safe?round(exclusive):null,common:safe?round(common):null,supply:null,contract:null,zeroCount,ids,
  state:conflict?'식별 충돌 · 합산 보류':!complete?'부분 수신 · 합산 미확정':!rows.length?'연결 자료 없음 · 원본 부재/호명 불일치 확인':invalid?'원본 면적 빈 값·비정상 값':unknown?'면적 구분 미상 · 합산 보류':'해당 호 원본 확인',
  note:'주거공용·기타공용 구분은 공식 응답에 없으므로 용도명으로 임의 추정하지 않습니다. 공급·계약면적은 확정할 수 없어 미산출로 표시합니다.'};
}
