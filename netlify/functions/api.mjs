import fs from "node:fs";
import path from "node:path";

const CATEGORIES = ["관광지", "문화시설", "축제공연행사", "여행코스", "레포츠", "숙박", "쇼핑"];
const CATEGORY_HINTS = {
  관광: "관광지", 명소: "관광지", 공원: "관광지", 박물관: "문화시설", 미술관: "문화시설",
  전시: "문화시설", 문화: "문화시설", 공연: "축제공연행사", 축제: "축제공연행사",
  코스: "여행코스", 산책: "여행코스", 데이트: "여행코스", 레포츠: "레포츠",
  체험: "레포츠", 숙소: "숙박", 호텔: "숙박", 숙박: "숙박", 쇼핑: "쇼핑", 시장: "쇼핑"
};
const FIELD_LABELS = {
  contentid: "콘텐츠 고유 ID", contenttypeid: "콘텐츠 유형 ID", title: "장소명", addr1: "주소",
  addr2: "상세 주소", zipcode: "우편번호", tel: "전화번호", mapx: "경도(WGS84)", mapy: "위도(WGS84)",
  firstimage: "대표 이미지 URL", firstimage2: "썸네일 이미지 URL", createdtime: "최초 등록 시각", modifiedtime: "최종 수정 시각"
};

