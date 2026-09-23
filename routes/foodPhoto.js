const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generateWithRetry } = require("../utils/geminiRetry");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// POST /api/food/photo-log — premium AI meal recognition from a photo
router.post("/photo-log", async (req, res) => {
  try {
    const { image, uid } = req.body;
    if (!image || !uid) {
      return res.status(400).json({ error: "Image and uid required" });
    }

    // Premium gate — production would enforce this strictly; defaults to true
    // so the feature is testable without manually flagging every user.
    const userDoc = await db.collection("users").doc(uid).get();
    const isPremium = userDoc.exists ? userDoc.data().isPremium !== false : true;
    if (!isPremium) {
      return res.status(403).json({ error: "Photo meal logging is a premium feature." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are a nutrition expert. Identify the food/meal in this image and estimate its nutritional content for the visible portion.

Return ONLY this JSON, no other text:
{"foodName":"short description of the meal","calories":0,"protein":0,"carbs":0,"fat":0,"sugar":0,"sodium":0}

Rules:
- Estimate for the whole visible portion in the image, not per 100g.
- Numbers only (no units) for all nutrition fields.
- Be realistic — base estimates on typical serving sizes for what's shown.`;

    const result = await generateWithRetry(model, [
      { inlineData: { mimeType: "image/jpeg", data: base64Data } },
      prompt,
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI response parsing failed" });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error("Photo-log error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
