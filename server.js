import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const app = express();
const run = promisify(exec);
app.use(express.json({ limit: "100mb" }));

app.get("/", (req, res) => {
  res.send("✅ API running. POST /extract with { video_url }");
});

app.post("/extract", async (req, res) => {
  try {
    const { video_url } = req.body;
    if (!video_url) return res.status(400).json({ error: "Missing video_url" });

    // temp input path (will be deleted)
    const inputPath = path.resolve("./temp_input.mp4");
    const audioPath = path.resolve("./output_audio.mp3");
    const mutedVideoPath = path.resolve("./output_muted.mp4");

    // download video
    const response = await fetch(video_url);
    if (!response.ok) throw new Error("Failed to download video");
    const fileStream = fs.createWriteStream(inputPath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    // extract audio (mp3)
    await run(`ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}"`);
    // make muted video (copy video stream, drop audio)
    await run(`ffmpeg -y -i "${inputPath}" -an -vcodec copy "${mutedVideoPath}"`);

    // delete temp input
    fs.unlinkSync(inputPath);

    res.json({
      success: true,
      message: "Muted video and audio created.",
      audio: audioPath,
      muted_video: mutedVideoPath
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));