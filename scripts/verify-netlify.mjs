import { handler } from "../netlify/functions/api.mjs";

async function call(path, method = "GET", payload) {
  return handler({
    path: path.split("?")[0],
    httpMethod: method,
    body: payload ? JSON.stringify(payload) : "",
    rawUrl: `https://localhub-check.netlify.app${path}`,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const healthResponse = await call("/api/health");
const health = JSON.parse(healthResponse.body);
assert(healthResponse.statusCode === 200, "health API failed");
assert(health.loadedItems === 6518, `expected 6518 items, got ${health.loadedItems}`);

const searchResponse = await call(
  "/api/search?category=%EB%AC%B8%ED%99%94%EC%8B%9C%EC%84%A4&district=%EC%A2%85%EB%A1%9C%EA%B5%AC&pageSize=3",
);
const search = JSON.parse(searchResponse.body);
assert(searchResponse.statusCode === 200 && search.items.length === 3, "search API failed");
assert(search.items.every(item => item.contentType === "문화시설" && item.district === "종로구"), "search filter mismatch");

const contentId = search.items[0].contentid;
const detailResponse = await call(`/api/items/${contentId}`);
const detail = JSON.parse(detailResponse.body);
assert(detailResponse.statusCode === 200 && detail.contentid === contentId, "detail API failed");

const mapResponse = await call("/api/map?district=%EC%A2%85%EB%A1%9C%EA%B5%AC&limit=20");
const map = JSON.parse(mapResponse.body);
assert(mapResponse.statusCode === 200 && map.points.length === 20, "map API failed");

const bookmarkResponse = await call(`/api/bookmarks?ids=${contentId}`);
const bookmarks = JSON.parse(bookmarkResponse.body);
assert(bookmarkResponse.statusCode === 200 && bookmarks.items.length === 1, "bookmark API failed");

const chatResponse = await call("/api/chat", "POST", {
  message: "부모님과 종로구 문화시설 추천",
  history: [],
});
const chat = JSON.parse(chatResponse.body);
assert(chatResponse.statusCode === 200, "chat API failed");
assert(typeof chat.answer === "string" && chat.answer.length > 20, "chat answer missing");
assert(["guided", "openai"].includes(chat.mode) && chat.places.length === 3, "chat result mismatch");

console.log("PASS: Netlify API preflight");
console.log(`PASS: tourism items ${health.loadedItems}`);
console.log(`PASS: search results ${search.items.length}`);
console.log(`PASS: detail ${detail.title}`);
console.log(`PASS: map points ${map.points.length}`);
console.log(`PASS: bookmarks ${bookmarks.items.length}`);
console.log(`PASS: smart chat recommendations ${chat.places.length}`);

