const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generateWithRetry } = require("../utils/geminiRetry");

require("dotenv").config();
// Init Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

router.post("/", async (req, res) => {
  try {
    const { image, uid } = req.body;

    if (!image || !uid) {
      return res.status(400).json({ error: "Image and uid required" });
    }

    // Fetch user profile from Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User profile not found" });
    }
    const profile = userDoc.data();

    // Build prompt
    const prompt = buildPrompt(profile);

    // Call Gemini Vision
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const result = await generateWithRetry(model, [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data,
        },
      },
      prompt,
    ]);

    const text = result.response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "AI response parsing failed" });
    }

    const analysis = JSON.parse(jsonMatch[0]);
    res.json(analysis);

  } catch (err) {
    console.error("Analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

function buildPrompt(profile) {
  return `
You are an expert nutritionist and food scientist analyzing a food product for a specific user.

USER PROFILE:
- Name: ${profile.name}
- Age: ${profile.age} years
- Gender: ${profile.gender}
- Weight: ${profile.weight} kg
- Height: ${profile.height} cm
- Health Goal: ${profile.goal}
- Diet Type: ${profile.diet}
- Activity Level: ${profile.activityLevel}
- Allergies: ${profile.allergies?.join(", ") || "None"}
- Medical Conditions: ${profile.medicalConditions?.join(", ") || "None"}
- Other Medical Info: ${profile.otherMedical || "None"}

TASK:
Analyze the food product shown in this image and return a JSON response with exactly this structure:

{
  "productName": "exact product name",
  "brand": "brand name",
  "category": "product category (e.g. biscuits, chips, drink)",
  "ingredients": [
    {
      "name": "ingredient name",
      "hiddenMeaning": "what it really is in simple words",
      "concern": "none/low/medium/high",
      "explanation": "why it matters for this user"
    }
  ],
  "nutrition": {
    "calories": "per serving",
    "protein": "grams",
    "carbs": "grams",
    "fat": "grams",
    "sugar": "grams",
    "sodium": "mg"
  },
  "verdict": "suitable/caution/not_suitable",
  "score": 7,
  "verdictReason": "2-3 sentence explanation why this product is or isn't suitable for this specific user",
  "pros": ["pro 1", "pro 2"],
  "cons": ["con 1", "con 2"],
  "alternatives": [
    {
      "name": "alternative product name",
      "brand": "brand",
      "reason": "why this is better for the user"
    }
  ],
  "aiTip": "one personalized tip for this user about this product"
}

IMPORTANT RULES:
- verdict must be exactly: "suitable", "caution", or "not_suitable"
- score must be 1-10 number
- Give 3-5 alternatives available in Indian market
- Decode ALL hidden ingredient names (maltodextrin, HFCS, E numbers etc.)
- Be specific to user's health goal and medical conditions
- Return ONLY the JSON object, no other text
`;
}

module.exports = router;