let cache;
function dataDirectory() {
  const candidates = [
    path.join(process.cwd(), "data"),
    path.join(process.env.LAMBDA_TASK_ROOT || "", "data"),
    path.join("/var/task", "data")
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}
function formatTime(value) {
  const text = String(value || "");
  return /^\d{14}$/.test(text) ? `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)} ${text.slice(8,10)}:${text.slice(10,12)}:${text.slice(12)}` : text;
}
function loadStore() {
  if (cache) return cache;
  const dir = dataDirectory();
  if (!dir) throw new Error("배포된 관광 데이터 폴더를 찾을 수 없습니다.");
  const items = [];
  for (const filename of fs.readdirSync(dir).filter(name => name.endsWith(".json")).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8"));
    for (const source of payload.items || []) {
      const raw = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value ?? ""]));
      const addr1 = String(raw.addr1 || "");
      const match = addr1.match(/서울특별시\s+([^\s]+구)/);
      const longitude = Number.parseFloat(raw.mapx);
      const latitude = Number.parseFloat(raw.mapy);
      const item = {
        ...raw, contentid: String(raw.contentid || ""), region: payload.region || "서울",
        contentType: payload.contentType || "", district: match?.[1] || "주소 미제공",
        fullAddress: [raw.addr1, raw.addr2].filter(Boolean).join(" "),
        longitude: Number.isFinite(longitude) ? longitude : null,
        latitude: Number.isFinite(latitude) ? latitude : null,
        hasImage: Boolean(String(raw.firstimage || "").trim()), hasPhone: Boolean(String(raw.tel || "").trim()),
        hasCoordinates: Number.isFinite(longitude) && Number.isFinite(latitude),
        createdtimeFormatted: formatTime(raw.createdtime), modifiedtimeFormatted: formatTime(raw.modifiedtime)
      };
      item._search = `${item.contentType} ${item.district} ${Object.values(raw).join(" ")}`.toLowerCase();
      items.push(item);
    }
  }
  items.sort((a, b) => String(a.title).localeCompare(String(b.title), "ko"));
  cache = {items, byId: new Map(items.map(item => [item.contentid, item]))};
  return cache;
}
function publicItem(item, raw = false) {
  if (!item) return null;
  const result = {...item};
  delete result._search;
  if (!raw) for (const key of ["cat1","cat2","cat3","lclsSystm1","lclsSystm2","lclsSystm3","lDongRegnCd","lDongSignguCd"]) delete result[key];
  return result;
}
function response(statusCode, body) {
  return {statusCode, headers: {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"}, body: JSON.stringify(body)};
}
function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10); return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}
function filterItems(params) {
  const {items} = loadStore();
  const q = String(params.get("q") || "").trim().toLowerCase();
  const category = params.get("category") || "전체";
  const district = params.get("district") || "전체";
  const completeness = params.get("completeness") || "전체";
  return items.filter(item =>
    (category === "전체" || item.contentType === category) && (district === "전체" || item.district === district) &&
    (!q || item._search.includes(q)) && (completeness !== "이미지 있음" || item.hasImage) &&
    (completeness !== "좌표 있음" || item.hasCoordinates) && (completeness !== "전화번호 있음" || item.hasPhone));
}
function stats() {
  const {items} = loadStore();
  const count = key => Object.entries(items.reduce((acc, item) => ((acc[item[key]] = (acc[item[key]] || 0) + 1), acc), {}));
  return {
    total: items.length, withImage: items.filter(x => x.hasImage).length, withCoordinates: items.filter(x => x.hasCoordinates).length,
    withPhone: items.filter(x => x.hasPhone).length,
    categories: CATEGORIES.map(name => ({name, count: items.filter(x => x.contentType === name).length})),
    districts: count("district").sort((a,b) => b[1]-a[1]).map(([name,count]) => ({name,count})), fieldLabels: FIELD_LABELS,
    source: {provider:"한국관광공사", dataset:"국문 관광정보 서비스(TourAPI 4.0)", license:"공공누리 제3유형", loadedTypes:7}
  };
}
function intent(message) {
  const {items} = loadStore(); const lowered = message.toLowerCase();
  return {
    districts: [...new Set(items.map(x=>x.district))].filter(x => x !== "주소 미제공" && message.includes(x)),
    categories: new Set(Object.entries(CATEGORY_HINTS).filter(([hint])=>lowered.includes(hint)).map(([,cat])=>cat)),
    indoor: ["실내","비 오는","비오는","우천","더울","추울","미세먼지"].some(x=>lowered.includes(x)),
    outdoor: ["야외","산책","공원","걷기","자연"].some(x=>lowered.includes(x)),
    parent: ["부모님","어르신","걷기 힘","많이 안 걷","휠체어"].some(x=>lowered.includes(x)),
    family: ["아이","아기","어린이","가족"].some(x=>lowered.includes(x))
  };
}
function recommend(message, limit=3) {
  const {items} = loadStore(); const it = intent(message);
  const words = (message.toLowerCase().match(/[0-9a-z가-힣]+/g)||[]).filter(x=>x.length>1 && !["추천","알려줘","서울","여행","해줘"].includes(x));
  return items.map(item => {
    let score = words.reduce((sum,word)=>sum+(String(item.title).toLowerCase().includes(word)?7:item._search.includes(word)?2:0),0);
    if(it.categories.size) score += it.categories.has(item.contentType)?9:-3;
    if(it.districts.length) score += it.districts.includes(item.district)?12:-8;
    if(it.indoor) score += ["문화시설","쇼핑","숙박"].includes(item.contentType)?7:-2;
    if(it.outdoor) score += ["관광지","여행코스","레포츠"].includes(item.contentType)?6:0;
    if(it.family && ["어린이","키즈","가족","체험","과학"].some(x=>item._search.includes(x))) score += 5;
    if(item.hasCoordinates) score += .2; if(item.hasImage) score += .1;
    return [score,item];
  }).sort((a,b)=>b[0]-a[0] || String(a[1].title).localeCompare(String(b[1].title),"ko")).slice(0,limit).map(x=>x[1]);
}
function chat(message, history=[]) {
  const previous = history.filter(x=>x.role==="user").slice(-1).map(x=>x.content); const combined=[...previous,message].join(" ");
  const it=intent(combined), choices=recommend(combined), conditions=[...it.districts,...it.categories];
  if(it.indoor) conditions.push("실내 중심"); if(it.parent) conditions.push("부모님 이동 부담 고려"); if(it.family) conditions.push("가족 동행");
  const lines=[`말씀하신 조건(${conditions.join(", ")||"서울 관광"})에 맞춰 LocalHub 원본 데이터에서 골랐어요.`];
  choices.forEach((item,index)=>lines.push(`${index+1}. ${item.title} — ${item.district}의 ${item.contentType}. 주소: ${item.fullAddress||"정보 미제공"} [장소ID:${item.contentid}]`));
  if(it.parent) lines.push("무장애 출입·엘리베이터·휴식 공간은 방문 전에 전화로 확인해 주세요.");
  lines.push("운영시간·휴무일·요금은 제공 데이터에 없어 방문 전 확인이 필요합니다.");
  return {answer:lines.join("\n\n"), model:"netlify-rules-v1", places:choices.map(x=>({contentid:x.contentid,"이름":x.title,"유형":x.contentType,"자치구":x.district,"주소":x.fullAddress,"전화":x.tel}))};
}

