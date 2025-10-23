import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const run = promisify(exec);
const app = express();
app.use(express.json());

// --- Initialize Backblaze S3 client ---
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});

// --- Helper to upload a file to B2 ---
async function uploadToB2(localPath, keyName) {
  const fileStream = fs.createReadStream(localPath);
  const uploadParams = {
    Bucket: process.env.B2_BUCKET,
    Key: keyName,
    Body: fileStream,
    ACL: "public-read",
    ContentType: keyName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4",
  };
  await s3.send(new PutObjectCommand(uploadParams));
  return `https://${process.env.B2_BUCKET}.${process.env.B2_ENDPOINT}/${keyName}`;
}

// --- Extract & Upload Route ---
app.post("/extract", async (req, res) => {
  try {
    const { video_url } = req.body;
    if (!video_url) {
      return res.status(400).json({ error: "Missing video_url" });
    }

    const videoPath = "input.mp4";
    const audioPath = "output_audio.mp3";
    const mutedVideoPath = "output_muted.mp4";

    // 1️⃣ Download video
    const response = await fetch(video_url);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(videoPath, Buffer.from(buffer));

    // 2️⃣ Extract audio (low-memory version)
    await run(`ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -b:a 64k "${audioPath}" -y`);

    // 3️⃣ Create muted video (low-memory version)
    await run(`ffmpeg -i "${videoPath}" -an -c:v libx264 -preset ultrafast -crf 35 "${mutedVideoPath}" -y`);

    // 4️⃣ Upload both to B2
    const audioUrl = await uploadToB2(audioPath, "output_audio.mp3");
    const videoUrl = await uploadToB2(mutedVideoPath, "output_muted.mp4");

    // 5️⃣ Clean up
    fs.unlinkSync(videoPath);
    fs.unlinkSync(audioPath);
    fs.unlinkSync(mutedVideoPath);

    res.json({
      success: true,
      message: "Files uploaded to Backblaze B2",
      audio_url: audioUrl,
      muted_video_url: videoUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
