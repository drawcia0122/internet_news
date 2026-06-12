import { collectTrendTopics } from "../../lib/trend-aggregator.mjs";

export async function handler() {
  try {
    const topics = await collectTrendTopics();
    return jsonResponse(200, topics);
  } catch (error) {
    return jsonResponse(500, {
      error: "Failed to fetch trend topics.",
      message: error.message,
    });
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
    body: JSON.stringify(body),
  };
}