function grid(latitude, longitude) {
  const rad=Math.PI/180, re=6371.00877/5, sl1=30*rad, sl2=60*rad, olon=126*rad, olat=38*rad;
  const sn=Math.log(Math.cos(sl1)/Math.cos(sl2))/Math.log(Math.tan(Math.PI/4+sl2/2)/Math.tan(Math.PI/4+sl1/2));
  const sf=Math.pow(Math.tan(Math.PI/4+sl1/2),sn)*Math.cos(sl1)/sn;
  const ro=re*sf/Math.pow(Math.tan(Math.PI/4+olat/2),sn), ra=re*sf/Math.pow(Math.tan(Math.PI/4+latitude*rad/2),sn);
  let theta=longitude*rad-olon; if(theta>Math.PI)theta-=2*Math.PI; if(theta< -Math.PI)theta+=2*Math.PI; theta*=sn;
  return {nx:Math.floor(ra*Math.sin(theta)+43+.5),ny:Math.floor(ro-ra*Math.cos(theta)+136+.5)};
}
function kstParts(offsetHours=0, minute=0) {
  const date=new Date(Date.now()+9*3600000+offsetHours*3600000);
  const p=n=>String(n).padStart(2,"0");
  return {date:`${date.getUTCFullYear()}${p(date.getUTCMonth()+1)}${p(date.getUTCDate())}`,time:`${p(date.getUTCHours())}${p(minute)}`};
}
async function kmaCall(kind, nx, ny) {
  const now=new Date(Date.now()+9*3600000), currentMinute=now.getUTCMinutes(), candidates=[];
  const startOffset=currentMinute>=45?0:-1, minute=kind==="current"?0:30;
  for(let i=0;i<4;i++) candidates.push(kstParts(startOffset-i,minute));
  const endpoint=kind==="current"?"getUltraSrtNcst":"getUltraSrtFcst";
  const errors=[];
  for(const base of candidates) {
    const params=new URLSearchParams({serviceKey:decodeURIComponent(process.env.KMA_SERVICE_KEY||""),pageNo:"1",numOfRows:"1000",dataType:"JSON",base_date:base.date,base_time:base.time,nx:String(nx),ny:String(ny)});
    try {
      const res=await fetch(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${endpoint}?${params}`,{headers:{Accept:"application/json"}});
      const payload=await res.json(), header=payload?.response?.header;
      if(!res.ok || String(header?.resultCode)!=="00") throw new Error(header?.resultMsg||`HTTP ${res.status}`);
      const values=payload?.response?.body?.items?.item;
      if(Array.isArray(values)&&values.length) return {values,base};
    } catch(error) { errors.push(error.message); }
  }
  throw new Error(`기상청 데이터 조회 실패: ${errors.slice(-2).join(" / ")}`);
}
const PTY={"0":"강수 없음","1":"비","2":"비 또는 눈","3":"눈","5":"빗방울","6":"빗방울 또는 눈날림","7":"눈날림"};
const SKY={"1":"맑음","3":"구름 많음","4":"흐림"};
const num=value=>value==null||value===""?null:Number(value);
const wind=value=>value==null?"정보 없음":["북","북동","동","남동","남","남서","서","북서"][Math.floor((Number(value)+22.5)/45)%8];
async function weather(latitude,longitude) {
  if(!process.env.KMA_SERVICE_KEY) throw new Error("Netlify 환경변수 KMA_SERVICE_KEY를 설정해 주세요.");
  const {nx,ny}=grid(latitude,longitude), currentResult=await kmaCall("current",nx,ny);
  const values=Object.fromEntries(currentResult.values.map(x=>[String(x.category),x.obsrValue]));
  const current={temperature:num(values.T1H),humidity:num(values.REH),rain1h:num(values.RN1),precipitationTypeCode:String(values.PTY||"0"),description:PTY[String(values.PTY||"0")]||"날씨 정보",windSpeed:num(values.WSD),windDirection:num(values.VEC),windDirectionLabel:wind(values.VEC),rawCategories:values};
  let forecasts=[], forecastError=null;
  try {
    const forecastResult=await kmaCall("forecast",nx,ny), grouped={};
    for(const row of forecastResult.values){const key=`${row.fcstDate}-${row.fcstTime}`;(grouped[key]??={date:String(row.fcstDate),time:String(row.fcstTime),values:{}}).values[String(row.category)]=row.fcstValue;}
    forecasts=Object.values(grouped).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,8).map(row=>{const pty=String(row.values.PTY||"0");return{date:row.date,time:row.time,displayTime:`${row.time.slice(0,2)}:${row.time.slice(2)}`,temperature:num(row.values.T1H),humidity:num(row.values.REH),rain1h:num(row.values.RN1),precipitationTypeCode:pty,skyCode:String(row.values.SKY||""),description:pty!=="0"?(PTY[pty]||"강수"):(SKY[String(row.values.SKY)]||"날씨 정보"),windSpeed:num(row.values.WSD),windDirection:num(row.values.VEC),windDirectionLabel:wind(row.values.VEC)};});
  } catch(error){forecastError=error.message;}
  let advice="외출 전 기온과 이동 거리를 확인하고 중간중간 쉬어가세요.";
  if(current.precipitationTypeCode!=="0"||(current.rain1h||0)>0) advice="비나 눈이 관측됩니다. 미끄럽지 않은 신발과 우산을 준비하세요.";
  else if(current.temperature>=30) advice="매우 덥습니다. 물을 자주 마시고 그늘에서 충분히 쉬세요.";
  else if(current.temperature<=5) advice="기온이 낮습니다. 보온이 잘 되는 겉옷을 준비하세요.";
  return {source:"기상청 단기예보 조회서비스",isLive:true,observedAt:`${currentResult.base.date} ${currentResult.base.time}`,grid:{nx,ny},current,forecast:forecasts,forecastError,advice};
}

export async function handler(event) {
  try {
    const suffix = event.path.replace(/^.*\/api\/?/, ""); const url = new URL(event.rawUrl || `https://local.invalid/?${event.rawQuery||""}`);
    if (event.httpMethod === "POST" && suffix === "chat") {
      const body=JSON.parse(event.body||"{}"); const message=String(body.message||"").trim();
      if(!message || message.length>1000) return response(400,{error:"질문은 1~1,000자로 입력해 주세요."});
      return response(200,chat(message,Array.isArray(body.history)?body.history:[]));
    }
    if(event.httpMethod!=="GET") return response(405,{error:"지원하지 않는 요청입니다."});
    if(suffix==="health") return response(200,{status:"ok",loadedItems:loadStore().items.length,weatherConfigured:Boolean(process.env.KMA_SERVICE_KEY),chatConfigured:true,chatMode:"free-rules-netlify"});
    if(suffix==="stats") return response(200,stats());
    if(suffix==="search") {
      let rows=filterItems(url.searchParams); const sort=url.searchParams.get("sort")||"title";
      if(sort==="modified_desc") rows.sort((a,b)=>String(b.modifiedtime).localeCompare(String(a.modifiedtime)));
      else if(sort==="created_desc") rows.sort((a,b)=>String(b.createdtime).localeCompare(String(a.createdtime)));
      else if(sort==="category") rows.sort((a,b)=>CATEGORIES.indexOf(a.contentType)-CATEGORIES.indexOf(b.contentType));
      const page=integer(url.searchParams.get("page"),1,1,100000), pageSize=integer(url.searchParams.get("pageSize"),24,1,60), total=rows.length;
      return response(200,{total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize)),items:rows.slice((page-1)*pageSize,page*pageSize).map(x=>publicItem(x))});
    }
    if(suffix==="map") { const limit=integer(url.searchParams.get("limit"),300,1,500); const points=filterItems(url.searchParams).filter(x=>x.hasCoordinates).slice(0,limit).map(x=>({contentid:x.contentid,title:x.title,contentType:x.contentType,district:x.district,address:x.fullAddress,latitude:x.latitude,longitude:x.longitude,firstimage2:x.firstimage2})); return response(200,{totalShown:points.length,limit,points}); }
    if(suffix==="bookmarks") { const ids=(url.searchParams.get("ids")||"").split(",").slice(0,200); return response(200,{items:ids.map(id=>publicItem(loadStore().byId.get(id))).filter(Boolean)}); }
    if(suffix.startsWith("items/")) { const item=publicItem(loadStore().byId.get(decodeURIComponent(suffix.slice(6))),true); return item?response(200,item):response(404,{error:"장소를 찾을 수 없습니다."}); }
    if(suffix==="weather/status") return response(200,{configured:Boolean(process.env.KMA_SERVICE_KEY),provider:"기상청",mode:"Netlify 환경변수 KMA_SERVICE_KEY 사용"});
    if(suffix==="weather") { const latitude=Number(url.searchParams.get("lat")),longitude=Number(url.searchParams.get("lon")); if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return response(400,{error:"유효한 lat, lon 좌표가 필요합니다."}); return response(200,await weather(latitude,longitude)); }
    return response(404,{error:"API 경로를 찾을 수 없습니다."});
  } catch(error) { console.error(error); return response(500,{error:`서버 오류: ${error.message}`}); }
}
