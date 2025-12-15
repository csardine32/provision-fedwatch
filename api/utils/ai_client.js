import OpenAI from "openai";
import { secrets } from "../../config/keys/service.js";

export const ai = new OpenAI({
  apiKey: secrets.openai.api_key,
  project: secrets.openai.project_id,
});
