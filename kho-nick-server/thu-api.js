// Chạy trên Node.js v18+ (hỗ trợ fetch native)
const API_KEY = "818095f06530e80b6ae8a0b39881bdea4da5e7d8fccac2bd4b904d17d92589c4";
const BASE_URL = "https://quatuwu.click";

const headers = {
  "X-API-Key": API_KEY,
  "Content-Type": "application/json"
};

async function readFirstNdjsonLine(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const parsed = JSON.parse(line.trim());
          reader.cancel().catch(() => {});
          return parsed;
        }
      }
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  return null;
}

async function main() {
  try {
    // 1. Kiểm tra số dư
    console.log("1. Đang kiểm tra số dư (/api/auth/me)...");
    const meRes = await fetch(BASE_URL + "/api/auth/me", { 
      headers, 
      signal: AbortSignal.timeout(30000) 
    });
    const meData = await meRes.json();
    console.log("=> Số dư:", meData?.data?.balance, "VNĐ (User:", meData?.data?.username + ")");

    // 2. Bước 1: Check target (CẦN GỬI CẢ 'query' và 'target')
    console.log("\n2. Đang check nick (/api/lq-buff/check-target)...");
    const targetInput = "Bâng";
    const checkRes = await fetch(BASE_URL + "/api/lq-buff/check-target", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: targetInput, target: targetInput }),
      signal: AbortSignal.timeout(30000)
    });
    const checkData = await checkRes.json();
    console.log("=> Check nick thành công:", checkData.success ? checkData.player : checkData.message);

    // 3. Bước 2: Tạo đơn buff (/api/lq-buff/start)
    console.log("\n3. Đang gửi yêu cầu tạo đơn buff (/api/lq-buff/start)...");
    const buffRes = await fetch(BASE_URL + "/api/lq-buff/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: targetInput, target: targetInput, amount: 1000 }),
      signal: AbortSignal.timeout(30000)
    });

    const isNdjson = (buffRes.headers.get("content-type") || "").includes("ndjson");
    let buffData;
    if (isNdjson) {
      buffData = await readFirstNdjsonLine(buffRes);
    } else {
      buffData = await buffRes.json();
    }
    console.log("=> Tạo đơn thành công! Job ID:", buffData?.jobId || buffData);

    // 4. Bước 3: Kiểm tra trạng thái đơn vừa tạo qua /history
    console.log("\n4. Đang kiểm tra trạng thái đơn qua /api/lq-buff/history...");
    const histRes = await fetch(BASE_URL + "/api/lq-buff/history", {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    const histData = await histRes.json();
    const currentJob = (histData.jobs || []).find(j => j.id === buffData?.jobId);
    if (currentJob) {
      console.log(`=> Trạng thái đơn ${currentJob.id}: [${currentJob.status.toUpperCase()}] Tiến độ: ${currentJob.succeeded || 0}/${currentJob.requested} like`);
    } else {
      console.log("=> Đơn đang trong hàng đợi xử lý.");
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error("\n❌ LỖI TIMEOUT: Yêu cầu mất quá nhiều thời gian phản hồi từ server mẹ!");
    } else {
      console.error("\n❌ LỖI KẾT NỐI:", error.message);
    }
  }
}

main();
