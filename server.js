const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits, Events } = require("discord.js");

const app = express();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || "";

let currentStation = "";
let currentPost = "";
let cutoffRank = 0; // 0 = 설정 안 됨

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
  "hwyjump",
  "neez0611"
];

// 찐드기 멤버 목록 (여기에 아이디 추가, 또는 !찐드기 추가 명령어 사용)
let JJINMEMBERS = ["banta251201","cjdtkddkfl45","wo0o0ow","esoj001","tamazu","kanoz0"];

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

    const allSorted = [...comments].sort((a, b) => (b.likeCnt || 0) - (a.likeCnt || 0));

    const rankMap = {};
    allSorted.forEach((c, index) => {
      rankMap[c.userId] = index + 1;
    });

    const top1000 = allSorted.slice(0, 1000);

    const memberComments = allSorted.filter(c =>
      MEMBERS.includes(c.userId || "") &&
      !top1000.find(t => t.userId === c.userId)
    );

    const jjinMemberComments = allSorted.filter(c =>
      JJINMEMBERS.includes(c.userId || "") &&
      !top1000.find(t => t.userId === c.userId) &&
      !memberComments.find(t => t.userId === c.userId)
    );

    const merged = [...top1000, ...memberComments, ...jjinMemberComments];

    const ranks = merged.map(c => ({
      rank: rankMap[c.userId] || 0,
      name: c.userNick || "",
      id: c.userId || "",
      up: c.likeCnt || 0,
      member: MEMBERS.includes(c.userId || ""),
      jjinmember: JJINMEMBERS.includes(c.userId || ""),
      // cutoff 기준으로 above(컷 이상) / below(컷 미만) 구분
      // cutoffRank가 0이면 항상 "none"
      cutoff: cutoffRank > 0
        ? ((rankMap[c.userId] || 0) <= cutoffRank ? "above" : "below")
        : "none"
    })).sort((a, b) => a.rank - b.rank);

    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const updatedAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')} ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}`;

    res.json({
      updatedAt,
      stationId: currentStation,
      postId: currentPost,
      cutoffRank,          // 현재 컷 순위 (0이면 미설정)
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
  res.json({ status: "ok", currentStation, currentPost, cutoffRank });
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

    // !주소 명령어
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

    // !컷 명령어
    if (content.startsWith("!컷")) {
      const arg = content.replace("!컷", "").trim();

      // 인자 없이 !컷만 입력 → 현재 설정 확인
      if (!arg) {
        if (cutoffRank === 0) return message.reply("현재 순위 컷이 설정되어 있지 않습니다.");
        return message.reply(`현재 순위 컷: **${cutoffRank}위**`);
      }

      // !컷 해제
      if (arg === "해제") {
        cutoffRank = 0;
        console.log("순위 컷 해제");
        return message.reply("✅ 순위 컷이 해제되었습니다.");
      }

      // !컷 숫자
      const num = parseInt(arg, 10);
      if (isNaN(num) || num < 1) {
        return message.reply("❌ 올바른 순위 숫자를 입력해주세요.\n예: `!컷 30`");
      }

      cutoffRank = num;
      console.log(`순위 컷 설정: ${cutoffRank}위`);
      return message.reply(`✅ 순위 컷이 **${cutoffRank}위**로 설정되었습니다.\n${cutoffRank}위 이상은 초록, 이하는 빨강으로 표시됩니다.`);
    }

    // !찐드기 명령어
    if (content.startsWith("!찐드기")) {
      const arg = content.replace("!찐드기", "").trim();

      if (!arg || arg === "목록") {
        if (JJINMEMBERS.length === 0) return message.reply("현재 찐드기 멤버가 없습니다.");
        return message.reply(`**찐드기 멤버 목록 (${JJINMEMBERS.length}명)**\n` + JJINMEMBERS.join(", "));
      }

      if (arg.startsWith("추가 ")) {
        const id = arg.replace("추가 ", "").trim();
        if (!id) return message.reply("❌ 추가할 아이디를 입력해주세요.\n예: `!찐드기 추가 userid`");
        if (JJINMEMBERS.includes(id)) return message.reply(`⚠️ \`${id}\`는 이미 찐드기 멤버입니다.`);
        JJINMEMBERS.push(id);
        console.log(`찐드기 추가: ${id}`);
        return message.reply(`✅ \`${id}\`를 찐드기 멤버로 추가했습니다. (현재 ${JJINMEMBERS.length}명)`);
      }

      if (arg.startsWith("제거 ")) {
        const id = arg.replace("제거 ", "").trim();
        const idx = JJINMEMBERS.indexOf(id);
        if (idx === -1) return message.reply(`❌ \`${id}\`는 찐드기 멤버 목록에 없습니다.`);
        JJINMEMBERS.splice(idx, 1);
        console.log(`찐드기 제거: ${id}`);
        return message.reply(`✅ \`${id}\`를 찐드기 멤버에서 제거했습니다. (현재 ${JJINMEMBERS.length}명)`);
      }

      return message.reply(
        "**찐드기 명령어**\n" +
        "`!찐드기 목록` - 멤버 확인\n" +
        "`!찐드기 추가 [아이디]` - 멤버 추가\n" +
        "`!찐드기 제거 [아이디]` - 멤버 제거"
      );
    }

    // !도움 / !명령어
    if (content === "!도움" || content === "!명령어") {
      return message.reply(
        "**순위봇 명령어**\n" +
        "`!주소 [URL]` - 게시글 설정\n" +
        "`!주소` (URL 없이) - 현재 주소 확인\n" +
        "`!컷 [순위]` - 순위 컷 설정 (예: `!컷 30`)\n" +
        "`!컷` (숫자 없이) - 현재 컷 확인\n" +
        "`!컷 해제` - 순위 컷 제거\n" +
        "`!찐드기 추가 [아이디]` - 찐드기 멤버 추가\n" +
        "`!찐드기 제거 [아이디]` - 찐드기 멤버 제거\n" +
        "`!찐드기 목록` - 찐드기 멤버 확인\n" +
        "`!도움` / `!명령어` - 명령어 목록"
      );
    }
  });

  client.login(DISCORD_TOKEN).catch((err) => {
    console.error("디스코드 봇 로그인 실패:", err.message);
  });
}
