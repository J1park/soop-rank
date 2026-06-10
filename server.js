const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits, Events } = require("discord.js");

const app = express();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || "";

let currentStation = "";
let currentPost = "";

const MEMBERS = [
  "fishstory",
  "sircharlee",
  "yaguja00",
  "jangjh5409",
  "nsnowthemoon",
  "hikicomoring",
  "zzimio3o",
  "mingkymya",
  "pqf1234",
  "yaya1787",
  "hwyjump"
];

function parseSoopUrl(url) {
  if (!url) return null;
  url = url.trim();
  const match = url.match(
    /https?:\/\/(?:www\.)?sooplive\.(?:com|co\.kr)\/station\/([^\/?#]+)\/post\/(\d+)/i
  );
  if (!match) return null;
  return { stationId: match[1], postId: match[2] };
}

async function fetchComments(stationId, postId) {
  let all = [];
  let page = 1;

  while (page <= 100) {
    const apiUrl =
      `https://api-channel.sooplive.com/v1.1/channel/${stationId}/post/${postId}/comment` +
      `?page=${page}&orderBy=reg_date&cCommentNo=0`;

    const res = await axios.get(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Referer": `https://www.sooplive.com/station/${stationId}/post/${postId}`,
        "Origin": "https://www.sooplive.com"
      }
    });

    const list = res.data && res.data.data ? res.data.data : [];
    if (list.length === 0) break;

    all.push(...list);
    if (all.length >= 1000) break;
    page++;
  }

  return all;
}

app.get("/api/rank", async (req, res) => {
  if (!currentStation || !currentPost) {
    return res.json({
      updatedAt: "",
      error: "게시글이 설정되지 않았습니다. 디스코드에서 !주소 명령어로 설정해주세요.",
      ranks: []
    });
  }

  try {
    const comments = await fetchComments(currentStation, currentPost);

    // 전체 정렬 후 순위 map 생성
    const allSorted = [...comments].sort((a, b) => (b.likeCnt || 0) - (a.likeCnt || 0));

    const rankMap = {};
    allSorted.forEach((c, index) => {
      rankMap[c.userId] = index + 1;
    });

    // 최대 1000명까지 (데이터가 1000명 미만이면 있는 만큼만)
    const top1000 = allSorted.slice(0, 1000);

    // 멤버 중 top1000에 없는 사람 추가
    const memberComments = allSorted.filter(c =>
      MEMBERS.includes(c.userId || "") &&
      !top1000.find(t => t.userId === c.userId)
    );

    const merged = [...top1000, ...memberComments];

    const ranks = merged.map(c => ({
      rank: rankMap[c.userId] || 0,
      name: c.userNick || "",
      id: c.userId || "",
      up: c.likeCnt || 0,
      member: MEMBERS.includes(c.userId || "")
    })).sort((a, b) => a.rank - b.rank);

    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const updatedAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')} ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}`;

    res.json({
      updatedAt,
      stationId: currentStation,
      postId: currentPost,
      total: ranks.length,
      ranks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      updatedAt: "",
      error: err.message,
      ranks: []
    });
  }
});

app.get("/ping", (req, res) => {
  res.json({ status: "ok", currentStation, currentPost });
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Rank Server Started on port 3000");
});

// ==============================
// Discord Bot
// ==============================
if (!DISCORD_TOKEN) {
  console.warn("DISCORD_TOKEN 환경변수가 없습니다. 디스코드 봇이 실행되지 않습니다.");
} else {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once(Events.ClientReady, () => {
    console.log(`디스코드 봇 로그인: ${client.user.tag}`);
  });

  function getCurrentUrl() {
    if (!currentStation || !currentPost) return null;
    return `https://www.sooplive.com/station/${currentStation}/post/${currentPost}`;
  }

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (ADMIN_DISCORD_ID && message.author.id !== ADMIN_DISCORD_ID) return;

    const content = message.content.trim();

    if (content.startsWith("!주소")) {
      const url = content.replace("!주소", "").trim();

      if (!url) {
        const current = getCurrentUrl();
        if (!current) return message.reply("현재 설정된 게시글이 없습니다.");
        return message.reply(`현재 주소: ${current}`);
      }

      const parsed = parseSoopUrl(url);
      if (!parsed) {
        return message.reply(
          "❌ SOOP 게시글 URL 형식이 아닙니다.\n예: `!주소 https://www.sooplive.com/station/아이디/post/글번호`"
        );
      }

      currentStation = parsed.stationId;
      currentPost = parsed.postId;
      console.log(`게시글 변경: station=${currentStation}, post=${currentPost}`);

      return message.reply(
        `✅ 게시글이 설정되었습니다.\n- URL: ${getCurrentUrl()}`
      );
    }

    if (content === "!도움" || content === "!명령어") {
      return message.reply(
        "**순위봇 명령어**\n" +
        "`!주소 [URL]` - 게시글 설정\n" +
        "`!주소` (URL 없이) - 현재 주소 확인\n" +
        "`!도움` / `!명령어` - 명령어 목록"
      );
    }
  });

  client.login(DISCORD_TOKEN).catch((err) => {
    console.error("디스코드 봇 로그인 실패:", err.message);
  });
}
