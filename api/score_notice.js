import { ai } from "./utils/ai_client.js";
import { db } from "./utils/db.js";

export async function scoreNotices() {
  const pending = await db.getUnscored();

  for (const notice of pending) {
    const completion = await ai.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        {
          role: "user",
          content: `Analyze this opportunity for ProVision Systems fit:\n\n${JSON.stringify(notice)}`,
        },
      ],
    });

    const score = completion.choices[0].message.content;
    await db.saveScore(notice.id, score);
  }
}
