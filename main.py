from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
from datetime import datetime

app = FastAPI(title="진드기 CREW API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MEMBERS = [
    {"name": "진호",   "soopId": "jangjh5409"},
    {"name": "뽀끔",   "soopId": "fishstory"},
    {"name": "이루희", "soopId": "mingkymya"},
    {"name": "호냥이", "soopId": "yaya1787"},
    {"name": "오늘님", "soopId": "pqf1234"},
    {"name": "찌미",   "soopId": "zzimio3o"},
    {"name": "히키",   "soopId": "hikicomoring"},
    {"name": "설빈달", "soopId": "nsnowthemoon"},
    {"name": "찰리씨", "soopId": "sircharlee"},
    {"name": "야구자", "soopId": "yaguja00"},
    {"name": "니즈",   "soopId": "neez0611"},
    {"name": "두칠",   "soopId": "hwyjump"},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.sooplive.co.kr/",
    "Origin": "https://www.sooplive.co.kr",
}

# ── SOOP API HELPERS ──

async def fetch_station(client: httpx.AsyncClient, soop_id: str) -> dict:
    """BJ 스테이션 정보 (라이브 여부 포함)"""
    try:
        url = f"https://bjapi.sooplive.co.kr/api/{soop_id}/station"
        r = await client.get(url, headers=HEADERS, timeout=8)
        if r.status_code == 200:
            return r.json().get("data", {})
    except Exception:
        pass
    return {}

async def fetch_posts_api(client: httpx.AsyncClient, soop_id: str, per_page: int = 5) -> list:
    """BJ 게시판 글 목록"""
    try:
        url = f"https://bjapi.sooplive.co.kr/api/{soop_id}/board/post"
        r = await client.get(url, headers=HEADERS, params={"page": 1, "per_page": per_page, "type": "post"}, timeout=8)
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception:
        pass
    return []

def build_live_result(member: dict, station_data: dict) -> dict:
    broad = station_data.get("station", {}).get("broad")
    is_live = broad is not None
    return {
        "name":      member["name"],
        "soopId":    member["soopId"],
        "isLive":    is_live,
        "embedUrl":  f"https://play.sooplive.co.kr/{member['soopId']}/embeded" if is_live else None,
        "title":     broad.get("broad_title", "")         if broad else "",
        "viewers":   broad.get("current_sum_viewer", 0)   if broad else 0,
        "thumbnail": broad.get("broad_img", "")           if broad else "",
        "broadNo":   broad.get("broad_no", "")            if broad else "",
        "upCount":   broad.get("up_count", 0)             if broad else 0,
    }

def build_post_result(member: dict, raw: dict) -> dict:
    return {
        "member":    member["name"],
        "soopId":    member["soopId"],
        "platform":  "soop",
        "postId":    raw.get("title_no", ""),
        "title":     raw.get("title_name", ""),
        "content":   raw.get("contents", ""),
        "date":      raw.get("reg_date", ""),
        "upCount":   raw.get("up_cnt", 0),
        "viewCount": raw.get("read_cnt", 0),
        "url":       f"https://www.sooplive.co.kr/{member['soopId']}/posts/{raw.get('title_no','')}",
    }


# ── ROUTES ──

@app.get("/")
async def root():
    return {"status": "ok", "service": "진드기 CREW API", "version": "1.0", "updatedAt": datetime.now().isoformat()}

@app.get("/api/live")
async def get_all_live():
    """모든 멤버 라이브 상태 (병렬)"""
    async with httpx.AsyncClient() as client:
        stations = await asyncio.gather(*[fetch_station(client, m["soopId"]) for m in MEMBERS])

    results = [build_live_result(m, s) for m, s in zip(MEMBERS, stations)]
    live = [r for r in results if r["isLive"]]

    return {
        "updatedAt": datetime.now().isoformat(),
        "liveCount": len(live),
        "members":   results,
    }

@app.get("/api/live/{soop_id}")
async def get_live(soop_id: str):
    """특정 멤버 라이브 상태"""
    member = next((m for m in MEMBERS if m["soopId"] == soop_id), None)
    if not member:
        return {"error": "member not found", "soopId": soop_id}
    async with httpx.AsyncClient() as client:
        station = await fetch_station(client, soop_id)
    return build_live_result(member, station)

@app.get("/api/posts")
async def get_all_posts(per_page: int = Query(5, ge=1, le=20)):
    """모든 멤버 최신 게시글 (병렬)"""
    async with httpx.AsyncClient() as client:
        raw_lists = await asyncio.gather(*[fetch_posts_api(client, m["soopId"], per_page) for m in MEMBERS])

    all_posts = []
    for member, raw_list in zip(MEMBERS, raw_lists):
        for raw in raw_list:
            all_posts.append(build_post_result(member, raw))

    all_posts.sort(key=lambda x: x.get("date", ""), reverse=True)

    return {
        "updatedAt": datetime.now().isoformat(),
        "total":     len(all_posts),
        "posts":     all_posts[:50],
    }

@app.get("/api/posts/{soop_id}")
async def get_member_posts(soop_id: str, per_page: int = Query(10, ge=1, le=20)):
    """특정 멤버 게시글"""
    member = next((m for m in MEMBERS if m["soopId"] == soop_id), None)
    if not member:
        return {"error": "member not found"}
    async with httpx.AsyncClient() as client:
        raw_list = await fetch_posts_api(client, soop_id, per_page)
    return {
        "member": member["name"],
        "posts":  [build_post_result(member, r) for r in raw_list],
    }

@app.get("/api/members")
async def get_members():
    """멤버 목록"""
    return {"members": MEMBERS}
