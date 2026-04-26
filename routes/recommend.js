const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

if (!admin.apps.length) {
  const serviceAccount = require("../serviceAccountKey.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

router.post("/", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "uid required" });

    // Check cache — if generated today, return cached
    const cacheRef = db.collection("recommendations").doc(uid);
    const cacheSnap = await cacheRef.get();

    if (cacheSnap.exists) {
      const cached = cacheSnap.data();
      const generatedAt = cached.generatedAt?.toDate();
      const now = new Date();
      const diffHours = (now - generatedAt) / (1000 * 60 * 60);

      if (diffHours < 24) {
        console.log("Returning cached recommendations");
        return res.json(cached.data);
      }
    }

    // Fetch user profile
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    const profile = userDoc.data();

    // Call Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent(buildRecommendPrompt(profile));
    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "AI parsing failed" });

    const recommendations = JSON.parse(jsonMatch[0]);

    // Cache in Firestore
    await cacheRef.set({
      data: recommendations,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json(recommendations);
  } catch (err) {
    console.error("Recommend error:", err);
    res.status(500).json({ error: err.message });
  }
});

function buildRecommendPrompt(profile) {
  return `Nutritionist for Indian user. User: ${profile.age}yr ${profile.gender}, ${profile.weight}kg, goal:${profile.goal}, diet:${profile.diet}, activity:${profile.activityLevel}, allergies:${profile.allergies?.join(",")|| "none"}, conditions:${profile.medicalConditions?.join(",")|| "none"}.

Return ONLY this JSON:
{"greeting":"one tip","dailyTip":"one health tip","recommendedProducts":[{"name":"","brand":"","emoji":"","reason":"","tag":""}],"recommendedCategories":[{"name":"","emoji":"","examples":"","benefit":""}],"avoidList":[{"name":"","emoji":"","reason":""}]}

Rules: 4 products, 3 categories, 3 avoid. Indian market only. JSON only, no extra text.`;
}
module.exports = router;