const express = require("express");
const cors = require("cors");
require("dotenv").config();

const analyzeRoute = require("./routes/analyze");
const recommendRoute = require("./routes/recommend");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/analyze", analyzeRoute);

// ← Pehle cache delete route
app.delete("/api/recommend/cache/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const admin = require("firebase-admin");
    await admin.firestore().collection("recommendations").doc(uid).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ← Baad mein recommend route
app.use("/api/recommend", recommendRoute);

app.get("/", (req, res) => res.send("FitScan AI Backend Running 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));