// 5단계 [데이터팀] 반려 대상 — **채점**
// 규칙 순서: ①사내통계면 무조건 승인 → ②개인정보+팀장급 승인이면 반려 → ③조회 90일 "초과" 반려
//            → ④보관 180일 "이상" 반려 → ⑤그 외 승인
// 정답 187건. 흔한 오답: 사내통계 예외 무시 234건 /
// 보관을 "초과"로 오해 180건 / 조회를 "이상"으로 오해 193건 /
// 승인자 직급 무시 180건.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

const EXPECTED = ["REQ-2001","REQ-2002","REQ-2003","REQ-2004","REQ-2005","REQ-2006","REQ-2008","REQ-2011","REQ-2012","REQ-2015","REQ-2016","REQ-2020","REQ-2021","REQ-2022","REQ-2023","REQ-2025","REQ-2026","REQ-2027","REQ-2030","REQ-2031","REQ-2034","REQ-2035","REQ-2036","REQ-2037","REQ-2041","REQ-2042","REQ-2043","REQ-2046","REQ-2047","REQ-2049","REQ-2051","REQ-2052","REQ-2054","REQ-2059","REQ-2060","REQ-2061","REQ-2062","REQ-2063","REQ-2064","REQ-2067","REQ-2068","REQ-2069","REQ-2071","REQ-2073","REQ-2076","REQ-2077","REQ-2079","REQ-2080","REQ-2082","REQ-2084","REQ-2085","REQ-2087","REQ-2088","REQ-2089","REQ-2090","REQ-2091","REQ-2092","REQ-2093","REQ-2095","REQ-2096","REQ-2097","REQ-2098","REQ-2099","REQ-2100","REQ-2101","REQ-2102","REQ-2104","REQ-2105","REQ-2106","REQ-2108","REQ-2109","REQ-2113","REQ-2116","REQ-2117","REQ-2118","REQ-2119","REQ-2120","REQ-2121","REQ-2122","REQ-2123","REQ-2124","REQ-2125","REQ-2127","REQ-2130","REQ-2132","REQ-2134","REQ-2136","REQ-2138","REQ-2139","REQ-2142","REQ-2143","REQ-2144","REQ-2145","REQ-2147","REQ-2149","REQ-2151","REQ-2152","REQ-2156","REQ-2157","REQ-2158","REQ-2159","REQ-2160","REQ-2161","REQ-2162","REQ-2163","REQ-2164","REQ-2165","REQ-2166","REQ-2167","REQ-2168","REQ-2169","REQ-2170","REQ-2171","REQ-2173","REQ-2174","REQ-2179","REQ-2180","REQ-2182","REQ-2183","REQ-2184","REQ-2186","REQ-2189","REQ-2190","REQ-2192","REQ-2194","REQ-2195","REQ-2197","REQ-2198","REQ-2200","REQ-2202","REQ-2204","REQ-2206","REQ-2208","REQ-2209","REQ-2210","REQ-2212","REQ-2213","REQ-2214","REQ-2215","REQ-2217","REQ-2218","REQ-2219","REQ-2220","REQ-2221","REQ-2222","REQ-2223","REQ-2224","REQ-2225","REQ-2226","REQ-2227","REQ-2230","REQ-2232","REQ-2233","REQ-2234","REQ-2235","REQ-2236","REQ-2237","REQ-2238","REQ-2240","REQ-2241","REQ-2242","REQ-2243","REQ-2245","REQ-2250","REQ-2251","REQ-2252","REQ-2253","REQ-2254","REQ-2255","REQ-2256","REQ-2257","REQ-2258","REQ-2259","REQ-2260","REQ-2261","REQ-2263","REQ-2264","REQ-2267","REQ-2268","REQ-2270","REQ-2271","REQ-2272","REQ-2274","REQ-2275","REQ-2276","REQ-2277","REQ-2278"];

test("rejected-requests.json — 반려 대상 신청서 id", () => {
  const r = unwrapSingleKey(readJson("rejected-requests.json"));
  assert.ok(Array.isArray(r), "rejected-requests.json은 배열이어야 한다");
  assert.deepEqual([...r].sort(), [...EXPECTED].sort(), "rejected-requests");
});
