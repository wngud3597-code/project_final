const base = String(process.argv[2] || "https://stately-begonia-1aaa4b.netlify.app").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(path, options) {
  const response = await fetch(`${base}${path}`, {...options, headers:{Accept:"application/json",...(options?.headers||{})},cache:"no-store"});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body.error || `HTTP ${response.status}`}`);
  return body;
}

const health = await json("/api/health");
assert(health.status === "ok" && health.loadedItems === 6518, "health or tourism data failed");
assert(health.weatherConfigured === true, "weather key is not configured");

const search = await json("/api/search?category=%EB%AC%B8%ED%99%94%EC%8B%9C%EC%84%A4&district=%EC%A2%85%EB%A1%9C%EA%B5%AC&pageSize=3");
assert(search.items?.length === 3, "search failed");
const item = await json(`/api/items/${encodeURIComponent(search.items[0].contentid)}`);
assert(item.title && item.hasCoordinates, "detail failed");
const map = await json("/api/map?district=%EC%A2%85%EB%A1%9C%EA%B5%AC&limit=20");
assert(map.points?.length === 20, "map failed");
const bookmarks = await json(`/api/bookmarks?ids=${encodeURIComponent(item.contentid)}`);
assert(bookmarks.items?.length === 1, "bookmarks failed");
const comments = await json(`/api/comments?contentid=${encodeURIComponent(item.contentid)}`);
assert(comments.persistence === "netlify-blobs", "community storage failed");
const weather = await json(`/api/weather?lat=${item.latitude}&lon=${item.longitude}`);
assert(weather.isLive && weather.forecast?.length, "live weather failed");
const chat = await json("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"종로구 실내 관광지 추천",history:[]})});
assert(chat.answer && chat.places?.length === 3, "chat failed");

console.log(`PASS: ${base}`);
console.log(`PASS: items=${health.loadedItems}, detail=${item.title}, map=${map.points.length}`);
console.log(`PASS: weather=${weather.current.temperature}C, forecast=${weather.forecast.length}`);
console.log(`PASS: comments=${comments.count}, chat=${chat.mode}`);
