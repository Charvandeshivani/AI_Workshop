
import "dotenv/config";
import express from "express";
import cors from "cors";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import OpenAI from "openai";
import path from "node:path";

const app = express();
const PORT = 3000;

app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing from the .env file.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getFarmerData(question: string) {
  const client = new Client({
    name: "sanjivani-angular-api",
    version: "1.0.0",
  });

  const root = process.cwd();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve(root, "node_modules/tsx/dist/cli.mjs"),
      path.resolve(root, "server.ts"),
    ],
    env: {
      ...process.env,
      PGPASSWORD: process.env.PGPASSWORD ?? "",
    },
  });

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: "get_farmer_data",
      arguments: { question },
    });

    if (result.isError) {
      throw new Error("MCP farmer data tool failed.");
    }

    const content = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    return JSON.parse(content) as {
      farmers: {
        farmer_id: number;
        farmer_name: string;
        village: string;
        sugarcane_tons: number | string;
        amount_paid: number | string;
        payment_pending: number | string;
      }[];
    };
  } finally {
    await client.close();
  }
}

app.get("/api/farmers", async (_req, res) => {
  try {
    const data = await getFarmerData("Retrieve all farmer records.");
    res.json(data.farmers);
  } catch (error) {
    console.error("FARMER API ERROR:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const question = req.body?.question;
    const language = req.body?.language ?? "English";

    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 1000
    ) {
      res.status(400).json({
        error: "Enter a valid question of up to 1000 characters.",
      });
      return;
    }

    const data = await getFarmerData(question);

    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      instructions: `You are the Sanjivani Sugar Factory sugarcane farmer assistant.
Answer only questions about sugarcane farming, farmer records, villages,
sugarcane supply, payments, and factory operations.
Politely decline unrelated questions.
Use only the supplied database records. Do not invent figures.
Calculate totals carefully. Reply in ${language}.`,
      input: `Question: ${question}\nFarmer records:\n${JSON.stringify(data.farmers)}`,
    });

    res.json({
      answer: response.output_text,
      language,
    });
  } catch (error) {
    console.error("CHAT API ERROR DETAILS:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Sanjivani API running at http://localhost:${PORT}`);
});
